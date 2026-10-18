-- ============================================================================
-- BAMX · Canje de recompensas por voluntarios + notificaciones para admins
--
-- Incremental sobre 005_volunteer_accounts.sql (usa volunteers.user_id,
-- is_volunteer() y my_volunteer_id()); 005 requiere 002.
--
--   - redemption_requests: una solicitud de canje (encabezado) con estado
--     pending_delivery -> delivered y client_request_id de idempotencia
--     (UNIQUE por voluntario).
--   - reward_redemptions (ya existe) pasa a ser el renglon de la solicitud:
--     columna nueva request_id (null en el historial previo, que NO se marca
--     como pendiente: no hay evidencia de su estado) y points_spent = costo
--     historico al momento del canje.
--   - admin_notifications + admin_notification_reads (estado de leido POR
--     admin) + vista admin_notifications_feed (security_invoker).
--   - redeem_rewards / mark_redemption_delivered /
--     mark_admin_notifications_read: SECURITY DEFINER, solo service_role
--     (Edge Functions redeem-rewards, mark-redemption-delivered y
--     mark-notifications-read; docs/nfc-contract.md, funciones 10-12).
--
-- No necesita app.card_hmac_secret y se puede correr mas de una vez.
-- Como correrlo: SQL editor de Supabase, pegar/correr este archivo completo.
-- ============================================================================

begin;

-- Maximo de recompensas distintas por solicitud (la Edge Function valida lo mismo).
create or replace function redemption_max_items()
returns integer
language sql
immutable
as $$ select 20; $$;


-- ----------------------------------------------------------------------------
-- 1. redemption_requests (encabezado de la solicitud)
-- ----------------------------------------------------------------------------
create table if not exists redemption_requests (
  id                 uuid primary key default gen_random_uuid(),
  volunteer_id       uuid not null references volunteers(id) on delete restrict,
  client_request_id  uuid not null,
  status             text not null default 'pending_delivery'
                       check (status in ('pending_delivery', 'delivered')),
  total_points       integer not null check (total_points >= 0),
  item_count         integer not null check (item_count >= 1),
  requested_by       uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  delivered_at       timestamptz,
  delivered_by       uuid references auth.users(id) on delete set null,
  constraint redemption_requests_client_request_key unique (volunteer_id, client_request_id),
  constraint redemption_requests_delivery_consistent
    check ((status = 'delivered') = (delivered_at is not null))
);

comment on table redemption_requests is
  'DS3 (canje) - Solicitud de canje de un voluntario: total, estado de entrega e id de idempotencia.';
comment on column redemption_requests.client_request_id is
  'UUID que genera el cliente; reintentar con el mismo id no vuelve a cobrar (unico por voluntario).';

create index if not exists idx_redemption_requests_volunteer
  on redemption_requests (volunteer_id, created_at desc);
create index if not exists idx_redemption_requests_pending
  on redemption_requests (created_at desc) where status = 'pending_delivery';


-- ----------------------------------------------------------------------------
-- 2. reward_redemptions: renglones de la solicitud
-- ----------------------------------------------------------------------------
alter table reward_redemptions
  add column if not exists request_id uuid references redemption_requests(id) on delete restrict;

comment on column reward_redemptions.request_id is
  'Solicitud a la que pertenece el renglon. null = canje historico previo a 006 (estado de entrega desconocido).';
comment on column reward_redemptions.points_spent is
  'Costo de la recompensa al momento del canje (historico; no cambia si despues se edita la recompensa).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reward_redemptions_request_reward_key') then
    alter table reward_redemptions
      add constraint reward_redemptions_request_reward_key unique (request_id, reward_id);
  end if;
end $$;

create index if not exists idx_reward_redemptions_request on reward_redemptions (request_id);


-- ----------------------------------------------------------------------------
-- 3. Notificaciones in-app para admins (sin email ni push)
-- ----------------------------------------------------------------------------
create table if not exists admin_notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('redemption_requested')),
  title       text not null,
  message     text not null,
  payload     jsonb not null default '{}'::jsonb,
  request_id  uuid references redemption_requests(id) on delete restrict,
  created_at  timestamptz not null default now()
);

comment on table admin_notifications is 'Notificaciones in-app para admins. El estado de leido es por admin (admin_notification_reads).';

create index if not exists idx_admin_notifications_created on admin_notifications (created_at desc);

create table if not exists admin_notification_reads (
  notification_id  uuid not null references admin_notifications(id) on delete cascade,
  admin_id         uuid not null references auth.users(id) on delete cascade,
  read_at          timestamptz not null default now(),
  primary key (notification_id, admin_id)
);

