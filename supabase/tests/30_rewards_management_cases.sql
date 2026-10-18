-- ============================================================================
-- Casos de prueba de 004_rewards_management.sql (create_reward, update_reward,
-- deactivate_reward). Se corre despues de 20_volunteer_management_cases.sql,
-- sobre la misma base (ver run_tests.sh). Misma convencion que los demas: un
-- DO block por caso, una fila en test_results_004 por asercion.
-- ============================================================================

create table if not exists test_results_004 (
  seq        serial primary key,
  case_name  text not null,
  status     text not null check (status in ('PASS', 'FAIL')),
  detail     text
);

-- Recompensa y usuarios fijos para estos casos.
insert into rewards (id, name, description, points_cost, stock) values
  ('e0000000-0000-0000-0000-000000000001', 'Playera Test', 'Talla M', 500, 10),
  ('e0000000-0000-0000-0000-000000000002', 'Despensa Test', 'Con canjes', 1000, 3);

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-0000000000ad', 'admin004@test.local'),
  ('e1000000-0000-0000-0000-0000000000ca', 'guard004@test.local');
insert into profiles (id, role) values
  ('e1000000-0000-0000-0000-0000000000ad', 'admin'),
  ('e1000000-0000-0000-0000-0000000000ca', 'guard');

-- Canje historico de la recompensa 2 (se desactiva en el caso 8).
insert into volunteers (id, full_name, community) values ('e2000000-0000-0000-0000-000000000001', 'Canjeador', 'x');
insert into reward_redemptions (id, volunteer_id, reward_id, points_spent) values
  ('e3000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 1000);

-- ----------------------------------------------------------------------------
-- Caso 1: create_reward valido: recorta, descripcion vacia -> null, activa, audita
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_rw  rewards%rowtype;
  v_aud integer;
begin
  set role service_role;
  v_r := create_reward('  Gorra BAMX  ', '   ', 250, 15, 'e1000000-0000-0000-0000-0000000000ad');
  reset role;

  select * into v_rw from rewards where id = (v_r->'reward'->>'id')::uuid;
  select count(*) into v_aud from audit_logs
   where event_type = 'reward_created'
     and volunteer_id is null
     and detail = jsonb_build_object('reward_id', v_rw.id, 'operator_id', 'e1000000-0000-0000-0000-0000000000ad');

  insert into test_results_004 (case_name, status, detail) values (
    'create_reward: ok, recorta name, description vacia -> null, is_active=true',
    case when v_r->>'code' = 'ok'
          and v_rw.name = 'Gorra BAMX' and v_rw.description is null
          and v_rw.points_cost = 250 and v_rw.stock = 15 and v_rw.is_active
          and v_r->'reward'->>'name' = 'Gorra BAMX'
          and v_r->'reward'->'description' = 'null'::jsonb
          and (v_r->'reward'->>'points_cost')::int = 250
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_r));
  insert into test_results_004 (case_name, status, detail) values (
    'create_reward audita reward_created con reward_id y operator_id',
    case when v_aud = 1 then 'PASS' else 'FAIL' end, format('filas=%s', v_aud));
