-- ============================================================================
-- BAMX · Alta de voluntario + cuenta de acceso (admin)
--
-- Incremental sobre 005_volunteer_accounts.sql (usa volunteers.user_id); 005
-- requiere 002. No toca enroll_volunteer ni su contrato.
--
-- Supabase Auth y Postgres NO comparten transaccion, asi que el alta es una
-- maquina de estados con idempotencia (volunteer_registrations):
--
--   1. begin_volunteer_registration  -> 'pending' (o un conflicto / el
--      resultado ya registrado). Comprueba email y tarjeta ANTES de que la
--      Edge Function cree la cuenta.
--   2. La Edge Function crea la cuenta con auth.admin.createUser y
--      app_metadata.bamx_registration_id = id de la solicitud. Esa marca es
--      la que permite reconocer en un reintento que la cuenta es NUESTRA.
--   3. complete_volunteer_registration (una transaccion): profiles (rol
--      'volunteer', fijo aqui), volunteers con user_id, cards, auditoria y
--      solicitud 'completed'.
--   Si 3 falla por un conflicto (tarjeta tomada en carrera), la solicitud
--   queda 'failed' con el id de la cuenta para que la Edge Function la borre
--   (compensacion). Si la Edge Function se cae entre 2 y 3, reintentar con el
--   mismo client_request_id encuentra la cuenta marcada y continua.
--
-- Nunca se guardan contrasenas: viajan de la Edge Function a Supabase Auth.
-- volunteer_registrations guarda el email (para reconocer el reintento) pero
-- no lo copia a audit_logs.
--
-- No necesita app.card_hmac_secret y se puede correr mas de una vez.
-- Como correrlo: SQL editor de Supabase, pegar/correr este archivo completo.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. volunteer_registrations
-- ----------------------------------------------------------------------------
create table if not exists volunteer_registrations (
  id                 uuid primary key default gen_random_uuid(),
  client_request_id  uuid not null unique,
  status             text not null default 'pending'
                       check (status in ('pending', 'completed', 'failed')),
  email              text not null check (email = lower(email)),
  full_name          text not null,
  community          text not null,
  uid_hmac           text not null,
  operator_id        uuid references auth.users(id) on delete set null,
  -- Cuenta de Auth creada por esta solicitud (se conoce al completar o al
  -- fallar despues de crearla). Sin FK: si se borra la cuenta, el registro
  -- historico se queda.
  auth_user_id       uuid,
  volunteer_id       uuid references volunteers(id) on delete restrict,
  card_id            uuid references cards(id) on delete restrict,
  failure_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,
  constraint volunteer_registrations_completed_consistent
    check ((status = 'completed') = (volunteer_id is not null and auth_user_id is not null and completed_at is not null))
);

comment on table volunteer_registrations is
  'Alta de voluntario + cuenta de Auth en curso o terminada. Permite reintentar sin duplicar. Nunca guarda contrasenas.';

-- Sin policies: ningun cliente la lee ni la escribe (solo service_role).
alter table volunteer_registrations enable row level security;
revoke all on volunteer_registrations from anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. Helpers internos
-- ----------------------------------------------------------------------------
-- Cuenta de Auth con ese email: la nuestra (marcada con este registro) o una ajena.
create or replace function registration_account(p_registration_id uuid, p_email text,
                                                out own_user_id uuid, out foreign_user_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select u.id from auth.users u
      where lower(u.email) = p_email
        and u.raw_app_meta_data->>'bamx_registration_id' = p_registration_id::text),
    (select u.id from auth.users u
      where lower(u.email) = p_email
        and u.raw_app_meta_data->>'bamx_registration_id' is distinct from p_registration_id::text
      limit 1);
$$;

revoke all on function registration_account(uuid, text) from public, anon, authenticated;

