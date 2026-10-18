-- ============================================================================
-- Casos de prueba de 007_volunteer_registration.sql. Se corre despues de
-- 50_redemptions_cases.sql, sobre la misma base. "Crear la cuenta de Auth"
-- se simula como lo hace auth.admin.createUser: una fila en auth.users con
-- raw_app_meta_data.bamx_registration_id. La concurrencia esta en
-- run_tests.sh [1e]. Un DO block por caso, una fila en test_results_007.
-- ============================================================================

create table if not exists test_results_007 (
  seq        serial primary key,
  case_name  text not null,
  status     text not null check (status in ('PASS', 'FAIL')),
  detail     text
);

insert into auth.users (id, email) values
  ('a7100000-0000-0000-0000-0000000000ad', 'reg-admin@test.local'),
  ('a7100000-0000-0000-0000-0000000000ee', 'ya-existe@test.local');
insert into profiles (id, role) values ('a7100000-0000-0000-0000-0000000000ad', 'admin');

-- Atajos.
create or replace function pg_temp.h(p text) returns text language sql as
  $$ select encode(extensions.hmac(p, current_setting('app.card_hmac_secret'), 'sha256'), 'hex') $$;
-- Simula auth.admin.createUser({ email, app_metadata: { bamx_registration_id } }).
create or replace function pg_temp.create_auth_user(p_id uuid, p_email text, p_reg uuid) returns void language sql as
  $$ insert into auth.users (id, email, raw_app_meta_data)
     values (p_id, p_email, jsonb_build_object('bamx_registration_id', p_reg::text)) $$;
create or replace function pg_temp.begin_reg(p_crid uuid, p_email text, p_uid text, p_name text default 'Reg Nueva')
  returns jsonb language plpgsql as $$
declare r jsonb; v_h text := pg_temp.h(p_uid);
begin
  set local role service_role;
  r := begin_volunteer_registration(p_crid, p_email, v_h, p_name, 'Centro',
                                    'a7100000-0000-0000-0000-0000000000ad');
  reset role;
  return r;
