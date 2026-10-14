-- ============================================================================
-- BAMX · Seguridad NFC: perfiles, tarjetas, check-in idempotente, RLS por rol
--
-- Incremental sobre schema.sql (001) — no lo reescribe, ver nota en su
-- encabezado. Implementa docs/nfc-contract.md:
--   - profiles: rol de cada usuario de Supabase Auth (admin/guard/volunteer).
--   - cards: tarjeta NFC por voluntario, identificada por HMAC del UID (el
--     UID en claro nunca se guarda en la base).
--   - check_ins: event_id para que un check-in NFC nunca se procese dos veces.
--   - register_check_in / enroll_volunteer / issue_card: las 3 funciones
--     SECURITY DEFINER que exponen las Edge Functions (Fase 2), con los
--     codigos de respuesta EXACTOS del contrato.
--   - RLS: las lecturas abiertas ("using (true)") de schema.sql se cierran a
--     sesiones admin/guard; audit_logs queda admin-only.
--
-- Como correrlo (SQL editor de Supabase, en una sola sesion/transaccion):
--   SET app.card_hmac_secret = '<el mismo valor que CARD_UID_HMAC_SECRET
--                                 de las Edge Functions, Fase 2>';
--   -- pega/corre el resto de este archivo --
--
-- Requiere pgcrypto como extensions.hmac(...) (asi la provisiona Supabase
-- por default); no se vuelve a declarar la extension aqui.
--
-- Todo el archivo corre en una sola transaccion (BEGIN/COMMIT explicitos):
-- si el chequeo de app.card_hmac_secret (seccion 4) aborta, nada de lo
-- anterior (profiles, cards, columnas nuevas de check_ins) queda aplicado a
-- medias. Esto importa sobre todo si alguien lo corre con una herramienta
-- que, a diferencia de `psql -v ON_ERROR_STOP=1`, no detiene el script solo
-- porque un statement individual fallo (se detecto asi corriendo
-- supabase/tests/run_tests.sh sin ON_ERROR_STOP).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. profiles — rol de cada usuario autenticado (contrato: admin/guard/volunteer)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin', 'guard', 'volunteer')),
  created_at  timestamptz not null default now()
);

comment on table profiles is 'DS4 - Rol de cada usuario de Supabase Auth. Una fila por auth.users.id.';

alter table profiles enable row level security;

-- Policy obligatoria del contrato: cada usuario autenticado lee SU propia fila.
create policy "profiles_read_own" on profiles
  for select
  using (auth.uid() = id);

-- Sin policies de insert/update/delete a proposito: anon/authenticated no
-- pueden escribir profiles por la API. Las filas las crea el responsable a
-- mano (ver dev_profiles.sql.example) o el backend con service_role.


-- ----------------------------------------------------------------------------
-- 1b. Helpers de rol para las policies de lectura (seccion 7). Se definen
--     aqui porque dependen solo de profiles + auth.uid(), ya creados arriba.
--     SECURITY INVOKER (default) a proposito: corren con los privilegios del
--     que consulta, asi que respetan la policy "profiles_read_own" de arriba
--     en vez de tener que confiar en que estos helpers son correctos.
-- ----------------------------------------------------------------------------
create or replace function is_staff()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'guard')
  );
$$;

create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

comment on function is_staff() is 'true si el usuario autenticado tiene role admin o guard en profiles.';
comment on function is_admin() is 'true si el usuario autenticado tiene role admin en profiles.';


-- ----------------------------------------------------------------------------
-- 2. cards — una tarjeta NFC por voluntario, identificada por HMAC del UID
-- ----------------------------------------------------------------------------
-- Nunca se guarda el UID en claro: uid_hmac = HMAC-SHA256(UID normalizado,
-- secreto compartido con las Edge Functions). Asi, una fuga de la base no
-- expone UIDs clonables directamente (si hiciera falta invalidar todas las
-- tarjetas, basta rotar el secreto).
create table if not exists cards (
  id            uuid primary key default gen_random_uuid(),
  volunteer_id  uuid not null references volunteers(id) on delete cascade,
  uid_hmac      text not null unique,
  status        text not null default 'active'
                  check (status in ('active', 'lost', 'revoked', 'under_review')),
  last_seq      integer not null default 0,
  issued_at     timestamptz not null default now(),
  issued_by     uuid references auth.users(id)
);

