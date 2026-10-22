-- ============================================================================
-- BAMX · Canje de recompensas por el admin + entrega por renglon
--
-- Incremental sobre 006_redemptions.sql (y 002 para cards); no la reescribe.
--
--   - Entrega POR RECOMPENSA: reward_redemptions gana status / delivered_at /
--     delivered_by. Cada renglon es un canje con su propio estado; entregar
--     uno no toca los demas. redemption_requests.status pasa a ser un resumen:
--     'delivered' cuando ya no le queda ningun renglon pendiente.
--     Backfill: los renglones con solicitud copian el estado de su solicitud;
--     los historicos previos a 006 (request_id null) quedan con status null,
--     igual que en 006 (no hay evidencia de su estado).
--   - redemption_requests.channel: quien origino el canje
--     ('volunteer_app' | 'admin' | 'admin_card'). Las previas: volunteer_app.
--   - redeem_rewards_core: la logica de redeem_rewards (006), ahora por
--     volunteer_id y con canal. redeem_rewards se redefine encima con la
--     misma firma, codigos y respuestas.
--   - admin_redeem_rewards: el admin canjea para un voluntario (perfil).
--   - admin_redeem_rewards_by_card: el admin canjea con la tarjeta NFC; el
--     voluntario sale de la tarjeta, no del cliente.
--   - lookup_card_volunteer: identifica al voluntario de una tarjeta antes
--     de confirmar el canje.
--   - mark_redemption_item_delivered: entrega UN renglon.
--   - mark_redemption_delivered (006) se redefine: entrega todos los
--     renglones pendientes de la solicitud (misma firma y respuesta).
--
-- Todas SECURITY DEFINER, solo service_role (Edge Functions; ver
-- docs/nfc-contract.md, funciones 15-18).
--
-- No necesita app.card_hmac_secret y se puede correr mas de una vez.
-- Como correrlo: SQL editor de Supabase, pegar/correr este archivo completo.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Estado por renglon
-- ----------------------------------------------------------------------------
-- Sin default a proposito: un default llenaria tambien los renglones
-- historicos. Quien inserta (redeem_rewards_core) lo pone explicito.
alter table reward_redemptions
  add column if not exists status       text check (status in ('pending_delivery', 'delivered')),
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_by uuid references auth.users(id) on delete set null;

update reward_redemptions rr
set status       = q.status,
    delivered_at = q.delivered_at,
    delivered_by = q.delivered_by
from redemption_requests q
where rr.request_id = q.id and rr.status is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reward_redemptions_delivery_consistent') then
    alter table reward_redemptions
      add constraint reward_redemptions_delivery_consistent
      check ((status = 'delivered') = (delivered_at is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reward_redemptions_request_has_status') then
    alter table reward_redemptions
      add constraint reward_redemptions_request_has_status
      check (request_id is null or status is not null);
  end if;
end $$;

comment on column reward_redemptions.status is
  'Estado de entrega de ESTE canje. null = historico previo a 006 (desconocido).';

create index if not exists idx_reward_redemptions_pending
  on reward_redemptions (redeemed_at desc) where status = 'pending_delivery';


-- ----------------------------------------------------------------------------
-- 2. Canal de origen
-- ----------------------------------------------------------------------------
alter table redemption_requests
  add column if not exists channel text not null default 'volunteer_app'
    check (channel in ('volunteer_app', 'admin', 'admin_card'));

comment on column redemption_requests.channel is
  'Quien origino el canje: volunteer_app (el voluntario), admin (desde su perfil) o admin_card (con su tarjeta NFC).';


-- ----------------------------------------------------------------------------
-- 3. JSON de solicitud y de renglon
-- ----------------------------------------------------------------------------
-- Igual que en 006 mas channel y, por renglon, id / status / delivered_at.
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
    'channel', q.channel,
    'total_points', q.total_points,
    'created_at', q.created_at,
    'delivered_at', q.delivered_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', rr.id, 'reward_id', rr.reward_id, 'name', rw.name,
                                          'points_spent', rr.points_spent, 'status', rr.status,
                                          'delivered_at', rr.delivered_at)
                       order by rr.reward_id)
      from reward_redemptions rr join rewards rw on rw.id = rr.reward_id
      where rr.request_id = q.id), '[]'::jsonb)
  )
  from redemption_requests q
  where q.id = p_request_id;
$$;

revoke all on function redemption_request_json(uuid) from public, anon, authenticated;

