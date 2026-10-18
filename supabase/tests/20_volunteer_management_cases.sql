-- ============================================================================
-- Casos de prueba de 003_volunteer_management.sql (update_volunteer y
-- deactivate_volunteer). Se corre despues de 10_test_cases.sql, sobre la
-- misma base (ver run_tests.sh). Misma convencion que 10_test_cases.sql: un
-- DO block por caso, una fila en test_results_003 por aserción.
-- ============================================================================

create table if not exists test_results_003 (
  seq        serial primary key,
  case_name  text not null,
  status     text not null check (status in ('PASS', 'FAIL')),
  detail     text
);

-- Voluntarios propios de estos casos (ids fijos para aserciones deterministas).
insert into volunteers (id, full_name, community, points, total_visits) values
  ('d0000000-0000-0000-0000-000000000001', 'Ana Original', 'Centro', 120, 7),
  ('d0000000-0000-0000-0000-000000000002', 'Beto Desactivar', 'Zapopan', 0, 0),
  ('d0000000-0000-0000-0000-000000000003', 'Caro CheckIn', 'Tlaquepaque', 0, 0);

insert into cards (volunteer_id, uid_hmac) values (
  'd0000000-0000-0000-0000-000000000003',
  encode(extensions.hmac('DD000003', current_setting('app.card_hmac_secret'), 'sha256'), 'hex')
);

-- ----------------------------------------------------------------------------
-- Caso 1: update de solo full_name (con espacios) -> ok, recorta, no toca el resto
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_v   volunteers%rowtype;
  v_aud integer;
begin
  set role service_role;
  v_r := update_volunteer('d0000000-0000-0000-0000-000000000001', '  Ana Editada  ', null,
                          'a0000000-0000-0000-0000-0000000000ad');
  reset role;

  select * into v_v from volunteers where id = 'd0000000-0000-0000-0000-000000000001';
  select count(*) into v_aud from audit_logs
   where event_type = 'volunteer_updated'
     and volunteer_id = 'd0000000-0000-0000-0000-000000000001'
     and detail = '{"operator_id": "a0000000-0000-0000-0000-0000000000ad", "changed_fields": ["full_name"]}'::jsonb;

  insert into test_results_003 (case_name, status, detail) values (
    'update_volunteer solo full_name: ok, recorta y deja community/points/visitas/is_active',
    case when v_r->>'code' = 'ok'
          and v_r->'changed_fields' = '["full_name"]'::jsonb
          and v_r->'volunteer'->>'full_name' = 'Ana Editada'
          and v_v.full_name = 'Ana Editada' and v_v.community = 'Centro'
          and v_v.points = 120 and v_v.total_visits = 7 and v_v.is_active
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_r));

  insert into test_results_003 (case_name, status, detail) values (
    'update_volunteer audita volunteer_updated con operator_id y solo nombres de campos',
    case when v_aud = 1 then 'PASS' else 'FAIL' end,
    format('filas=%s', v_aud));