end $$;
create or replace function pg_temp.complete_reg(p_reg uuid, p_auth uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r := complete_volunteer_registration(p_reg, p_auth, 'a7100000-0000-0000-0000-0000000000ad');
  reset role;
  return r;
end $$;

-- ----------------------------------------------------------------------------
-- Caso 1: camino feliz: begin -> (cuenta) -> complete
-- ----------------------------------------------------------------------------
do $$
declare
  v_b jsonb; v_c jsonb; v_reg uuid;
  v_vol volunteers%rowtype; v_card cards%rowtype; v_role text; v_r volunteer_registrations%rowtype;
  v_aud jsonb;
begin
  v_b := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000001', '  Nueva.Uno@Test.Local ', 'AA000001');
  v_reg := (v_b->>'registration_id')::uuid;
  perform pg_temp.create_auth_user('a7200000-0000-0000-0000-000000000001', 'nueva.uno@test.local', v_reg);
  v_c := pg_temp.complete_reg(v_reg, 'a7200000-0000-0000-0000-000000000001');

  select * into v_vol from volunteers where user_id = 'a7200000-0000-0000-0000-000000000001';
  select * into v_card from cards where volunteer_id = v_vol.id;
  select role into v_role from profiles where id = 'a7200000-0000-0000-0000-000000000001';
  select * into v_r from volunteer_registrations where id = v_reg;
  select detail into v_aud from audit_logs where event_type = 'volunteer_registered' and volunteer_id = v_vol.id;

  insert into test_results_007 (case_name, status, detail) values (
    'begin: pending sin cuenta propia todavia; email normalizado',
    case when v_b->>'code' = 'pending' and v_b->'own_auth_user_id' = 'null'::jsonb
          and v_r.email = 'nueva.uno@test.local' then 'PASS' else 'FAIL' end, v_b::text);
  insert into test_results_007 (case_name, status, detail) values (
    'complete: voluntario vinculado, tarjeta activa, profile volunteer, solicitud completed',
    case when v_c->>'code' = 'ok' and (v_c->>'replayed')::boolean = false
          and v_vol.full_name = 'Reg Nueva' and v_vol.community = 'Centro' and v_vol.points = 0 and v_vol.is_active
          and v_card.uid_hmac = pg_temp.h('AA000001') and v_card.status = 'active'
          and v_card.issued_by = 'a7100000-0000-0000-0000-0000000000ad'
          and v_role = 'volunteer' and v_r.status = 'completed' and v_r.volunteer_id = v_vol.id
          and v_c->'account'->>'email' = 'nueva.uno@test.local'
         then 'PASS' else 'FAIL' end, v_c::text);
  insert into test_results_007 (case_name, status, detail) values (
    'auditoria volunteer_registered sin email ni contrasena',
    case when v_aud ?& array['registration_id', 'auth_user_id', 'card_id', 'operator_id']
          and v_aud::text !~* '(email|password|contrase|@test\.local)'
         then 'PASS' else 'FAIL' end, v_aud::text);
exception when others then
  insert into test_results_007 (case_name, status, detail) values ('camino feliz', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 2: reintentos despues de completar no duplican nada
-- ----------------------------------------------------------------------------
do $$
declare
  v_b jsonb; v_c jsonb; v_vols integer; v_cards integer; v_regs integer;
begin
  v_b := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000001', 'nueva.uno@test.local', 'AA000001');
  v_c := pg_temp.complete_reg((v_b->>'registration_id')::uuid, 'a7200000-0000-0000-0000-000000000001');
  select count(*) into v_vols from volunteers where user_id = 'a7200000-0000-0000-0000-000000000001';
  select count(*) into v_cards from cards where uid_hmac = pg_temp.h('AA000001');
  select count(*) into v_regs from volunteer_registrations where client_request_id = 'e7000000-0000-4000-8000-000000000001';
  insert into test_results_007 (case_name, status, detail) values (
    'reintento tras completar: begin y complete responden ok replayed; 1 voluntario, 1 tarjeta, 1 solicitud',
    case when v_b->>'code' = 'ok' and (v_b->>'replayed')::boolean and v_c->>'code' = 'ok' and (v_c->>'replayed')::boolean
          and v_vols = 1 and v_cards = 1 and v_regs = 1 then 'PASS' else 'FAIL' end,
    format('begin=%s complete=%s', v_b->>'code', v_c->>'code'));
exception when others then
  insert into test_results_007 (case_name, status, detail) values ('reintento tras completar', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 3: mismo client_request_id con otros datos -> idempotency_conflict
-- ----------------------------------------------------------------------------
do $$
declare v_r jsonb;
begin
  v_r := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000001', 'otra@test.local', 'AA000001');
  insert into test_results_007 (case_name, status, detail) values (
    'mismo client_request_id con otro email -> idempotency_conflict',
    case when v_r->>'code' = 'idempotency_conflict' then 'PASS' else 'FAIL' end, v_r::text);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 4: email que ya es de otra cuenta -> email_in_use; no se toca la cuenta
-- ----------------------------------------------------------------------------
do $$
declare v_r jsonb; v_reg volunteer_registrations%rowtype; v_meta jsonb; v_prof integer;
begin
  v_r := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000002', 'YA-EXISTE@test.local', 'AA000002');
  select * into v_reg from volunteer_registrations where client_request_id = 'e7000000-0000-4000-8000-000000000002';
  select raw_app_meta_data into v_meta from auth.users where id = 'a7100000-0000-0000-0000-0000000000ee';
  select count(*) into v_prof from profiles where id = 'a7100000-0000-0000-0000-0000000000ee';
  insert into test_results_007 (case_name, status, detail) values (
    'email de una cuenta existente -> email_in_use; sin cleanup, cuenta intacta y sin rol ni vinculo',
    case when v_r->>'code' = 'email_in_use' and not (v_r ? 'cleanup_auth_user_id')
          and v_reg.status = 'failed' and v_meta = '{}'::jsonb and v_prof = 0
          and not exists (select 1 from volunteers where user_id = 'a7100000-0000-0000-0000-0000000000ee')
          and not exists (select 1 from cards where uid_hmac = pg_temp.h('AA000002'))
         then 'PASS' else 'FAIL' end, v_r::text);
  -- Tambien con el email de una cuenta de voluntario ya registrada por otra solicitud.
  v_r := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000003', 'nueva.uno@test.local', 'AA000003');
  insert into test_results_007 (case_name, status, detail) values (
    'email de un voluntario registrado por otra solicitud -> email_in_use',
    case when v_r->>'code' = 'email_in_use' then 'PASS' else 'FAIL' end, v_r::text);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 5: tarjeta ya asignada -> card_in_use antes de crear la cuenta
-- ----------------------------------------------------------------------------
do $$
declare v_r jsonb;
begin
  v_r := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000004', 'tarjeta.repetida@test.local', 'AA000001');
  insert into test_results_007 (case_name, status, detail) values (
    'tarjeta ya asignada -> card_in_use en begin (sin cuenta que limpiar)',
    case when v_r->>'code' = 'card_in_use' and not (v_r ? 'cleanup_auth_user_id')
          and not exists (select 1 from auth.users where email = 'tarjeta.repetida@test.local')
         then 'PASS' else 'FAIL' end, v_r::text);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 6: falla DESPUES de crear la cuenta (no se llego a complete): el
-- reintento reconoce la cuenta propia y termina sin duplicar
-- ----------------------------------------------------------------------------
do $$
declare v_b1 jsonb; v_b2 jsonb; v_c jsonb; v_reg uuid; v_vols integer; v_users integer;
begin
  v_b1 := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000005', 'caida@test.local', 'AA000005');
  v_reg := (v_b1->>'registration_id')::uuid;
  perform pg_temp.create_auth_user('a7200000-0000-0000-0000-000000000005', 'caida@test.local', v_reg);
  -- ... aqui "se cae" la Edge Function. Reintento:
  v_b2 := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000005', 'caida@test.local', 'AA000005');
  v_c  := pg_temp.complete_reg(v_reg, (v_b2->>'own_auth_user_id')::uuid);
  select count(*) into v_vols from volunteers where user_id = 'a7200000-0000-0000-0000-000000000005';
  select count(*) into v_users from auth.users where email = 'caida@test.local';
  insert into test_results_007 (case_name, status, detail) values (
    'falla tras crear la cuenta: el reintento devuelve own_auth_user_id y completa; 1 cuenta, 1 voluntario',
    case when v_b2->>'code' = 'pending' and v_b2->>'own_auth_user_id' = 'a7200000-0000-0000-0000-000000000005'
          and v_c->>'code' = 'ok' and v_vols = 1 and v_users = 1
         then 'PASS' else 'FAIL' end,
    format('b2=%s c=%s', v_b2, v_c->>'code'));
exception when others then
  insert into test_results_007 (case_name, status, detail) values ('falla tras crear la cuenta', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 7: la tarjeta se ocupa ENTRE begin y complete -> card_in_use con
-- cleanup_auth_user_id; no queda voluntario, profile ni tarjeta a medias
-- ----------------------------------------------------------------------------
do $$
declare v_b jsonb; v_c jsonb; v_reg uuid; v_r volunteer_registrations%rowtype; v_retry jsonb; v_h6 text;
begin
  v_b := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000006', 'carrera@test.local', 'AA000006');
  v_reg := (v_b->>'registration_id')::uuid;
  perform pg_temp.create_auth_user('a7200000-0000-0000-0000-000000000006', 'carrera@test.local', v_reg);
  -- Otro admin enrola esa misma tarjeta con enroll_volunteer mientras tanto.
  v_h6 := pg_temp.h('AA000006');
  set role service_role;
  perform enroll_volunteer('Gano la tarjeta', 'x', v_h6, null);
  reset role;
  v_c := pg_temp.complete_reg(v_reg, 'a7200000-0000-0000-0000-000000000006');
  select * into v_r from volunteer_registrations where id = v_reg;

  insert into test_results_007 (case_name, status, detail) values (
    'tarjeta tomada en carrera: complete -> card_in_use + cleanup_auth_user_id; nada a medias',
    case when v_c->>'code' = 'card_in_use'
          and v_c->>'cleanup_auth_user_id' = 'a7200000-0000-0000-0000-000000000006'
          and v_r.status = 'failed' and v_r.auth_user_id = 'a7200000-0000-0000-0000-000000000006'
          and not exists (select 1 from profiles where id = 'a7200000-0000-0000-0000-000000000006')
          and not exists (select 1 from volunteers where user_id = 'a7200000-0000-0000-0000-000000000006')
         then 'PASS' else 'FAIL' end, v_c::text);

  -- Si el borrado de la cuenta fallo, un reintento vuelve a pedir el cleanup.
  v_retry := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000006', 'carrera@test.local', 'AA000006');
  insert into test_results_007 (case_name, status, detail) values (
    'reintento sin haber borrado la cuenta: card_in_use y vuelve a pedir el cleanup',
    case when v_retry->>'code' = 'card_in_use'
          and v_retry->>'cleanup_auth_user_id' = 'a7200000-0000-0000-0000-000000000006'
         then 'PASS' else 'FAIL' end, v_retry::text);

  -- Ya borrada la cuenta (como hace la Edge Function), el reintento ya no pide cleanup.
  delete from auth.users where id = 'a7200000-0000-0000-0000-000000000006';
  v_retry := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000006', 'carrera@test.local', 'AA000006');
  insert into test_results_007 (case_name, status, detail) values (
    'tras borrar la cuenta, el reintento es card_in_use sin cleanup',
    case when v_retry->>'code' = 'card_in_use' and not (v_retry ? 'cleanup_auth_user_id')
         then 'PASS' else 'FAIL' end, v_retry::text);
exception when others then
  reset role;
  insert into test_results_007 (case_name, status, detail) values ('tarjeta en carrera', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 8: complete con una cuenta que NO es la de esta solicitud aborta
-- (ajena, o de otra solicitud) y no crea nada
-- ----------------------------------------------------------------------------
do $$
declare v_b jsonb; v_reg uuid; v_state1 text := 'sin error'; v_state2 text := 'sin error';
begin
  v_b := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000007', 'ajena.prueba@test.local', 'AA000007');
  v_reg := (v_b->>'registration_id')::uuid;
  begin
    perform pg_temp.complete_reg(v_reg, 'a7100000-0000-0000-0000-0000000000ee');
  exception when others then v_state1 := sqlstate; reset role;
  end;
  begin
    perform pg_temp.complete_reg(v_reg, 'a7200000-0000-0000-0000-000000000005');
  exception when others then v_state2 := sqlstate; reset role;
  end;
  insert into test_results_007 (case_name, status, detail) values (
    'complete con cuenta ajena o de otra solicitud -> 22023, sin vinculo ni profile nuevo',
    case when v_state1 = '22023' and v_state2 = '22023'
          and not exists (select 1 from profiles where id = 'a7100000-0000-0000-0000-0000000000ee')
          and (select count(*) from volunteers where user_id = 'a7200000-0000-0000-0000-000000000005') = 1
         then 'PASS' else 'FAIL' end,
    format('ajena=%s otra=%s', v_state1, v_state2));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 9: cuenta propia que ya tiene otro rol -> account_conflict (+ cleanup)
-- ----------------------------------------------------------------------------
do $$
declare v_b jsonb; v_c jsonb; v_reg uuid;
begin
  v_b := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000008', 'rol.raro@test.local', 'AA000008');
  v_reg := (v_b->>'registration_id')::uuid;
  perform pg_temp.create_auth_user('a7200000-0000-0000-0000-000000000008', 'rol.raro@test.local', v_reg);
  insert into profiles (id, role) values ('a7200000-0000-0000-0000-000000000008', 'guard');
  v_c := pg_temp.complete_reg(v_reg, 'a7200000-0000-0000-0000-000000000008');
  insert into test_results_007 (case_name, status, detail) values (
    'cuenta con otro rol -> account_conflict SIN cleanup (no se borra una cuenta con rol); el rol no se cambia',
    case when v_c->>'code' = 'account_conflict' and not (v_c ? 'cleanup_auth_user_id')
          and (select role from profiles where id = 'a7200000-0000-0000-0000-000000000008') = 'guard'
          and not exists (select 1 from cards where uid_hmac = pg_temp.h('AA000008'))
         then 'PASS' else 'FAIL' end, v_c::text);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 9b: cuenta propia "limpia" vs. modificada a mano: solo la limpia se
-- ofrece para borrar en un reintento con conflicto de tarjeta
-- ----------------------------------------------------------------------------
do $$
declare v_b jsonb; v_reg uuid; v_r1 jsonb; v_r2 jsonb; v_h text := pg_temp.h('AA00009B');
begin
  v_b := pg_temp.begin_reg('e7000000-0000-4000-8000-00000000009b', 'modificada@test.local', 'AA00009B');
  v_reg := (v_b->>'registration_id')::uuid;
  perform pg_temp.create_auth_user('a7200000-0000-0000-0000-00000000009b', 'modificada@test.local', v_reg);
  set role service_role;
  perform enroll_volunteer('Tomo la 9B', 'x', v_h, null);
  reset role;
  v_r1 := pg_temp.begin_reg('e7000000-0000-4000-8000-00000000009b', 'modificada@test.local', 'AA00009B');
  insert into profiles (id, role) values ('a7200000-0000-0000-0000-00000000009b', 'admin'); -- alguien la promovio
  v_r2 := pg_temp.begin_reg('e7000000-0000-4000-8000-00000000009b', 'modificada@test.local', 'AA00009B');
  insert into test_results_007 (case_name, status, detail) values (
    'card_in_use: cuenta propia limpia -> cleanup; misma cuenta ya con rol -> sin cleanup',
    case when v_r1->>'code' = 'card_in_use' and v_r1->>'cleanup_auth_user_id' = 'a7200000-0000-0000-0000-00000000009b'
          and v_r2->>'code' = 'card_in_use' and not (v_r2 ? 'cleanup_auth_user_id')
         then 'PASS' else 'FAIL' end,
    format('r1=%s r2=%s', v_r1, v_r2));
exception when others then
  reset role;
  insert into test_results_007 (case_name, status, detail) values ('cleanup solo de cuentas limpias', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 10: Auth rechaza la contrasena -> fail_volunteer_registration; el
-- mismo client_request_id se puede reintentar despues
-- ----------------------------------------------------------------------------
do $$
declare v_b jsonb; v_f jsonb; v_b2 jsonb; v_c jsonb; v_reg uuid; v_bad text := 'sin error';
begin
  v_b := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000009', 'debil@test.local', 'AA000009');
  v_reg := (v_b->>'registration_id')::uuid;
  set role service_role;
  v_f := fail_volunteer_registration(v_reg, 'weak_password', 'a7100000-0000-0000-0000-0000000000ad');
  begin
    perform fail_volunteer_registration(v_reg, 'card_in_use', null);
  exception when others then v_bad := sqlstate;
  end;
  reset role;
  v_b2 := pg_temp.begin_reg('e7000000-0000-4000-8000-000000000009', 'debil@test.local', 'AA000009');
  perform pg_temp.create_auth_user('a7200000-0000-0000-0000-000000000009', 'debil@test.local', v_reg);
  v_c := pg_temp.complete_reg(v_reg, 'a7200000-0000-0000-0000-000000000009');
  insert into test_results_007 (case_name, status, detail) values (
    'contrasena debil: failed sin cuenta; reintento con el mismo id vuelve a pending y completa',
    case when v_f->>'code' = 'weak_password' and v_bad = '22023'
          and v_b2->>'code' = 'pending' and v_c->>'code' = 'ok'
         then 'PASS' else 'FAIL' end,
    format('f=%s motivo_invalido=%s b2=%s c=%s', v_f->>'code', v_bad, v_b2->>'code', v_c->>'code'));
exception when others then
  reset role;
  insert into test_results_007 (case_name, status, detail) values ('contrasena debil', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 11: entradas invalidas en begin -> 22023
-- ----------------------------------------------------------------------------
do $$
declare v_i integer; v_state text; v_bad text := ''; v_hff text := pg_temp.h('AA0000FF');
begin
  for v_i in 1 .. 6 loop
    v_state := 'sin error';
    begin
      set role service_role;
      case v_i
        when 1 then perform begin_volunteer_registration(null, 'a@b.co', v_hff, 'N', 'C', null);
        when 2 then perform begin_volunteer_registration(gen_random_uuid(), 'sin-arroba', v_hff, 'N', 'C', null);
        when 3 then perform begin_volunteer_registration(gen_random_uuid(), 'a@b.co', 'AA0000FF', 'N', 'C', null); -- uid en claro, no hmac
        when 4 then perform begin_volunteer_registration(gen_random_uuid(), 'a@b.co', v_hff, '  ', 'C', null);
        when 5 then perform begin_volunteer_registration(gen_random_uuid(), 'a@b.co', v_hff, 'N', repeat('c', 121), null);
        when 6 then perform begin_volunteer_registration(gen_random_uuid(), repeat('a', 250) || '@b.co', v_hff, 'N', 'C', null);
      end case;
      reset role;
    exception when others then v_state := sqlstate; reset role;
    end;
    if v_state <> '22023' then v_bad := v_bad || format('[%s: %s] ', v_i, v_state); end if;
  end loop;
  insert into test_results_007 (case_name, status, detail) values (
    'begin rechaza id nulo, email invalido o >254, uid sin HMAC, nombre/comunidad vacios o largos (22023)',
    case when v_bad = '' then 'PASS' else 'FAIL' end, coalesce(nullif(v_bad, ''), 'todas 22023'));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 12: permisos: ningun cliente (ni un admin con sesion) ejecuta las
-- funciones ni lee volunteer_registrations
-- ----------------------------------------------------------------------------
do $$
declare v_role text; v_what text; v_ok boolean;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_what in array array['begin', 'complete', 'fail', 'select', 'insert'] loop
      v_ok := false;
      begin
        execute format('set role %I', v_role);
        perform set_config('request.jwt.claim.role', v_role, false);
        perform set_config('request.jwt.claim.sub',
          case when v_role = 'authenticated' then 'a7100000-0000-0000-0000-0000000000ad' else '' end, false);
        case v_what
          when 'begin' then perform begin_volunteer_registration(gen_random_uuid(), 'x@y.co', repeat('a', 64), 'N', 'C', null);
          when 'complete' then perform complete_volunteer_registration(gen_random_uuid(), gen_random_uuid(), null);
          when 'fail' then perform fail_volunteer_registration(gen_random_uuid(), 'weak_password', null);
          when 'select' then perform 1 from volunteer_registrations;
          when 'insert' then
            insert into volunteer_registrations (client_request_id, email, full_name, community, uid_hmac)
            values (gen_random_uuid(), 'x@y.co', 'N', 'C', repeat('a', 64));
        end case;
        reset role;
      exception when insufficient_privilege then v_ok := true; reset role;
      end;
      perform set_config('request.jwt.claim.sub', '', false);
      perform set_config('request.jwt.claim.role', '', false);
      insert into test_results_007 (case_name, status, detail)
      values (format('%s no puede %s', case when v_role = 'authenticated' then 'admin con sesion (authenticated)' else 'anon' end, v_what),
              case when v_ok then 'PASS' else 'FAIL' end, null);
    end loop;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 13: compatibilidad: enroll_volunteer, el voluntario nuevo y la RLS de
-- la 005 siguen funcionando igual
-- ----------------------------------------------------------------------------
do $$
declare v_e jsonb; v_seen integer; v_ci jsonb; v_he1 text := pg_temp.h('AA0000E1'); v_h1 text := pg_temp.h('AA000001');
begin
  set role service_role;
  v_e := enroll_volunteer('Enroll Clasico', 'x', v_he1, 'a7100000-0000-0000-0000-0000000000ad');
  v_ci := register_check_in(gen_random_uuid(), v_h1, 'term-007', null, now());
  reset role;

  set role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'a7200000-0000-0000-0000-000000000001', false);
  select count(*) into v_seen from volunteers;
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);

  insert into test_results_007 (case_name, status, detail) values (
    'enroll_volunteer sigue respondiendo su contrato (ok, sin cuenta)',
    case when v_e->>'code' = 'ok' and v_e->'volunteer' ? 'id'
          and (select user_id from volunteers where id = (v_e->'volunteer'->>'id')::uuid) is null
         then 'PASS' else 'FAIL' end, v_e::text);
  insert into test_results_007 (case_name, status, detail) values (
    'el voluntario registrado hace check-in por NFC y con su sesion ve solo su fila',
    case when v_ci->>'code' = 'ok' and (v_ci->'volunteer'->>'points')::int = 10 and v_seen = 1
         then 'PASS' else 'FAIL' end, format('check_in=%s visibles=%s', v_ci->>'code', v_seen));
exception when others then
  reset role;
  insert into test_results_007 (case_name, status, detail) values ('compatibilidad', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ============================================================================
-- Reporte final
-- ============================================================================
select seq, case_name, status, detail from test_results_007 order by seq;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail
from test_results_007;

do $$
declare
  v_fail_count integer;
begin
  select count(*) into v_fail_count from test_results_007 where status = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% caso(s) de 007 en FAIL — ver tabla de arriba', v_fail_count;
  end if;
end;
$$;