comment on table admin_notification_reads is 'Una fila = ese admin ya leyo esa notificacion.';


-- ----------------------------------------------------------------------------
-- 4. RLS y permisos. Solo lectura desde el cliente; toda escritura pasa por
--    las funciones SECURITY DEFINER de abajo.
-- ----------------------------------------------------------------------------
alter table redemption_requests enable row level security;
alter table admin_notifications enable row level security;
alter table admin_notification_reads enable row level security;

drop policy if exists "redemption_requests_read_admin" on redemption_requests;
create policy "redemption_requests_read_admin" on redemption_requests
  for select to authenticated using (is_admin());

drop policy if exists "redemption_requests_read_own" on redemption_requests;
create policy "redemption_requests_read_own" on redemption_requests
  for select to authenticated using (volunteer_id = my_volunteer_id());

drop policy if exists "admin_notifications_read_admin" on admin_notifications;
create policy "admin_notifications_read_admin" on admin_notifications
  for select to authenticated using (is_admin());

drop policy if exists "admin_notification_reads_read_own" on admin_notification_reads;
create policy "admin_notification_reads_read_own" on admin_notification_reads
  for select to authenticated using (admin_id = auth.uid() and is_admin());

revoke insert, update, delete on redemption_requests, reward_redemptions,
  admin_notifications, admin_notification_reads from anon, authenticated;
revoke all on redemption_requests, admin_notifications, admin_notification_reads from anon;

-- Feed de notificaciones con el read_at DEL ADMIN QUE CONSULTA. security_invoker
-- hace que se apliquen la RLS y los permisos del que consulta (no del dueno).
create or replace view admin_notifications_feed
with (security_invoker = true)
as
select n.id, n.type, n.title, n.message, n.payload, n.request_id, n.created_at, r.read_at
from admin_notifications n
left join admin_notification_reads r
  on r.notification_id = n.id and r.admin_id = auth.uid();

comment on view admin_notifications_feed is 'Notificaciones con read_at del admin actual (null = no leida). Respeta RLS (security_invoker).';

revoke all on admin_notifications_feed from public, anon;
grant select on admin_notifications_feed to authenticated;


-- ----------------------------------------------------------------------------
-- 5. redeem_rewards
-- ----------------------------------------------------------------------------
-- Respuesta ya registrada de una solicitud (lo usa el reintento idempotente).
create or replace function redemption_request_json(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', q.id,
    'client_request_id', q.client_request_id,
    'status', q.status,
    'total_points', q.total_points,
    'created_at', q.created_at,
    'delivered_at', q.delivered_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('reward_id', rr.reward_id, 'name', rw.name, 'points_spent', rr.points_spent)
                       order by rr.reward_id)
      from reward_redemptions rr join rewards rw on rw.id = rr.reward_id
      where rr.request_id = q.id), '[]'::jsonb)
  )
  from redemption_requests q
  where q.id = p_request_id;
$$;

revoke all on function redemption_request_json(uuid) from public, anon, authenticated;