exception when others then
  reset role;
  insert into test_results_003 (case_name, status, detail) values ('update_volunteer solo full_name', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 2: update de ambos campos
-- ----------------------------------------------------------------------------
do $$
declare
  v_r jsonb;
  v_v volunteers%rowtype;
begin
  set role service_role;
  v_r := update_volunteer('d0000000-0000-0000-0000-000000000001', 'Ana Dos', 'Tonalá', null);
  reset role;
  select * into v_v from volunteers where id = 'd0000000-0000-0000-0000-000000000001';

  insert into test_results_003 (case_name, status, detail) values (
    'update_volunteer full_name + community',
    case when v_r->>'code' = 'ok'
          and v_r->'changed_fields' = '["full_name", "community"]'::jsonb
          and v_v.full_name = 'Ana Dos' and v_v.community = 'Tonalá'
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_r));
exception when others then
  reset role;
  insert into test_results_003 (case_name, status, detail) values ('update_volunteer full_name + community', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 3: update con los mismos valores -> ok, changed_fields vacio, sin auditoria
-- ----------------------------------------------------------------------------
do $$
declare
  v_r      jsonb;
  v_before integer;
  v_after  integer;
begin
  select count(*) into v_before from audit_logs where event_type = 'volunteer_updated';
  set role service_role;
  v_r := update_volunteer('d0000000-0000-0000-0000-000000000001', 'Ana Dos', 'Tonalá', null);
  reset role;
  select count(*) into v_after from audit_logs where event_type = 'volunteer_updated';

  insert into test_results_003 (case_name, status, detail) values (
    'update_volunteer sin cambios reales: ok, changed_fields [] y no audita',
    case when v_r->>'code' = 'ok' and v_r->'changed_fields' = '[]'::jsonb and v_after = v_before
         then 'PASS' else 'FAIL' end,
    format('r=%s antes=%s despues=%s', v_r, v_before, v_after));
exception when others then
  reset role;
  insert into test_results_003 (case_name, status, detail) values ('update_volunteer sin cambios', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 4: update de un voluntario inexistente -> volunteer_not_found (sin
-- violar la FK de audit_logs.volunteer_id)
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_aud integer;
begin
  set role service_role;
  v_r := update_volunteer('d0000000-0000-0000-0000-0000000000ff', 'Nadie', null, null);
  reset role;
  select count(*) into v_aud from audit_logs
   where event_type = 'update_volunteer_not_found'
     and volunteer_id is null
     and detail->>'volunteer_id' = 'd0000000-0000-0000-0000-0000000000ff';

  insert into test_results_003 (case_name, status, detail) values (
    'update_volunteer inexistente -> volunteer_not_found + audit_logs (id en detail)',
    case when v_r->>'code' = 'volunteer_not_found' and v_aud = 1 then 'PASS' else 'FAIL' end,
    format('r=%s filas=%s', v_r, v_aud));
exception when others then
  reset role;
  insert into test_results_003 (case_name, status, detail) values ('update_volunteer inexistente', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 5: entradas invalidas abortan con 22023 (segunda barrera tras la Edge
-- Function) y no modifican la fila
-- ----------------------------------------------------------------------------
do $$
declare
  v_inputs text[][] := array[
    array[null, null],
    array['   ', null],
    array[null, ''],
    array[repeat('x', 121), null],
    array[null, repeat('x', 121)]
  ];
  v_i     integer;
  v_state text;
  v_bad   text := '';
  v_v     volunteers%rowtype;
begin
  for v_i in 1 .. array_length(v_inputs, 1) loop
    v_state := 'sin error';
    begin
      set role service_role;
      perform update_volunteer('d0000000-0000-0000-0000-000000000001', v_inputs[v_i][1], v_inputs[v_i][2], null);
      reset role;
    exception when others then
      v_state := sqlstate;
      reset role;
    end;
    if v_state <> '22023' then
      v_bad := v_bad || format('[%s: %s] ', v_i, v_state);
    end if;
  end loop;

  select * into v_v from volunteers where id = 'd0000000-0000-0000-0000-000000000001';

  insert into test_results_003 (case_name, status, detail) values (
    'update_volunteer rechaza ambos null, vacios y >120 caracteres (22023) sin modificar',
    case when v_bad = '' and v_v.full_name = 'Ana Dos' and v_v.community = 'Tonalá' then 'PASS' else 'FAIL' end,
    coalesce(nullif(v_bad, ''), 'todas 22023'));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 6: deactivate -> ok, is_active=false, auditoria
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_act boolean;
  v_aud integer;
begin
  set role service_role;
  v_r := deactivate_volunteer('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000ad');
  reset role;
  select is_active into v_act from volunteers where id = 'd0000000-0000-0000-0000-000000000002';
  select count(*) into v_aud from audit_logs
   where event_type = 'volunteer_deactivated'
     and volunteer_id = 'd0000000-0000-0000-0000-000000000002'
     and detail->>'operator_id' = 'a0000000-0000-0000-0000-0000000000ad';

  insert into test_results_003 (case_name, status, detail) values (
    'deactivate_volunteer: ok, already_inactive=false, is_active=false y audita',
    case when v_r->>'code' = 'ok' and (v_r->>'already_inactive')::boolean = false
          and (v_r->'volunteer'->>'is_active')::boolean = false
          and v_act = false and v_aud = 1
         then 'PASS' else 'FAIL' end,
    format('r=%s is_active=%s filas=%s', v_r, v_act, v_aud));
exception when others then
  reset role;
  insert into test_results_003 (case_name, status, detail) values ('deactivate_volunteer', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 7: deactivate de nuevo -> idempotente, sin nueva auditoria
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_aud integer;
begin
  set role service_role;
  v_r := deactivate_volunteer('d0000000-0000-0000-0000-000000000002', null);
  reset role;
  select count(*) into v_aud from audit_logs
   where event_type = 'volunteer_deactivated' and volunteer_id = 'd0000000-0000-0000-0000-000000000002';

  insert into test_results_003 (case_name, status, detail) values (
    'deactivate_volunteer repetido: ok, already_inactive=true, sin auditar otra vez',
    case when v_r->>'code' = 'ok' and (v_r->>'already_inactive')::boolean = true and v_aud = 1
         then 'PASS' else 'FAIL' end,
    format('r=%s filas=%s', v_r, v_aud));
exception when others then
  reset role;
  insert into test_results_003 (case_name, status, detail) values ('deactivate_volunteer repetido', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 8: deactivate de un voluntario inexistente -> volunteer_not_found
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_aud integer;
begin
  set role service_role;
  v_r := deactivate_volunteer('d0000000-0000-0000-0000-0000000000fe', null);
  reset role;
  select count(*) into v_aud from audit_logs
   where event_type = 'deactivate_volunteer_not_found'
     and volunteer_id is null
     and detail->>'volunteer_id' = 'd0000000-0000-0000-0000-0000000000fe';

  insert into test_results_003 (case_name, status, detail) values (
    'deactivate_volunteer inexistente -> volunteer_not_found + audit_logs (id en detail)',
    case when v_r->>'code' = 'volunteer_not_found' and v_aud = 1 then 'PASS' else 'FAIL' end,
    format('r=%s filas=%s', v_r, v_aud));
exception when others then
  reset role;
  insert into test_results_003 (case_name, status, detail) values ('deactivate_volunteer inexistente', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 9: tras desactivar, el check-in responde volunteer_inactive y la
-- tarjeta sigue 'active' (no se revoca)
-- ----------------------------------------------------------------------------
do $$
declare
  v_hmac   text := encode(extensions.hmac('DD000003', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_r_dea  jsonb;
  v_r_ci   jsonb;
  v_status text;
  v_pts    integer;
begin
  set role service_role;
  v_r_dea := deactivate_volunteer('d0000000-0000-0000-0000-000000000003', null);
  v_r_ci  := register_check_in(gen_random_uuid(), v_hmac, 'term-003', null, now());
  reset role;
  select status into v_status from cards where volunteer_id = 'd0000000-0000-0000-0000-000000000003';
  select points into v_pts from volunteers where id = 'd0000000-0000-0000-0000-000000000003';

  insert into test_results_003 (case_name, status, detail) values (
    'voluntario desactivado: check-in -> volunteer_inactive, sin puntos, tarjeta sigue active',
    case when v_r_dea->>'code' = 'ok' and v_r_ci->>'code' = 'volunteer_inactive'
          and v_status = 'active' and v_pts = 0
         then 'PASS' else 'FAIL' end,
    format('deactivate=%s check_in=%s card=%s puntos=%s', v_r_dea, v_r_ci, v_status, v_pts));
exception when others then
  reset role;
  insert into test_results_003 (case_name, status, detail) values ('check-in tras desactivar', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 10: un voluntario inactivo se puede seguir editando y sigue inactivo
-- ----------------------------------------------------------------------------
do $$
declare
  v_r jsonb;
begin
  set role service_role;
  v_r := update_volunteer('d0000000-0000-0000-0000-000000000002', null, 'Guadalajara', null);
  reset role;

  insert into test_results_003 (case_name, status, detail) values (
    'update_volunteer sobre inactivo: ok y no lo reactiva',
    case when v_r->>'code' = 'ok' and (v_r->'volunteer'->>'is_active')::boolean = false
          and v_r->'volunteer'->>'community' = 'Guadalajara'
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_r));
exception when others then
  reset role;
  insert into test_results_003 (case_name, status, detail) values ('update_volunteer sobre inactivo', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 11: anon y authenticated no pueden ejecutar las funciones nuevas
-- ----------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_fn   text;
  v_ok   boolean;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_fn in array array['update_volunteer', 'deactivate_volunteer'] loop
      v_ok := false;
      begin
        execute format('set role %I', v_role);
        if v_fn = 'update_volunteer' then
          perform update_volunteer('d0000000-0000-0000-0000-000000000001', 'Hack', null, null);
        else
          perform deactivate_volunteer('d0000000-0000-0000-0000-000000000001', null);
        end if;
        reset role;
      exception when insufficient_privilege then
        v_ok := true;
        reset role;
      end;
      insert into test_results_003 (case_name, status, detail)
      values (format('%s no puede ejecutar %s', v_role, v_fn), case when v_ok then 'PASS' else 'FAIL' end, null);
    end loop;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 12: los intentos rechazados del caso 11 no cambiaron nada
-- ----------------------------------------------------------------------------
do $$
declare
  v_v volunteers%rowtype;
begin
  select * into v_v from volunteers where id = 'd0000000-0000-0000-0000-000000000001';
  insert into test_results_003 (case_name, status, detail) values (
    'tras los intentos de anon/authenticated el voluntario sigue igual y activo',
    case when v_v.full_name = 'Ana Dos' and v_v.is_active then 'PASS' else 'FAIL' end,
    format('full_name=%s is_active=%s', v_v.full_name, v_v.is_active));
end;
$$;


-- ============================================================================
-- Reporte final
-- ============================================================================
select seq, case_name, status, detail from test_results_003 order by seq;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail
from test_results_003;

do $$
declare
  v_fail_count integer;
begin
  select count(*) into v_fail_count from test_results_003 where status = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% caso(s) de 003 en FAIL — ver tabla de arriba', v_fail_count;
  end if;
end;
$$;