create or replace function redemption_item_json(p_redemption_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', rr.id,
    'request_id', rr.request_id,
    'volunteer_id', rr.volunteer_id,
    'reward_id', rr.reward_id,
    'name', rw.name,
    'points_spent', rr.points_spent,
    'redeemed_at', rr.redeemed_at,
    'status', rr.status,
    'delivered_at', rr.delivered_at
  )
  from reward_redemptions rr join rewards rw on rw.id = rr.reward_id
  where rr.id = p_redemption_id;
$$;

revoke all on function redemption_item_json(uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. redeem_rewards_core: la logica de 006, por volunteer_id y con canal
-- ----------------------------------------------------------------------------
-- p_requested_by: auth.uid() de quien hizo la llamada (voluntario o admin).
-- Codigos: ok | volunteer_not_found | volunteer_inactive | idempotency_conflict
--          | reward_unavailable | insufficient_points
create or replace function redeem_rewards_core(
  p_volunteer_id      uuid,
  p_client_request_id uuid,
  p_reward_ids        uuid[],
  p_requested_by      uuid,
  p_channel           text
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
  v_request_id   uuid;
  v_items        jsonb;
  v_message      text;
  v_reject       jsonb;
  v_by_admin     boolean := p_channel in ('admin', 'admin_card');
begin
  -- 0) Forma de la entrada (la Edge Function ya la valido; segunda barrera).
  if p_volunteer_id is null or p_client_request_id is null
     or p_channel is null or p_channel not in ('volunteer_app', 'admin', 'admin_card') then
    raise exception 'redeem_rewards_core: p_volunteer_id, p_client_request_id y p_channel validos requeridos'
      using errcode = '22023';
  end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_reward_ids) as x;
  if v_ids is null or cardinality(v_ids) = 0
     or array_position(p_reward_ids, null) is not null
     or cardinality(v_ids) <> cardinality(p_reward_ids)
     or cardinality(v_ids) > redemption_max_items() then
    raise exception 'redeem_rewards_core: p_reward_ids debe tener de 1 a % ids distintos y no nulos', redemption_max_items()
      using errcode = '22023';
  end if;

  -- 1) Voluntario bloqueado. Lock #1 (siempre primero): serializa todos los
  --    canjes del mismo voluntario, de cualquier canal, incluidos reintentos.
  select * into v_vol from volunteers where id = p_volunteer_id for update;
  if not found then
    return jsonb_build_object('code', 'volunteer_not_found', 'message', 'El voluntario no existe');
  end if;

  -- 2) Idempotencia (con el lock ya tomado).
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
                               'request_id', v_existing.id, 'channel', p_channel));
    return jsonb_build_object('code', 'idempotency_conflict',
                              'message', 'Ese request_id ya se uso con otras recompensas');
  end if;

  if not v_vol.is_active then
    v_reject := jsonb_build_object('code', 'volunteer_inactive', 'message', 'Voluntario inactivo');
  else
    -- 3) Recompensas bloqueadas en orden de id (lock #2) con costo/stock actuales.
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
      select coalesce(sum(points_cost), 0) into v_total from rewards where id = any(v_ids);
      if v_total > v_vol.points then
        v_reject := jsonb_build_object('code', 'insufficient_points',
                                       'message', case when v_by_admin
                                                       then 'El voluntario no tiene puntos suficientes'
                                                       else 'No tienes puntos suficientes' end,
                                       'required', v_total, 'available', v_vol.points);
      end if;
    end if;
  end if;

  if v_reject is not null then
    insert into audit_logs (event_type, volunteer_id, detail)
    values ('redemption_rejected', v_vol.id,
            jsonb_build_object('reason', v_reject->>'code', 'client_request_id', p_client_request_id,
                               'reward_ids', to_jsonb(v_ids), 'channel', p_channel));
    return v_reject;
  end if;

  -- 4) Escritura, todo en esta transaccion.
  update volunteers set points = points - v_total::integer, updated_at = now()
   where id = v_vol.id;

  update rewards set stock = stock - 1 where id = any(v_ids);

  insert into redemption_requests (volunteer_id, client_request_id, total_points, item_count, requested_by, channel)
  values (v_vol.id, p_client_request_id, v_total::integer, cardinality(v_ids), p_requested_by, p_channel)
  returning id into v_request_id;

  -- Un renglon por recompensa, cada uno con su propio estado de entrega.
  insert into reward_redemptions (volunteer_id, reward_id, points_spent, request_id, status)
  select v_vol.id, r.id, r.points_cost, v_request_id, 'pending_delivery'
  from rewards r where r.id = any(v_ids);

  select jsonb_agg(jsonb_build_object('reward_id', r.id, 'name', r.name, 'points_spent', r.points_cost) order by r.id),
         string_agg(format('%s (%s pts)', r.name, r.points_cost), ', ' order by r.name)
    into v_items, v_message
  from rewards r where r.id = any(v_ids);

  insert into admin_notifications (type, title, message, payload, request_id)
  values (
    'redemption_requested',
    'Canje pendiente de entrega',
    format('%s canjeó: %s. Total: %s pts.', v_vol.full_name, v_message, v_total)
      || case p_channel when 'admin' then ' Registrado por un admin.'
                        when 'admin_card' then ' Registrado por un admin con tarjeta.'
                        else '' end,
    jsonb_build_object('request_id', v_request_id, 'volunteer_id', v_vol.id,
                       'volunteer_name', v_vol.full_name, 'total_points', v_total, 'items', v_items,
                       'channel', p_channel),
    v_request_id
  );

  insert into audit_logs (event_type, volunteer_id, detail)
  values ('redemption_requested', v_vol.id,
          jsonb_build_object('request_id', v_request_id, 'client_request_id', p_client_request_id,
                             'total_points', v_total, 'reward_ids', to_jsonb(v_ids),
                             'channel', p_channel, 'requested_by', p_requested_by));

  return jsonb_build_object(
    'code', 'ok',
    'replayed', false,
    'balance', v_vol.points - v_total,
    'request', redemption_request_json(v_request_id)
  );