-- p_user_id = auth.uid() de la sesion (la Edge Function lo saca del JWT; nunca
-- del cuerpo). No recibe volunteer_id, costos ni saldo: todo se lee aqui.
-- Codigos: ok | volunteer_not_linked | volunteer_inactive | idempotency_conflict
--          | reward_unavailable (rewards[].reason: not_found | inactive | out_of_stock)
--          | insufficient_points
create or replace function redeem_rewards(
  p_user_id           uuid,
  p_client_request_id uuid,
  p_reward_ids        uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids          uuid[];
  v_vol          volunteers%rowtype;
  v_existing     redemption_requests%rowtype;
  v_existing_ids uuid[];
  v_unavailable  jsonb;
  v_total        bigint;
  v_found        integer;
  v_request_id   uuid;
  v_items        jsonb;
  v_message      text;
  v_reject       jsonb;
begin
  -- 0) Forma de la entrada (la Edge Function ya la valido; segunda barrera).
  if p_user_id is null or p_client_request_id is null then
    raise exception 'redeem_rewards: p_user_id y p_client_request_id requeridos' using errcode = '22023';
  end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_reward_ids) as x;
  if v_ids is null or cardinality(v_ids) = 0
     or array_position(p_reward_ids, null) is not null
     or cardinality(v_ids) <> cardinality(p_reward_ids)
     or cardinality(v_ids) > redemption_max_items() then
    raise exception 'redeem_rewards: p_reward_ids debe tener de 1 a % ids distintos y no nulos', redemption_max_items()
      using errcode = '22023';
  end if;

  -- 1) Voluntario de la sesion, bloqueado. Lock #1 (siempre primero): serializa
  --    todos los canjes del mismo voluntario, incluidos los reintentos.
  select * into v_vol from volunteers where user_id = p_user_id for update;
  if not found then
    insert into audit_logs (event_type, detail)
    values ('redemption_rejected', jsonb_build_object('reason', 'volunteer_not_linked', 'user_id', p_user_id,
                                                      'client_request_id', p_client_request_id));
    return jsonb_build_object('code', 'volunteer_not_linked', 'message', 'Tu cuenta no esta vinculada a un voluntario');
  end if;

  -- 2) Idempotencia (con el lock ya tomado, un reintento concurrente ve aqui
  --    la solicitud que confirmo la primera llamada).
  select * into v_existing from redemption_requests
   where volunteer_id = v_vol.id and client_request_id = p_client_request_id;
  if found then
    select array_agg(reward_id order by reward_id) into v_existing_ids
      from reward_redemptions where request_id = v_existing.id;
    if v_existing_ids = v_ids then
      return jsonb_build_object(
        'code', 'ok',
        'replayed', true,
        'balance', v_vol.points,
        'request', redemption_request_json(v_existing.id)
      );
    end if;
    insert into audit_logs (event_type, volunteer_id, detail)
    values ('redemption_rejected', v_vol.id,
            jsonb_build_object('reason', 'idempotency_conflict', 'client_request_id', p_client_request_id,
                               'request_id', v_existing.id));
    return jsonb_build_object('code', 'idempotency_conflict',
                              'message', 'Ese request_id ya se uso con otras recompensas');
  end if;

  if not v_vol.is_active then
    v_reject := jsonb_build_object('code', 'volunteer_inactive', 'message', 'Voluntario inactivo');
  else
    -- 3) Recompensas bloqueadas en orden de id (lock #2, orden consistente)
    --    y con costo/stock ACTUALES leidos de la base.
    perform 1 from rewards where id = any(v_ids) order by id for update;

    select jsonb_agg(jsonb_build_object('reward_id', x.id, 'reason', x.reason) order by x.id)
      into v_unavailable
    from (
      select i.id,
             case when r.id is null then 'not_found'
                  when not r.is_active then 'inactive'
                  when r.stock < 1 then 'out_of_stock' end as reason
      from unnest(v_ids) as i(id)
      left join rewards r on r.id = i.id
    ) x
    where x.reason is not null;

    if v_unavailable is not null then
      v_reject := jsonb_build_object('code', 'reward_unavailable',
                                     'message', 'Alguna recompensa no esta disponible',
                                     'rewards', v_unavailable);
    else
      select coalesce(sum(points_cost), 0), count(*) into v_total, v_found
        from rewards where id = any(v_ids);
      if v_total > v_vol.points then
        v_reject := jsonb_build_object('code', 'insufficient_points',
                                       'message', 'No tienes puntos suficientes',
                                       'required', v_total, 'available', v_vol.points);
      end if;
    end if;
  end if;

  -- Cualquier rechazo: no se escribe nada salvo el registro de auditoria.
  if v_reject is not null then
    insert into audit_logs (event_type, volunteer_id, detail)
    values ('redemption_rejected', v_vol.id,
            jsonb_build_object('reason', v_reject->>'code', 'client_request_id', p_client_request_id,
                               'reward_ids', to_jsonb(v_ids)));
    return v_reject;
  end if;

  -- 4) Escritura: todo en esta misma transaccion. Si algo falla aqui, se
  --    revierte completo (puntos, stock, solicitud, renglones, notificacion).
  update volunteers set points = points - v_total::integer, updated_at = now()
   where id = v_vol.id;

  update rewards set stock = stock - 1 where id = any(v_ids);

  insert into redemption_requests (volunteer_id, client_request_id, total_points, item_count, requested_by)
  values (v_vol.id, p_client_request_id, v_total::integer, cardinality(v_ids), p_user_id)
  returning id into v_request_id;

  insert into reward_redemptions (volunteer_id, reward_id, points_spent, request_id)
  select v_vol.id, r.id, r.points_cost, v_request_id
  from rewards r where r.id = any(v_ids);

  select jsonb_agg(jsonb_build_object('reward_id', r.id, 'name', r.name, 'points_spent', r.points_cost) order by r.id),
         string_agg(format('%s (%s pts)', r.name, r.points_cost), ', ' order by r.name)
    into v_items, v_message
  from rewards r where r.id = any(v_ids);

  insert into admin_notifications (type, title, message, payload, request_id)
  values (
    'redemption_requested',
    'Canje pendiente de entrega',
    format('%s canjeó: %s. Total: %s pts.', v_vol.full_name, v_message, v_total),
    jsonb_build_object('request_id', v_request_id, 'volunteer_id', v_vol.id,
                       'volunteer_name', v_vol.full_name, 'total_points', v_total, 'items', v_items),
    v_request_id
  );

  insert into audit_logs (event_type, volunteer_id, detail)
  values ('redemption_requested', v_vol.id,
          jsonb_build_object('request_id', v_request_id, 'client_request_id', p_client_request_id,
                             'total_points', v_total, 'reward_ids', to_jsonb(v_ids)));

  return jsonb_build_object(
    'code', 'ok',
    'replayed', false,
    'balance', v_vol.points - v_total,
    'request', redemption_request_json(v_request_id)
  );