create or replace function registration_result(r volunteer_registrations, p_replayed boolean)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'code', 'ok',
    'replayed', p_replayed,
    'registration_id', r.id,
    'volunteer', jsonb_build_object('id', v.id, 'full_name', v.full_name, 'community', v.community,
                                    'user_id', v.user_id),
    'account', jsonb_build_object('user_id', r.auth_user_id, 'email', r.email),
    'card_id', r.card_id
  )
  from volunteers v where v.id = r.volunteer_id;
$$;

revoke all on function registration_result(volunteer_registrations, boolean) from public, anon, authenticated;

-- Solo se pide borrar (compensar) una cuenta creada por la solicitud que sigue
-- "limpia": sin profile y sin voluntario vinculado. Si alguien ya le asigno un
-- rol o un vinculo a mano, no se borra: queda para revision manual.
create or replace function registration_cleanup_target(p_auth_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_auth_user_id
  where p_auth_user_id is not null
    and not exists (select 1 from profiles where id = p_auth_user_id)
    and not exists (select 1 from volunteers where user_id = p_auth_user_id);
$$;

revoke all on function registration_cleanup_target(uuid) from public, anon, authenticated;

-- Marca 'failed' y audita (sin email ni contrasena). Devuelve el jsonb de negocio;
-- incluye cleanup_auth_user_id solo si la cuenta se puede borrar sin riesgo.
create or replace function registration_fail(p_registration_id uuid, p_reason text, p_message text,
                                             p_auth_user_id uuid, p_operator_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
begin
  update volunteer_registrations
  set status = 'failed', failure_reason = p_reason,
      auth_user_id = coalesce(p_auth_user_id, auth_user_id), updated_at = now()
  where id = p_registration_id;

  insert into audit_logs (event_type, detail)
  values ('volunteer_registration_failed',
          jsonb_build_object('registration_id', p_registration_id, 'reason', p_reason,
                             'operator_id', p_operator_id, 'account_created', p_auth_user_id is not null));

  v_target := registration_cleanup_target(p_auth_user_id);
  return jsonb_build_object('code', p_reason, 'message', p_message, 'registration_id', p_registration_id)
         || case when v_target is not null
                 then jsonb_build_object('cleanup_auth_user_id', v_target) else '{}'::jsonb end;
end;
$$;

revoke all on function registration_fail(uuid, text, text, uuid, uuid) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. begin_volunteer_registration
-- ----------------------------------------------------------------------------
-- Codigos: pending { registration_id, own_auth_user_id } | ok (replay de un
-- alta ya completada) | idempotency_conflict | email_in_use | card_in_use
-- (+ cleanup_auth_user_id si ya existe una cuenta nuestra que hay que borrar).
-- Una solicitud 'failed' NO es terminal: reintentarla con los mismos datos
-- vuelve a evaluar todo (p. ej. tras corregir una contrasena debil).
create or replace function begin_volunteer_registration(
  p_client_request_id uuid,
  p_email             text,
  p_uid_hmac          text,
  p_full_name         text,
  p_community         text,
  p_operator_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email     text := lower(btrim(p_email));
  v_name      text := btrim(p_full_name);
  v_community text := btrim(p_community);
  v_reg       volunteer_registrations%rowtype;
  v_acct      record;
begin
  if p_client_request_id is null or v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or length(v_email) > 254 or p_uid_hmac is null or p_uid_hmac !~ '^[0-9a-f]{64}$'
     or v_name is null or v_name = '' or length(v_name) > 120
     or v_community is null or v_community = '' or length(v_community) > 120 then
    raise exception 'begin_volunteer_registration: parametros invalidos' using errcode = '22023';
  end if;

  insert into volunteer_registrations (client_request_id, email, full_name, community, uid_hmac, operator_id)
  values (p_client_request_id, v_email, v_name, v_community, p_uid_hmac, p_operator_id)
  on conflict (client_request_id) do nothing;

  -- Lock de la solicitud: los reintentos concurrentes del mismo
  -- client_request_id se serializan aqui y en complete.
  select * into v_reg from volunteer_registrations where client_request_id = p_client_request_id for update;

  if (v_reg.email, v_reg.uid_hmac, v_reg.full_name, v_reg.community)
     is distinct from (v_email, p_uid_hmac, v_name, v_community) then
    return jsonb_build_object('code', 'idempotency_conflict',
                              'message', 'Ese client_request_id ya se uso con otros datos');
  end if;

  if v_reg.status = 'completed' then
    return registration_result(v_reg, true);
  end if;

  select * into v_acct from registration_account(v_reg.id, v_email);

  if v_acct.foreign_user_id is not null then
    -- La cuenta es de alguien mas: nunca se toca ni se vincula.
    return registration_fail(v_reg.id, 'email_in_use', 'Ese email ya pertenece a una cuenta',
                             v_acct.own_user_id, p_operator_id);
  end if;

  if exists (select 1 from cards where uid_hmac = p_uid_hmac) then
    return registration_fail(v_reg.id, 'card_in_use', 'La tarjeta ya esta asignada a otro voluntario',
                             v_acct.own_user_id, p_operator_id);
  end if;

  update volunteer_registrations
  set status = 'pending', failure_reason = null, updated_at = now()
  where id = v_reg.id;

  return jsonb_build_object('code', 'pending', 'registration_id', v_reg.id,
                            'own_auth_user_id', v_acct.own_user_id);
end;
$$;

comment on function begin_volunteer_registration(uuid, text, text, text, text, uuid) is
  'Paso 1 del alta con cuenta: registra/recupera la solicitud y revisa email y tarjeta antes de crear la cuenta de Auth.';


-- ----------------------------------------------------------------------------
-- 4. complete_volunteer_registration (una transaccion)
-- ----------------------------------------------------------------------------
-- Codigos: ok | card_in_use (+ cleanup_auth_user_id: la Edge Function debe
-- borrar esa cuenta) | account_conflict (la cuenta ya tiene rol o vinculo: NO
-- se borra, revision manual) | registration_not_pending.
create or replace function complete_volunteer_registration(
  p_registration_id uuid,
  p_auth_user_id    uuid,
  p_operator_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reg        volunteer_registrations%rowtype;
  v_acct       record;
  v_role       text;
  v_vol_id     uuid;
  v_card_id    uuid;
  v_constraint text;
begin
  select * into v_reg from volunteer_registrations where id = p_registration_id for update;
  if not found then
    raise exception 'complete_volunteer_registration: registro inexistente' using errcode = '22023';
  end if;

  if v_reg.status = 'completed' then
    if v_reg.auth_user_id = p_auth_user_id then
      return registration_result(v_reg, true);
    end if;
    raise exception 'complete_volunteer_registration: ya completado con otra cuenta' using errcode = '22023';
  end if;
  if v_reg.status <> 'pending' then
    return jsonb_build_object('code', 'registration_not_pending', 'message', 'La solicitud no esta en curso',
                              'registration_id', v_reg.id);
  end if;

  -- La cuenta debe ser exactamente la que creo ESTA solicitud.
  select * into v_acct from registration_account(v_reg.id, v_reg.email);
  if v_acct.own_user_id is distinct from p_auth_user_id then
    raise exception 'complete_volunteer_registration: la cuenta no corresponde a esta solicitud'
      using errcode = '22023';
  end if;

  select role into v_role from profiles where id = p_auth_user_id;
  if (v_role is not null and v_role <> 'volunteer')
     or exists (select 1 from volunteers where user_id = p_auth_user_id) then
    return registration_fail(v_reg.id, 'account_conflict', 'La cuenta ya tiene otro rol o vinculo',
                             p_auth_user_id, p_operator_id);
  end if;

  if exists (select 1 from cards where uid_hmac = v_reg.uid_hmac) then
    return registration_fail(v_reg.id, 'card_in_use', 'La tarjeta ya esta asignada a otro voluntario',
                             p_auth_user_id, p_operator_id);
  end if;

  -- Sub-bloque: si otra sesion inserta la misma tarjeta en paralelo, el UNIQUE
  -- revierte TODO lo de aqui adentro (profile, voluntario) y se marca failed.
  begin
    insert into profiles (id, role) values (p_auth_user_id, 'volunteer')
    on conflict (id) do nothing;

    insert into volunteers (full_name, community, user_id)
    values (v_reg.full_name, v_reg.community, p_auth_user_id)
    returning id into v_vol_id;

    insert into cards (volunteer_id, uid_hmac, status, issued_at, issued_by)
    values (v_vol_id, v_reg.uid_hmac, 'active', now(), p_operator_id)
    returning id into v_card_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'cards_uid_hmac_key' then
      return registration_fail(v_reg.id, 'card_in_use', 'La tarjeta ya esta asignada a otro voluntario',
                               p_auth_user_id, p_operator_id);
    elsif v_constraint = 'volunteers_user_id_key' then
      return registration_fail(v_reg.id, 'account_conflict', 'La cuenta ya tiene otro rol o vinculo',
                               p_auth_user_id, p_operator_id);
    end if;
    raise;
  end;

  update volunteer_registrations
  set status = 'completed', auth_user_id = p_auth_user_id, volunteer_id = v_vol_id, card_id = v_card_id,
      failure_reason = null, completed_at = now(), updated_at = now()
  where id = v_reg.id
  returning * into v_reg;

  -- Sin email ni contrasena en la auditoria.
  insert into audit_logs (event_type, volunteer_id, detail)
  values ('volunteer_registered', v_vol_id,
          jsonb_build_object('registration_id', v_reg.id, 'auth_user_id', p_auth_user_id,
                             'card_id', v_card_id, 'operator_id', p_operator_id));

  return registration_result(v_reg, false);
end;
$$;

comment on function complete_volunteer_registration(uuid, uuid, uuid) is
  'Paso 3 del alta con cuenta: profile volunteer + voluntario vinculado + tarjeta en una transaccion. Codigos: ok | card_in_use | account_conflict | registration_not_pending.';


-- ----------------------------------------------------------------------------
-- 5. fail_volunteer_registration: la Edge Function la llama cuando Auth
--    rechaza la cuenta (contrasena debil, email invalido) para dejar la
--    solicitud 'failed'. Reintentar con los mismos datos la reabre.
-- ----------------------------------------------------------------------------
create or replace function fail_volunteer_registration(
  p_registration_id uuid,
  p_reason          text,
  p_operator_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if p_reason not in ('weak_password', 'invalid_email') then
    raise exception 'fail_volunteer_registration: motivo no admitido' using errcode = '22023';
  end if;
  select status into v_status from volunteer_registrations where id = p_registration_id for update;
  if v_status is distinct from 'pending' then
    return jsonb_build_object('code', 'registration_not_pending', 'registration_id', p_registration_id);
  end if;
  return registration_fail(p_registration_id, p_reason,
                           case p_reason when 'weak_password' then 'La contrasena no cumple la politica de Supabase Auth'
                                         else 'Supabase Auth rechazo el email' end,
                           null, p_operator_id);
end;
$$;


-- ----------------------------------------------------------------------------
-- 6. Solo service_role (la Edge Function register-volunteer-account).
-- ----------------------------------------------------------------------------
revoke all on function begin_volunteer_registration(uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function complete_volunteer_registration(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function fail_volunteer_registration(uuid, text, uuid) from public, anon, authenticated;

grant execute on function begin_volunteer_registration(uuid, text, text, text, text, uuid) to service_role;
grant execute on function complete_volunteer_registration(uuid, uuid, uuid) to service_role;
grant execute on function fail_volunteer_registration(uuid, text, uuid) to service_role;

commit;