comment on table cards is 'DS1 (tarjeta) - HMAC del UID de cada tarjeta NFC y a que voluntario pertenece.';
comment on column cards.uid_hmac is 'HMAC-SHA256(uid normalizado, app.card_hmac_secret), hex. Nunca el UID en claro.';
comment on column cards.last_seq is 'Reservado para un futuro anti-replay por secuencia de la tarjeta; no lo usa ninguna funcion todavia.';

-- Un voluntario no puede tener dos tarjetas 'active' a la vez (issue_card
-- revoca la anterior antes de crear la nueva).
create unique index if not exists idx_cards_one_active_per_volunteer
  on cards (volunteer_id)
  where status = 'active';

create index if not exists idx_cards_volunteer on cards (volunteer_id);

alter table cards enable row level security;

create policy "cards_read_staff" on cards
  for select using (is_staff());

-- Sin policies de insert/update/delete para anon/authenticated: solo las
-- funciones SECURITY DEFINER de la seccion 5 (llamadas con service_role)
-- escriben esta tabla.


-- ----------------------------------------------------------------------------
-- 3. check_ins — columnas para idempotencia y trazabilidad del check-in NFC
-- ----------------------------------------------------------------------------
-- terminal_id ya existia en schema.sql (001); se reutiliza tal cual — ahora
-- lo puebla register_check_in en vez del default 'terminal-recepcion-1'.
alter table check_ins add column if not exists event_id uuid;
alter table check_ins add column if not exists operator_id uuid references auth.users(id);
alter table check_ins add column if not exists client_ts timestamptz;

-- Backfill de las filas que ya existan (p.ej. las del seed) antes de poner
-- las restricciones NOT NULL / UNIQUE.
update check_ins set event_id = gen_random_uuid() where event_id is null;
update check_ins set client_ts = checked_in_at where client_ts is null;

alter table check_ins alter column event_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'check_ins_event_id_key'
  ) then
    alter table check_ins add constraint check_ins_event_id_key unique (event_id);
  end if;
end $$;

comment on column check_ins.event_id is 'UUID que manda el cliente; garantiza que un check-in NFC no se procese dos veces (ver register_check_in).';
comment on column check_ins.operator_id is 'auth.uid() de quien opero el check-in (guard/admin autenticado).';
comment on column check_ins.client_ts is 'Hora que reporta el cliente/terminal al momento del check-in (usada para stale_event/invalid_ts y el tope diario).';


-- ----------------------------------------------------------------------------
-- 4. Backfill: volunteers.nfc_uid -> cards (como HMAC), y se elimina la
--    columna (cambio destructivo autorizado).
-- ----------------------------------------------------------------------------
do $$
begin
  if current_setting('app.card_hmac_secret', true) is null
     or current_setting('app.card_hmac_secret', true) = '' then
    raise exception
      'app.card_hmac_secret no esta definido. Antes de correr esta migracion: '
      'SET app.card_hmac_secret = ''<el mismo valor que CARD_UID_HMAC_SECRET '
      'de las Edge Functions>''; y vuelve a correrla.';
  end if;
end $$;

-- Normaliza igual que el contrato (docs/nfc-contract.md): quita separadores
-- " :-_.", MAYUSCULAS, y solo admite 8, 14 o 20 hex. Los que no cumplan NO
-- generan tarjeta (se omiten con NOTICE; el voluntario queda sin tarjeta y
-- hay que emitirle una con issue_card).
do $$
declare
  r        record;
  v_uid    text;
begin
  for r in select id, nfc_uid from volunteers where nfc_uid is not null loop
    v_uid := upper(regexp_replace(r.nfc_uid, '[ :._-]', '', 'g'));
    if length(v_uid) not in (8, 14, 20) or v_uid !~ '^[0-9A-F]+$' then
      raise notice 'backfill: nfc_uid con formato no admitido (longitud % o no hex), se omite la tarjeta del volunteer_id %',
        length(v_uid), r.id;
      continue;
    end if;

    insert into cards (volunteer_id, uid_hmac, status, issued_at)
    values (
      r.id,
      encode(extensions.hmac(v_uid, current_setting('app.card_hmac_secret'), 'sha256'), 'hex'),
      'active',
      now()
    )
    on conflict (uid_hmac) do nothing;
  end loop;
end $$;

alter table volunteers drop column if exists nfc_uid;


-- ----------------------------------------------------------------------------
-- 5. Funciones SECURITY DEFINER del contrato (register_check_in,
--    enroll_volunteer, issue_card). search_path fijo para que no se pueda
--    secuestrar con un schema/objeto creado a proposito con esos nombres.
-- ----------------------------------------------------------------------------