end;
$$;

comment on function redeem_rewards_core(uuid, uuid, uuid[], uuid, text) is
  'Logica comun de canje (interna; la llaman redeem_rewards y las variantes de admin).';


-- ----------------------------------------------------------------------------
-- 5. redeem_rewards (006): misma firma, codigos y respuesta
-- ----------------------------------------------------------------------------
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
  v_volunteer_id uuid;
begin
  if p_user_id is null or p_client_request_id is null then
    raise exception 'redeem_rewards: p_user_id y p_client_request_id requeridos' using errcode = '22023';
  end if;

  select id into v_volunteer_id from volunteers where user_id = p_user_id;
  if not found then
    insert into audit_logs (event_type, detail)
    values ('redemption_rejected', jsonb_build_object('reason', 'volunteer_not_linked', 'user_id', p_user_id,
                                                      'client_request_id', p_client_request_id));
    return jsonb_build_object('code', 'volunteer_not_linked', 'message', 'Tu cuenta no esta vinculada a un voluntario');
  end if;

  return redeem_rewards_core(v_volunteer_id, p_client_request_id, p_reward_ids, p_user_id, 'volunteer_app');
end;
$$;

comment on function redeem_rewards(uuid, uuid, uuid[]) is
  'Canje atomico e idempotente de 1..20 recompensas (1 unidad c/u) por el voluntario de la sesion. Codigos: ok | volunteer_not_linked | volunteer_inactive | idempotency_conflict | reward_unavailable | insufficient_points (docs/nfc-contract.md).';


-- ----------------------------------------------------------------------------
-- 6. admin_redeem_rewards: el admin canjea para un voluntario
-- ----------------------------------------------------------------------------
create or replace function admin_redeem_rewards(
  p_volunteer_id      uuid,
  p_client_request_id uuid,
  p_reward_ids        uuid[],
  p_operator_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from volunteers where id = p_volunteer_id) then
    -- volunteer_id en detail: la columna es FK y un id inexistente la violaria.
    insert into audit_logs (event_type, detail)
    values ('redemption_rejected',
            jsonb_build_object('reason', 'volunteer_not_found', 'volunteer_id', p_volunteer_id,
                               'client_request_id', p_client_request_id, 'channel', 'admin',
                               'operator_id', p_operator_id));
    return jsonb_build_object('code', 'volunteer_not_found', 'message', 'El voluntario no existe');
  end if;

  return redeem_rewards_core(p_volunteer_id, p_client_request_id, p_reward_ids, p_operator_id, 'admin');
end;
$$;