end;
$$;

comment on function redeem_rewards(uuid, uuid, uuid[]) is
  'Canje atomico e idempotente de 1..20 recompensas (1 unidad c/u) por el voluntario de la sesion. Codigos: ok | volunteer_not_linked | volunteer_inactive | idempotency_conflict | reward_unavailable | insufficient_points (docs/nfc-contract.md).';


-- ----------------------------------------------------------------------------
-- 6. mark_redemption_delivered (admin). No toca puntos ni stock.
-- ----------------------------------------------------------------------------
create or replace function mark_redemption_delivered(
  p_request_id  uuid,
  p_operator_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req redemption_requests%rowtype;
begin
  select * into v_req from redemption_requests where id = p_request_id for update;
  if not found then
    insert into audit_logs (event_type, detail)
    values ('deliver_request_not_found', jsonb_build_object('request_id', p_request_id, 'operator_id', p_operator_id));
    return jsonb_build_object('code', 'request_not_found', 'message', 'La solicitud de canje no existe');
  end if;

  if v_req.status = 'delivered' then
    return jsonb_build_object('code', 'ok', 'already_delivered', true,
                              'request', redemption_request_json(v_req.id));
  end if;

  update redemption_requests
  set status = 'delivered', delivered_at = now(), delivered_by = p_operator_id
  where id = p_request_id;

  insert into audit_logs (event_type, volunteer_id, detail)
  values ('redemption_delivered', v_req.volunteer_id,
          jsonb_build_object('request_id', p_request_id, 'operator_id', p_operator_id));

  return jsonb_build_object('code', 'ok', 'already_delivered', false,
                            'request', redemption_request_json(p_request_id));
end;
$$;

comment on function mark_redemption_delivered(uuid, uuid) is
  'Marca una solicitud como entregada (idempotente, sin cobrar de nuevo). Codigos: ok | request_not_found (docs/nfc-contract.md).';


-- ----------------------------------------------------------------------------
-- 7. mark_admin_notifications_read (admin). p_notification_ids null = todas.
-- ----------------------------------------------------------------------------
create or replace function mark_admin_notifications_read(
  p_admin_id         uuid,
  p_notification_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_marked integer;
begin
  if p_admin_id is null then
    raise exception 'mark_admin_notifications_read: p_admin_id requerido' using errcode = '22023';
  end if;

  insert into admin_notification_reads (notification_id, admin_id)
  select n.id, p_admin_id
  from admin_notifications n
  where p_notification_ids is null or n.id = any(p_notification_ids)
  on conflict (notification_id, admin_id) do nothing;
  get diagnostics v_marked = row_count;

  return jsonb_build_object(
    'code', 'ok',
    'marked', v_marked,
    'unread', (select count(*) from admin_notifications n
               where not exists (select 1 from admin_notification_reads r
                                 where r.notification_id = n.id and r.admin_id = p_admin_id))
  );
end;
$$;

comment on function mark_admin_notifications_read(uuid, uuid[]) is
  'Marca notificaciones como leidas para ESE admin (null = todas). Ids inexistentes se ignoran. Codigos: ok.';


-- ----------------------------------------------------------------------------
-- 8. Solo service_role (las Edge Functions) ejecuta las funciones nuevas.
-- ----------------------------------------------------------------------------
revoke all on function redeem_rewards(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function mark_redemption_delivered(uuid, uuid) from public, anon, authenticated;
revoke all on function mark_admin_notifications_read(uuid, uuid[]) from public, anon, authenticated;

grant execute on function redeem_rewards(uuid, uuid, uuid[]) to service_role;
grant execute on function mark_redemption_delivered(uuid, uuid) to service_role;
grant execute on function mark_admin_notifications_read(uuid, uuid[]) to service_role;

commit;