-- Tope diario de check-ins por voluntario. Constante centralizada aqui para
-- poder cambiarla sin tocar register_check_in.
create or replace function nfc_daily_checkin_limit()
returns integer
language sql
immutable
as $$ select 1; $$;

comment on function nfc_daily_checkin_limit() is 'Maximo de check-ins validos por voluntario por dia calendario (America/Mexico_City). Cambiar aqui, no en register_check_in.';

-- register_check_in: idempotente por event_id; valida tarjeta/voluntario/
-- frescura/tope diario; si todo pasa, inserta en check_ins y deja que el
-- trigger fn_apply_checkin (ya existente en schema.sql) calcule puntos y
-- total_visits.
create or replace function register_check_in(
  p_event_id    uuid,
  p_uid_hmac    text,
  p_terminal_id text,
  p_operator_id uuid,
  p_client_ts   timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing      check_ins%rowtype;
  v_card          cards%rowtype;
  v_volunteer     volunteers%rowtype;
  v_today_count   integer;
  v_new_id        uuid;
  v_points        integer;
  v_visit_number  integer;
begin
  -- 1) Idempotencia por event_id: si ya se proceso, regresa el resultado
  --    original. Nunca vuelve a insertar ni a otorgar puntos dos veces.
  select * into v_existing from check_ins where event_id = p_event_id;
  if found then
    select * into v_volunteer from volunteers where id = v_existing.volunteer_id;
    return jsonb_build_object(
      'code', 'duplicate_event',
      'points_awarded', v_existing.points_awarded,
      'volunteer', jsonb_build_object(
        'id', v_volunteer.id,
        'full_name', v_volunteer.full_name,
        'points', v_volunteer.points,
        'total_visits', v_volunteer.total_visits
      )
    );
  end if;

  -- 2) Frescura del evento (hora que reporta el cliente/terminal, no now()).
  if p_client_ts is null then
    return jsonb_build_object('code', 'invalid_ts', 'message', 'client_ts requerido');
  elsif p_client_ts > now() + interval '5 minutes' then
    return jsonb_build_object('code', 'invalid_ts', 'message', 'client_ts esta en el futuro');
  elsif p_client_ts < now() - interval '48 hours' then
    return jsonb_build_object('code', 'stale_event', 'message', 'client_ts tiene mas de 48 horas de antiguedad');
  end if;

  -- 3) Tarjeta conocida y activa.
  select * into v_card from cards where uid_hmac = p_uid_hmac;
  if not found then
    insert into audit_logs (event_type, terminal_id, detail)
    values ('checkin_card_unknown', p_terminal_id, jsonb_build_object('event_id', p_event_id));
    return jsonb_build_object('code', 'card_unknown', 'message', 'Tarjeta no registrada');
  end if;

  if v_card.status <> 'active' then
    insert into audit_logs (event_type, volunteer_id, terminal_id, detail)
    values (
      'checkin_card_inactive', v_card.volunteer_id, p_terminal_id,
      jsonb_build_object('event_id', p_event_id, 'card_status', v_card.status)
    );
    return jsonb_build_object('code', 'card_inactive', 'message', 'Tarjeta ' || v_card.status);
  end if;

  -- 4) Voluntario activo.
  select * into v_volunteer from volunteers where id = v_card.volunteer_id;
  if not found or not v_volunteer.is_active then
    insert into audit_logs (event_type, volunteer_id, terminal_id, detail)
    values ('checkin_volunteer_inactive', v_card.volunteer_id, p_terminal_id, jsonb_build_object('event_id', p_event_id));
    return jsonb_build_object('code', 'volunteer_inactive', 'message', 'Voluntario inactivo');
  end if;

  -- 4b) Deriva de reloj: si la hora del cliente difiere de la del servidor
  --     mas de 10 minutos se deja rastro en audit_logs, pero NO se rechaza
  --     (el rechazo por antiguedad/futuro ya lo hace el paso 2).
  if abs(extract(epoch from (p_client_ts - now()))) > 600 then
    insert into audit_logs (event_type, volunteer_id, terminal_id, detail)
    values (
      'clock_drift', v_volunteer.id, p_terminal_id,
      jsonb_build_object(
        'event_id', p_event_id,
        'drift_seconds', round(extract(epoch from (p_client_ts - now())))
      )
    );
  end if;

  -- 5) Tope diario (dia calendario America/Mexico_City, segun el contrato).
  select count(*) into v_today_count
  from check_ins
  where volunteer_id = v_volunteer.id
    and status = 'valid'
    and (checked_in_at at time zone 'America/Mexico_City')::date
      = (p_client_ts at time zone 'America/Mexico_City')::date;

  if v_today_count >= nfc_daily_checkin_limit() then
    insert into audit_logs (event_type, volunteer_id, terminal_id, detail)
    values ('checkin_daily_limit', v_volunteer.id, p_terminal_id, jsonb_build_object('event_id', p_event_id));
    return jsonb_build_object('code', 'daily_limit', 'message', 'Ya se registro un check-in hoy');
  end if;

  -- 6) Insertar. El trigger fn_apply_checkin calcula points_awarded,
  --    visit_number y actualiza volunteers.points/total_visits/last_check_in_at.
  insert into check_ins (
    volunteer_id, terminal_id, status, event_id, operator_id, client_ts, checked_in_at
  ) values (
    v_volunteer.id, p_terminal_id, 'valid', p_event_id, p_operator_id, p_client_ts, p_client_ts
  )
  returning id, points_awarded, visit_number into v_new_id, v_points, v_visit_number;

  select * into v_volunteer from volunteers where id = v_volunteer.id;

  return jsonb_build_object(
    'code', 'ok',
    'points_awarded', v_points,
    'volunteer', jsonb_build_object(
      'id', v_volunteer.id,
      'full_name', v_volunteer.full_name,
      'points', v_volunteer.points,
      'total_visits', v_volunteer.total_visits
    )
  );
