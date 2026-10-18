-- ============================================================================
-- Casos de prueba de 008_fix_issue_card.sql. Se corre despues de
-- 60_volunteer_registration_cases.sql, sobre la misma base. La comparacion
-- "sin 008 falla / con 008 funciona" esta en run_tests.sh [2d].
-- ============================================================================

create table if not exists test_results_008 (
  seq        serial primary key,
  case_name  text not null,
  status     text not null check (status in ('PASS', 'FAIL')),
  detail     text
);

insert into auth.users (id, email) values ('a8000000-0000-0000-0000-0000000000ad', 'issue-admin@test.local');
insert into volunteers (id, full_name, community) values
  ('b8000000-0000-0000-0000-000000000001', 'Issue Uno', 'x');

create or replace function pg_temp.h(p text) returns text language sql as
  $$ select encode(extensions.hmac(p, current_setting('app.card_hmac_secret'), 'sha256'), 'hex') $$;

-- ----------------------------------------------------------------------------
-- Caso 1: voluntario inexistente -> volunteer_not_found (antes: error de FK)
-- ----------------------------------------------------------------------------
do $$
declare
  v_h   text := pg_temp.h('DD800001');
  v_r   jsonb;
  v_aud audit_logs%rowtype;
  v_n   integer;
begin
  set role service_role;
  v_r := issue_card('b8000000-0000-0000-0000-0000000000ff', v_h, 'a8000000-0000-0000-0000-0000000000ad');
  reset role;
  select * into v_aud from audit_logs
   where event_type = 'issue_card_volunteer_not_found'
     and detail->>'volunteer_id' = 'b8000000-0000-0000-0000-0000000000ff';
  select count(*) into v_n from cards where uid_hmac = v_h;

  insert into test_results_008 (case_name, status, detail) values (
    'voluntario inexistente -> {code: volunteer_not_found, message} exactamente como el contrato',
    case when v_r = '{"code": "volunteer_not_found", "message": "El voluntario no existe"}'::jsonb
         then 'PASS' else 'FAIL' end, v_r::text);
  insert into test_results_008 (case_name, status, detail) values (
    'auditoria con el id intentado en detail (columna volunteer_id null) y operator_id; sin tarjeta creada',
    case when v_aud.id is not null and v_aud.volunteer_id is null
          and v_aud.detail = '{"volunteer_id": "b8000000-0000-0000-0000-0000000000ff", "operator_id": "a8000000-0000-0000-0000-0000000000ad"}'::jsonb
          and v_n = 0
         then 'PASS' else 'FAIL' end, coalesce(v_aud.detail::text, 'sin fila'));
exception when others then
  reset role;
  insert into test_results_008 (case_name, status, detail) values ('voluntario inexistente', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 2: primera tarjeta de un voluntario existente (sin cambios)
-- ----------------------------------------------------------------------------
do $$
declare
  v_h  text := pg_temp.h('DD800002');
  v_r  jsonb;
  v_c  cards%rowtype;
begin
  set role service_role;
  v_r := issue_card('b8000000-0000-0000-0000-000000000001', v_h, 'a8000000-0000-0000-0000-0000000000ad');
  reset role;
  select * into v_c from cards where uid_hmac = v_h;
  insert into test_results_008 (case_name, status, detail) values (
    'primera tarjeta: {code ok, card_id, revoked_previous false}, activa y con issued_by',
    case when v_r - 'card_id' = '{"code": "ok", "revoked_previous": false}'::jsonb
          and (v_r->>'card_id')::uuid = v_c.id and v_c.status = 'active'
          and v_c.volunteer_id = 'b8000000-0000-0000-0000-000000000001'
          and v_c.issued_by = 'a8000000-0000-0000-0000-0000000000ad'
         then 'PASS' else 'FAIL' end, v_r::text);
exception when others then
  reset role;
  insert into test_results_008 (case_name, status, detail) values ('primera tarjeta', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 3: reemplazo normal: revoca la activa previa, una sola activa, auditado
-- ----------------------------------------------------------------------------
do $$
declare
  v_old  uuid := (select id from cards where uid_hmac = pg_temp.h('DD800002'));
  v_h    text := pg_temp.h('DD800003');
  v_r    jsonb;
  v_act  integer;
  v_oldst text;
  v_aud  integer;
begin
  set role service_role;
  v_r := issue_card('b8000000-0000-0000-0000-000000000001', v_h, 'a8000000-0000-0000-0000-0000000000ad');
  reset role;
  select count(*) into v_act from cards where volunteer_id = 'b8000000-0000-0000-0000-000000000001' and status = 'active';
  select status into v_oldst from cards where id = v_old;
  select count(*) into v_aud from audit_logs
   where event_type = 'issue_card_revoked_previous'
     and volunteer_id = 'b8000000-0000-0000-0000-000000000001'
     and detail->>'old_card_id' = v_old::text and detail->>'new_card_id' = v_r->>'card_id';
  insert into test_results_008 (case_name, status, detail) values (
    'reemplazo: ok revoked_previous true, la anterior revoked, 1 sola activa, auditado',
    case when v_r->>'code' = 'ok' and (v_r->>'revoked_previous')::boolean
          and v_oldst = 'revoked' and v_act = 1 and v_aud = 1
          and (select uid_hmac from cards where id = (v_r->>'card_id')::uuid) = v_h
         then 'PASS' else 'FAIL' end,
    format('r=%s activa=%s anterior=%s aud=%s', v_r, v_act, v_oldst, v_aud));
exception when others then
  reset role;
  insert into test_results_008 (case_name, status, detail) values ('reemplazo', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 4: tarjeta ya usada -> card_in_use, sin tocar la activa (sin cambios)
-- ----------------------------------------------------------------------------
do $$
declare
  v_active uuid := (select id from cards where volunteer_id = 'b8000000-0000-0000-0000-000000000001' and status = 'active');
  v_r jsonb;
  v_h text := pg_temp.h('DD800002'); -- la ya revocada: sigue "en uso" (uid_hmac unico)
begin
  set role service_role;
  v_r := issue_card('b8000000-0000-0000-0000-000000000001', v_h, null);
  reset role;
  insert into test_results_008 (case_name, status, detail) values (
    'tarjeta ya usada (aunque este revocada) -> card_in_use; la activa no cambia',
    case when v_r = '{"code": "card_in_use", "message": "La tarjeta ya esta asignada a otro voluntario"}'::jsonb
          and (select status from cards where id = v_active) = 'active'
         then 'PASS' else 'FAIL' end, v_r::text);
exception when others then
  reset role;
  insert into test_results_008 (case_name, status, detail) values ('card_in_use', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 5: permisos sin cambios (solo service_role)
-- ----------------------------------------------------------------------------
do $$
declare v_role text; v_ok boolean;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    v_ok := false;
    begin
      execute format('set role %I', v_role);
      perform issue_card('b8000000-0000-0000-0000-000000000001', repeat('a', 64), null);
      reset role;
    exception when insufficient_privilege then v_ok := true; reset role;
    end;
    insert into test_results_008 (case_name, status, detail)
    values (format('%s no puede ejecutar issue_card', v_role), case when v_ok then 'PASS' else 'FAIL' end, null);
  end loop;
end;
$$;


-- ============================================================================
-- Reporte final
-- ============================================================================
select seq, case_name, status, detail from test_results_008 order by seq;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail
from test_results_008;

do $$
declare
  v_fail_count integer;
begin
  select count(*) into v_fail_count from test_results_008 where status = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% caso(s) de 008 en FAIL — ver tabla de arriba', v_fail_count;
  end if;
end;
$$;