comment on function admin_redeem_rewards(uuid, uuid, uuid[], uuid) is
  'El admin canjea 1..20 recompensas para un voluntario. Codigos: ok | volunteer_not_found | volunteer_inactive | idempotency_conflict | reward_unavailable | insufficient_points (docs/nfc-contract.md).';


-- ----------------------------------------------------------------------------
-- 7. Tarjeta -> voluntario (comun a la consulta y al canje con tarjeta)
-- ----------------------------------------------------------------------------
-- Devuelve el volunteer_id de una tarjeta activa, o el rechazo como jsonb.
create or replace function card_volunteer(
  p_uid_hmac    text,
  p_event       text,
  p_operator_id uuid,
  out volunteer_id uuid,
  out reject jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card cards%rowtype;
begin
  if p_uid_hmac is null or p_uid_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'card_volunteer: p_uid_hmac invalido' using errcode = '22023';
  end if;

  select * into v_card from cards where uid_hmac = p_uid_hmac;
  if not found then
    insert into audit_logs (event_type, detail)
    values (p_event || '_card_unknown', jsonb_build_object('operator_id', p_operator_id));
    reject := jsonb_build_object('code', 'card_unknown', 'message', 'Tarjeta no registrada');
    return;
  end if;

  if v_card.status <> 'active' then
    insert into audit_logs (event_type, volunteer_id, detail)
    values (p_event || '_card_inactive', v_card.volunteer_id,
            jsonb_build_object('operator_id', p_operator_id, 'card_status', v_card.status));
    reject := jsonb_build_object('code', 'card_inactive', 'message', 'Tarjeta ' || v_card.status);
    return;
  end if;

  volunteer_id := v_card.volunteer_id;
end;
$$;

revoke all on function card_volunteer(text, text, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 8. lookup_card_volunteer: quien es el dueno de la tarjeta y cuantos puntos tiene
-- ----------------------------------------------------------------------------
-- Codigos: ok | card_unknown | card_inactive | volunteer_inactive
create or replace function lookup_card_volunteer(
  p_uid_hmac    text,
  p_operator_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_card record;
  v_vol  volunteers%rowtype;
begin
  -- stable: no audita los rechazos (card_volunteer si audita, asi que aqui
  -- se repite la busqueda sin escribir).
  if p_uid_hmac is null or p_uid_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'lookup_card_volunteer: p_uid_hmac invalido' using errcode = '22023';
  end if;

  select c.status, c.volunteer_id into v_card from cards c where c.uid_hmac = p_uid_hmac;
  if not found then
    return jsonb_build_object('code', 'card_unknown', 'message', 'Tarjeta no registrada');
  end if;
  if v_card.status <> 'active' then
    return jsonb_build_object('code', 'card_inactive', 'message', 'Tarjeta ' || v_card.status);
  end if;

  select * into v_vol from volunteers where id = v_card.volunteer_id;
  if not v_vol.is_active then
    return jsonb_build_object('code', 'volunteer_inactive', 'message', 'Voluntario inactivo',
                              'volunteer', jsonb_build_object('id', v_vol.id, 'full_name', v_vol.full_name));
  end if;

  return jsonb_build_object(
    'code', 'ok',
    'volunteer', jsonb_build_object(
      'id', v_vol.id,
      'full_name', v_vol.full_name,
      'community', v_vol.community,
      'points', v_vol.points,
      'avatar_url', v_vol.avatar_url
    )
  );
end;
$$;

comment on function lookup_card_volunteer(text, uuid) is
  'Voluntario y saldo de una tarjeta activa (solo lectura). Codigos: ok | card_unknown | card_inactive | volunteer_inactive (docs/nfc-contract.md).';


-- ----------------------------------------------------------------------------
-- 9. admin_redeem_rewards_by_card: el voluntario sale de la tarjeta
-- ----------------------------------------------------------------------------
create or replace function admin_redeem_rewards_by_card(
  p_uid_hmac          text,
  p_client_request_id uuid,
  p_reward_ids        uuid[],
  p_operator_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card record;
begin
  select * into v_card from card_volunteer(p_uid_hmac, 'redemption', p_operator_id);
  if v_card.reject is not null then
    return v_card.reject;
  end if;

  return redeem_rewards_core(v_card.volunteer_id, p_client_request_id, p_reward_ids, p_operator_id, 'admin_card');
end;
$$;

comment on function admin_redeem_rewards_by_card(text, uuid, uuid[], uuid) is
  'El admin canjea para el dueno de una tarjeta activa. Codigos: ok | card_unknown | card_inactive | volunteer_inactive | idempotency_conflict | reward_unavailable | insufficient_points (docs/nfc-contract.md).';


-- ----------------------------------------------------------------------------
-- 10. mark_redemption_item_delivered: entrega UN canje
-- ----------------------------------------------------------------------------
-- Codigos: ok | redemption_not_found. Idempotente.
-- Locks: solicitud y luego renglon, el mismo orden que mark_redemption_delivered.
create or replace function mark_redemption_item_delivered(
  p_redemption_id uuid,
  p_operator_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_item       reward_redemptions%rowtype;
  v_req_status text;
begin
  select request_id into v_request_id from reward_redemptions where id = p_redemption_id;
  if not found then
    insert into audit_logs (event_type, detail)
    values ('deliver_redemption_not_found',
            jsonb_build_object('redemption_id', p_redemption_id, 'operator_id', p_operator_id));
    return jsonb_build_object('code', 'redemption_not_found', 'message', 'El canje no existe');
  end if;

  if v_request_id is not null then
    perform 1 from redemption_requests where id = v_request_id for update;
  end if;
  select * into v_item from reward_redemptions where id = p_redemption_id for update;

  if v_item.status = 'delivered' then
    return jsonb_build_object(
      'code', 'ok',
      'already_delivered', true,
      'redemption', redemption_item_json(p_redemption_id),
      'request_status', (select status from redemption_requests where id = v_request_id)
    );
  end if;

  update reward_redemptions
  set status = 'delivered', delivered_at = now(), delivered_by = p_operator_id
  where id = p_redemption_id;

  -- La solicitud queda entregada solo cuando ya no le queda ningun renglon pendiente.
  if v_request_id is not null then
    update redemption_requests
    set status = 'delivered', delivered_at = now(), delivered_by = p_operator_id
    where id = v_request_id
      and status = 'pending_delivery'
      and not exists (select 1 from reward_redemptions
                      where request_id = v_request_id and status = 'pending_delivery');
    select status into v_req_status from redemption_requests where id = v_request_id;
  end if;

  insert into audit_logs (event_type, volunteer_id, detail)
  values ('redemption_item_delivered', v_item.volunteer_id,
          jsonb_build_object('redemption_id', p_redemption_id, 'request_id', v_request_id,
                             'operator_id', p_operator_id));

  return jsonb_build_object(
    'code', 'ok',
    'already_delivered', false,
    'redemption', redemption_item_json(p_redemption_id),
    'request_status', v_req_status
  );
end;
$$;

comment on function mark_redemption_item_delivered(uuid, uuid) is
  'Marca UN canje (renglon) como entregado; la solicitud queda entregada al no quedar pendientes. Codigos: ok | redemption_not_found (docs/nfc-contract.md).';


-- ----------------------------------------------------------------------------
-- 11. mark_redemption_delivered (006): ahora tambien entrega sus renglones
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

  update reward_redemptions
  set status = 'delivered', delivered_at = now(), delivered_by = p_operator_id
  where request_id = p_request_id and status = 'pending_delivery';

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
  'Marca una solicitud y todos sus renglones pendientes como entregados (idempotente). Codigos: ok | request_not_found (docs/nfc-contract.md).';


-- ----------------------------------------------------------------------------
-- 12. Permisos: solo service_role (las Edge Functions)
-- ----------------------------------------------------------------------------
revoke all on function redeem_rewards_core(uuid, uuid, uuid[], uuid, text) from public, anon, authenticated;
revoke all on function admin_redeem_rewards(uuid, uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function admin_redeem_rewards_by_card(text, uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function lookup_card_volunteer(text, uuid) from public, anon, authenticated;
revoke all on function mark_redemption_item_delivered(uuid, uuid) from public, anon, authenticated;
revoke all on function redeem_rewards(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function mark_redemption_delivered(uuid, uuid) from public, anon, authenticated;

grant execute on function admin_redeem_rewards(uuid, uuid, uuid[], uuid) to service_role;
grant execute on function admin_redeem_rewards_by_card(text, uuid, uuid[], uuid) to service_role;
grant execute on function lookup_card_volunteer(text, uuid) to service_role;
grant execute on function mark_redemption_item_delivered(uuid, uuid) to service_role;
grant execute on function redeem_rewards(uuid, uuid, uuid[]) to service_role;
grant execute on function mark_redemption_delivered(uuid, uuid) to service_role;

commit;