end;
$$;

comment on function register_check_in(uuid, text, text, uuid, timestamptz) is
  'Check-in NFC idempotente por event_id. Codigos: ok | duplicate_event | daily_limit | card_unknown | card_inactive | volunteer_inactive | stale_event | invalid_ts (docs/nfc-contract.md).';

-- enroll_volunteer: crea voluntario + tarjeta en una sola operacion atomica.
create or replace function enroll_volunteer(
  p_full_name   text,
  p_community   text,
  p_uid_hmac    text,
  p_operator_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_volunteer_id uuid;
begin
  if exists (select 1 from cards where uid_hmac = p_uid_hmac) then
    insert into audit_logs (event_type, detail)
    values ('enroll_card_in_use', jsonb_build_object('operator_id', p_operator_id));
    return jsonb_build_object('code', 'card_in_use', 'message', 'La tarjeta ya esta asignada a otro voluntario');
  end if;

  -- Sub-bloque: si el insert en cards falla por una condicion de carrera
  -- (dos enroll_volunteer con el mismo uid_hmac a la vez), el EXCEPTION
  -- revierte TAMBIEN el insert en volunteers de aqui abajo (mismo subbloque),
  -- para no dejar un voluntario huerfano sin tarjeta.
  begin
    insert into volunteers (full_name, community)
    values (p_full_name, coalesce(p_community, ''))
    returning id into v_volunteer_id;

    insert into cards (volunteer_id, uid_hmac, status, issued_at, issued_by)
    values (v_volunteer_id, p_uid_hmac, 'active', now(), p_operator_id);
  exception when unique_violation then
    insert into audit_logs (event_type, detail)
    values ('enroll_card_in_use', jsonb_build_object('operator_id', p_operator_id, 'race', true));
    return jsonb_build_object('code', 'card_in_use', 'message', 'La tarjeta ya esta asignada a otro voluntario');
  end;

  return jsonb_build_object(
    'code', 'ok',
    'volunteer', jsonb_build_object(
      'id', v_volunteer_id,
      'full_name', p_full_name,
      'community', coalesce(p_community, '')
    )
  );
end;
$$;

comment on function enroll_volunteer(text, text, text, uuid) is
  'Alta de voluntario + tarjeta en una transaccion. Codigos: ok | card_in_use (docs/nfc-contract.md).';

-- issue_card: revoca la tarjeta activa previa del voluntario (si existe) y
-- emite la nueva. Deja como maximo una tarjeta 'active' por voluntario
-- (reforzado tambien por el indice parcial unico de la seccion 2).
create or replace function issue_card(
  p_volunteer_id uuid,
  p_uid_hmac     text,
  p_operator_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_card_id  uuid;
  v_new_card_id  uuid;
  v_revoked_prev boolean := false;
begin
  if not exists (select 1 from volunteers where id = p_volunteer_id) then
    insert into audit_logs (event_type, volunteer_id, detail)
    values ('issue_card_volunteer_not_found', p_volunteer_id, jsonb_build_object('operator_id', p_operator_id));
    return jsonb_build_object('code', 'volunteer_not_found', 'message', 'El voluntario no existe');
  end if;

  if exists (select 1 from cards where uid_hmac = p_uid_hmac) then
    insert into audit_logs (event_type, volunteer_id, detail)
    values ('issue_card_in_use', p_volunteer_id, jsonb_build_object('operator_id', p_operator_id));
    return jsonb_build_object('code', 'card_in_use', 'message', 'La tarjeta ya esta asignada a otro voluntario');
  end if;

  -- Mismo motivo que en enroll_volunteer: si el insert final choca por una
  -- condicion de carrera, el EXCEPTION revierte tambien el revoke de arriba.
  begin
    select id into v_old_card_id from cards
      where volunteer_id = p_volunteer_id and status = 'active';

    if v_old_card_id is not null then
      update cards set status = 'revoked' where id = v_old_card_id;
      v_revoked_prev := true;
    end if;

    insert into cards (volunteer_id, uid_hmac, status, issued_at, issued_by)
    values (p_volunteer_id, p_uid_hmac, 'active', now(), p_operator_id)
    returning id into v_new_card_id;
  exception when unique_violation then
    insert into audit_logs (event_type, volunteer_id, detail)
    values ('issue_card_in_use', p_volunteer_id, jsonb_build_object('operator_id', p_operator_id, 'race', true));
    return jsonb_build_object('code', 'card_in_use', 'message', 'La tarjeta ya esta asignada a otro voluntario');
  end;

  if v_revoked_prev then
    insert into audit_logs (event_type, volunteer_id, detail)
    values (
      'issue_card_revoked_previous', p_volunteer_id,
      jsonb_build_object('old_card_id', v_old_card_id, 'new_card_id', v_new_card_id, 'operator_id', p_operator_id)
    );
  end if;

  return jsonb_build_object(
    'code', 'ok',
    'card_id', v_new_card_id,
    'revoked_previous', v_revoked_prev
  );
end;
$$;

comment on function issue_card(uuid, text, uuid) is
  'Emite/reemplaza la tarjeta de un voluntario, revocando la activa previa. Codigos: ok | card_in_use | volunteer_not_found (docs/nfc-contract.md).';


-- ----------------------------------------------------------------------------
-- 6. Permisos: las 3 funciones del contrato solo las ejecuta service_role
--    (las Edge Functions). audit_logs queda append-only incluso para
--    service_role (que tiene BYPASSRLS: sin este REVOKE a nivel de tabla,
--    podria editar/borrar el historial directamente).
-- ----------------------------------------------------------------------------
revoke all on function register_check_in(uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function enroll_volunteer(text, text, text, uuid) from public, anon, authenticated;
revoke all on function issue_card(uuid, text, uuid) from public, anon, authenticated;

grant execute on function register_check_in(uuid, text, text, uuid, timestamptz) to service_role;
grant execute on function enroll_volunteer(text, text, text, uuid) to service_role;
grant execute on function issue_card(uuid, text, uuid) to service_role;

revoke update, delete on audit_logs from public, anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 7. RLS: reemplaza las lecturas abiertas ("using (true)", sin sesion) de
--    schema.sql por lecturas que exigen admin/guard (is_staff) o solo admin
--    (audit_logs y reward_redemptions). Ninguna policy de lectura queda
--    abierta a anon.
-- ----------------------------------------------------------------------------
drop policy if exists "volunteers_read" on volunteers;
create policy "volunteers_read_staff" on volunteers
  for select using (is_staff());

drop policy if exists "check_ins_read" on check_ins;
create policy "check_ins_read_staff" on check_ins
  for select using (is_staff());

drop policy if exists "rewards_read" on rewards;
create policy "rewards_read_staff" on rewards
  for select using (is_staff());

drop policy if exists "audit_logs_read" on audit_logs;
create policy "audit_logs_read_admin" on audit_logs
  for select using (is_admin());

drop policy if exists "point_tiers_read" on point_tiers;
create policy "point_tiers_read_staff" on point_tiers
  for select using (is_staff());

drop policy if exists "reward_redemptions_read" on reward_redemptions;
create policy "reward_redemptions_read_admin" on reward_redemptions
  for select using (is_admin());

-- Nota: profiles ya quedo con su propia policy ("profiles_read_own") en la
-- seccion 1 — es la forma en que "el voluntario lee su propia fila" segun el
-- contrato (volunteers no tiene columna que la ligue a auth.users).

commit;