exception when others then
  reset role;
  insert into test_results_004 (case_name, status, detail) values ('create_reward valido', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 2: create_reward acepta los limites: 0 y 2147483647, name de 120,
-- description de 500
-- ----------------------------------------------------------------------------
do $$
declare
  v_r1 jsonb;
  v_r2 jsonb;
begin
  set role service_role;
  v_r1 := create_reward('Gratis', null, 0, 0, null);
  v_r2 := create_reward(repeat('n', 120), repeat('d', 500), 2147483647, 2147483647, null);
  reset role;

  insert into test_results_004 (case_name, status, detail) values (
    'create_reward en los limites (0, 2147483647, 120 y 500 caracteres)',
    case when v_r1->>'code' = 'ok' and v_r2->>'code' = 'ok'
          and (v_r2->'reward'->>'points_cost')::bigint = 2147483647
          and (v_r2->'reward'->>'stock')::bigint = 2147483647
         then 'PASS' else 'FAIL' end,
    format('r1=%s', v_r1));
exception when others then
  reset role;
  insert into test_results_004 (case_name, status, detail) values ('create_reward limites', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 3: create_reward invalido -> 22023 y no inserta nada
-- ----------------------------------------------------------------------------
do $$
declare
  v_before integer;
  v_after  integer;
  v_state  text;
  v_bad    text := '';
  v_i      integer;
begin
  select count(*) into v_before from rewards;
  for v_i in 1 .. 8 loop
    v_state := 'sin error';
    begin
      set role service_role;
      case v_i
        when 1 then perform create_reward(null, null, 1, 1, null);
        when 2 then perform create_reward('   ', null, 1, 1, null);
        when 3 then perform create_reward(repeat('n', 121), null, 1, 1, null);
        when 4 then perform create_reward('X', repeat('d', 501), 1, 1, null);
        when 5 then perform create_reward('X', null, -1, 1, null);
        when 6 then perform create_reward('X', null, 1, -1, null);
        when 7 then perform create_reward('X', null, null, 1, null);
        when 8 then perform create_reward('X', null, 1, null, null);
      end case;
      reset role;
    exception when others then
      v_state := sqlstate;
      reset role;
    end;
    if v_state <> '22023' then
      v_bad := v_bad || format('[%s: %s] ', v_i, v_state);
    end if;
  end loop;
  select count(*) into v_after from rewards;

  insert into test_results_004 (case_name, status, detail) values (
    'create_reward rechaza name nulo/vacio/>120, description >500, numeros negativos o nulos (22023)',
    case when v_bad = '' and v_after = v_before then 'PASS' else 'FAIL' end,
    coalesce(nullif(v_bad, ''), 'todas 22023') || format(' antes=%s despues=%s', v_before, v_after));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 4: update_reward parcial (solo stock) -> ok, changed_fields ["stock"], resto igual
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_rw  rewards%rowtype;
  v_aud integer;
begin
  set role service_role;
  v_r := update_reward('e0000000-0000-0000-0000-000000000001', null, null, false, null, 7,
                       'e1000000-0000-0000-0000-0000000000ad');
  reset role;
  select * into v_rw from rewards where id = 'e0000000-0000-0000-0000-000000000001';
  select count(*) into v_aud from audit_logs
   where event_type = 'reward_updated'
     and detail = '{"reward_id": "e0000000-0000-0000-0000-000000000001", "operator_id": "e1000000-0000-0000-0000-0000000000ad", "changed_fields": ["stock"]}'::jsonb;

  insert into test_results_004 (case_name, status, detail) values (
    'update_reward solo stock: ok y no toca name/description/points_cost/is_active',
    case when v_r->>'code' = 'ok' and v_r->'changed_fields' = '["stock"]'::jsonb
          and v_rw.stock = 7 and v_rw.name = 'Playera Test' and v_rw.description = 'Talla M'
          and v_rw.points_cost = 500 and v_rw.is_active
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_r));
  insert into test_results_004 (case_name, status, detail) values (
    'update_reward audita reward_updated con changed_fields',
    case when v_aud = 1 then 'PASS' else 'FAIL' end, format('filas=%s', v_aud));
exception when others then
  reset role;
  insert into test_results_004 (case_name, status, detail) values ('update_reward parcial', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 5: update_reward de todos los campos; luego borrar description (flag y "")
-- ----------------------------------------------------------------------------
do $$
declare
  v_all   jsonb;
  v_clear jsonb;
  v_blank jsonb;
  v_desc  text;
begin
  set role service_role;
  v_all := update_reward('e0000000-0000-0000-0000-000000000001', ' Playera 2 ', ' Talla L ', false, 600, 0, null);
  v_clear := update_reward('e0000000-0000-0000-0000-000000000001', null, null, true, null, null, null);
  -- volver a poner descripcion y borrarla con texto en blanco
  perform update_reward('e0000000-0000-0000-0000-000000000001', null, 'otra', false, null, null, null);
  v_blank := update_reward('e0000000-0000-0000-0000-000000000001', null, '   ', false, null, null, null);
  reset role;
  select description into v_desc from rewards where id = 'e0000000-0000-0000-0000-000000000001';

  insert into test_results_004 (case_name, status, detail) values (
    'update_reward de todos los campos (recortados)',
    case when v_all->>'code' = 'ok'
          and v_all->'changed_fields' = '["name", "description", "points_cost", "stock"]'::jsonb
          and v_all->'reward'->>'name' = 'Playera 2' and v_all->'reward'->>'description' = 'Talla L'
          and (v_all->'reward'->>'points_cost')::int = 600 and (v_all->'reward'->>'stock')::int = 0
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_all));
  insert into test_results_004 (case_name, status, detail) values (
    'update_reward borra description con p_clear_description y con texto en blanco',
    case when v_clear->'changed_fields' = '["description"]'::jsonb
          and v_clear->'reward'->'description' = 'null'::jsonb
          and v_blank->'changed_fields' = '["description"]'::jsonb
          and v_desc is null
         then 'PASS' else 'FAIL' end,
    format('clear=%s blank=%s', v_clear->'changed_fields', v_blank->'changed_fields'));
exception when others then
  reset role;
  insert into test_results_004 (case_name, status, detail) values ('update_reward completo / borrar descripcion', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 6: update_reward sin cambios reales -> ok, changed_fields [] y no audita
-- ----------------------------------------------------------------------------
do $$
declare
  v_r      jsonb;
  v_before integer;
  v_after  integer;
begin
  select count(*) into v_before from audit_logs where event_type = 'reward_updated';
  set role service_role;
  v_r := update_reward('e0000000-0000-0000-0000-000000000001', 'Playera 2', null, true, 600, 0, null);
  reset role;
  select count(*) into v_after from audit_logs where event_type = 'reward_updated';

  insert into test_results_004 (case_name, status, detail) values (
    'update_reward sin cambios reales: ok, changed_fields [] y no audita',
    case when v_r->>'code' = 'ok' and v_r->'changed_fields' = '[]'::jsonb and v_after = v_before
         then 'PASS' else 'FAIL' end,
    format('r=%s antes=%s despues=%s', v_r->'changed_fields', v_before, v_after));
exception when others then
  reset role;
  insert into test_results_004 (case_name, status, detail) values ('update_reward sin cambios', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 7: update_reward invalido (nada que cambiar, negativos, textos) -> 22023
-- sin modificar; inexistente -> reward_not_found sin violar FKs
-- ----------------------------------------------------------------------------
do $$
declare
  v_state text;
  v_bad   text := '';
  v_i     integer;
  v_rw    rewards%rowtype;
  v_nf    jsonb;
  v_aud   integer;
begin
  for v_i in 1 .. 6 loop
    v_state := 'sin error';
    begin
      set role service_role;
      case v_i
        when 1 then perform update_reward('e0000000-0000-0000-0000-000000000001', null, null, false, null, null, null);
        when 2 then perform update_reward('e0000000-0000-0000-0000-000000000001', '  ', null, false, null, null, null);
        when 3 then perform update_reward('e0000000-0000-0000-0000-000000000001', repeat('n', 121), null, false, null, null, null);
        when 4 then perform update_reward('e0000000-0000-0000-0000-000000000001', null, repeat('d', 501), false, null, null, null);
        when 5 then perform update_reward('e0000000-0000-0000-0000-000000000001', null, null, false, -5, null, null);
        when 6 then perform update_reward('e0000000-0000-0000-0000-000000000001', null, null, false, null, -1, null);
      end case;
      reset role;
    exception when others then
      v_state := sqlstate;
      reset role;
    end;
    if v_state <> '22023' then
      v_bad := v_bad || format('[%s: %s] ', v_i, v_state);
    end if;
  end loop;
  select * into v_rw from rewards where id = 'e0000000-0000-0000-0000-000000000001';

  insert into test_results_004 (case_name, status, detail) values (
    'update_reward rechaza nada-que-cambiar, name vacio/>120, description >500 y negativos (22023) sin modificar',
    case when v_bad = '' and v_rw.name = 'Playera 2' and v_rw.points_cost = 600 and v_rw.stock = 0
         then 'PASS' else 'FAIL' end,
    coalesce(nullif(v_bad, ''), 'todas 22023'));

  set role service_role;
  v_nf := update_reward('e0000000-0000-0000-0000-0000000000ff', 'X', null, false, null, null, null);
  reset role;
  select count(*) into v_aud from audit_logs
   where event_type = 'update_reward_not_found' and detail->>'reward_id' = 'e0000000-0000-0000-0000-0000000000ff';

  insert into test_results_004 (case_name, status, detail) values (
    'update_reward inexistente -> reward_not_found + audit_logs',
    case when v_nf->>'code' = 'reward_not_found' and v_aud = 1 then 'PASS' else 'FAIL' end,
    format('r=%s filas=%s', v_nf, v_aud));
exception when others then
  reset role;
  insert into test_results_004 (case_name, status, detail) values ('update_reward invalido / inexistente', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 8: deactivate_reward con canjes: ok, is_active=false, fila y canje intactos
-- ----------------------------------------------------------------------------
do $$
declare
  v_r     jsonb;
  v_again jsonb;
  v_rw    rewards%rowtype;
  v_rr    integer;
  v_aud   integer;
begin
  set role service_role;
  v_r := deactivate_reward('e0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-0000000000ad');
  v_again := deactivate_reward('e0000000-0000-0000-0000-000000000002', null);
  reset role;
  select * into v_rw from rewards where id = 'e0000000-0000-0000-0000-000000000002';
  select count(*) into v_rr from reward_redemptions
   where id = 'e3000000-0000-0000-0000-000000000001'
     and reward_id = 'e0000000-0000-0000-0000-000000000002' and points_spent = 1000;
  select count(*) into v_aud from audit_logs
   where event_type = 'reward_deactivated' and detail->>'reward_id' = 'e0000000-0000-0000-0000-000000000002';

  insert into test_results_004 (case_name, status, detail) values (
    'deactivate_reward: ok, is_active=false, la fila y su canje historico siguen ahi',
    case when v_r->>'code' = 'ok' and (v_r->>'already_inactive')::boolean = false
          and (v_r->'reward'->>'is_active')::boolean = false
          and v_rw.id is not null and not v_rw.is_active
          and v_rw.name = 'Despensa Test' and v_rw.stock = 3
          and v_rr = 1
         then 'PASS' else 'FAIL' end,
    format('r=%s canjes=%s', v_r, v_rr));
  insert into test_results_004 (case_name, status, detail) values (
    'deactivate_reward repetido: ok, already_inactive=true, una sola auditoria',
    case when v_again->>'code' = 'ok' and (v_again->>'already_inactive')::boolean = true and v_aud = 1
         then 'PASS' else 'FAIL' end,
    format('again=%s filas=%s', v_again, v_aud));
exception when others then
  reset role;
  insert into test_results_004 (case_name, status, detail) values ('deactivate_reward', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 9: deactivate_reward inexistente -> reward_not_found
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_aud integer;
begin
  set role service_role;
  v_r := deactivate_reward('e0000000-0000-0000-0000-0000000000fe', null);
  reset role;
  select count(*) into v_aud from audit_logs
   where event_type = 'deactivate_reward_not_found' and detail->>'reward_id' = 'e0000000-0000-0000-0000-0000000000fe';

  insert into test_results_004 (case_name, status, detail) values (
    'deactivate_reward inexistente -> reward_not_found + audit_logs',
    case when v_r->>'code' = 'reward_not_found' and v_aud = 1 then 'PASS' else 'FAIL' end,
    format('r=%s filas=%s', v_r, v_aud));
exception when others then
  reset role;
  insert into test_results_004 (case_name, status, detail) values ('deactivate_reward inexistente', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 10: una recompensa inactiva se puede editar y sigue inactiva
-- ----------------------------------------------------------------------------
do $$
declare
  v_r jsonb;
begin
  set role service_role;
  v_r := update_reward('e0000000-0000-0000-0000-000000000002', null, null, false, null, 5, null);
  reset role;
  insert into test_results_004 (case_name, status, detail) values (
    'update_reward sobre inactiva: ok y no la reactiva',
    case when v_r->>'code' = 'ok' and (v_r->'reward'->>'is_active')::boolean = false
          and (v_r->'reward'->>'stock')::int = 5
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_r));
exception when others then
  reset role;
  insert into test_results_004 (case_name, status, detail) values ('update_reward sobre inactiva', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 11: anon y authenticated (incluido un admin con sesion) no pueden
-- ejecutar las funciones nuevas ni escribir rewards directo (RLS)
-- ----------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_fn   text;
  v_ok   boolean;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_fn in array array['create_reward', 'update_reward', 'deactivate_reward', 'insert', 'update'] loop
      v_ok := false;
      begin
        execute format('set role %I', v_role);
        perform set_config('request.jwt.claim.role', v_role, false);
        perform set_config('request.jwt.claim.sub',
          case when v_role = 'authenticated' then 'e1000000-0000-0000-0000-0000000000ad' else '' end, false);
        case v_fn
          when 'create_reward' then perform create_reward('Hack', null, 1, 1, null);
          when 'update_reward' then perform update_reward('e0000000-0000-0000-0000-000000000001', 'Hack', null, false, null, null, null);
          when 'deactivate_reward' then perform deactivate_reward('e0000000-0000-0000-0000-000000000001', null);
          when 'insert' then insert into rewards (name, points_cost, stock) values ('Hack', 1, 1);
          when 'update' then
            update rewards set name = 'Hack' where id = 'e0000000-0000-0000-0000-000000000001';
            -- sin policy de update, RLS filtra la fila: 0 filas = bloqueado
            if not found then v_ok := true; end if;
        end case;
        reset role;
      exception when insufficient_privilege then
        v_ok := true;
        reset role;
      end;
      perform set_config('request.jwt.claim.sub', '', false);
      perform set_config('request.jwt.claim.role', '', false);
      insert into test_results_004 (case_name, status, detail)
      values (
        format('%s no puede %s',
               case when v_role = 'authenticated' then 'authenticated (con sesion de admin)' else 'anon' end,
               case when v_fn in ('insert', 'update') then v_fn || ' directo en rewards' else 'ejecutar ' || v_fn end),
        case when v_ok then 'PASS' else 'FAIL' end, null);
    end loop;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 12: los intentos del caso 11 no cambiaron nada
-- ----------------------------------------------------------------------------
do $$
declare
  v_hack integer;
  v_rw   rewards%rowtype;
begin
  select count(*) into v_hack from rewards where name = 'Hack';
  select * into v_rw from rewards where id = 'e0000000-0000-0000-0000-000000000001';
  insert into test_results_004 (case_name, status, detail) values (
    'tras los intentos sin service_role no hay filas Hack y la recompensa sigue activa',
    case when v_hack = 0 and v_rw.name = 'Playera 2' and v_rw.is_active then 'PASS' else 'FAIL' end,
    format('hack=%s name=%s', v_hack, v_rw.name));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 13: las lecturas no cambian: staff (guard) lee activas e inactivas;
-- anon no lee nada (rewards_read_staff de 002)
-- ----------------------------------------------------------------------------
do $$
declare
  v_guard integer;
  v_anon  integer;
begin
  set role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'e1000000-0000-0000-0000-0000000000ca', false);
  select count(*) into v_guard from rewards
   where id in ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002');
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);

  set role anon;
  select count(*) into v_anon from rewards;
  reset role;

  insert into test_results_004 (case_name, status, detail) values (
    'lectura sin cambios: guard ve activa e inactiva, anon no ve ninguna',
    case when v_guard = 2 and v_anon = 0 then 'PASS' else 'FAIL' end,
    format('guard=%s anon=%s', v_guard, v_anon));
end;
$$;


-- ============================================================================
-- Reporte final
-- ============================================================================
select seq, case_name, status, detail from test_results_004 order by seq;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail
from test_results_004;

do $$
declare
  v_fail_count integer;
begin
  select count(*) into v_fail_count from test_results_004 where status = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% caso(s) de 004 en FAIL — ver tabla de arriba', v_fail_count;
  end if;
end;
$$;
