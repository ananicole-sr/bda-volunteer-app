-- ============================================================================
-- Casos de prueba de 002_nfc_security.sql. Se corre despues de schema.sql,
-- 002_nfc_security.sql y 01_post_grants.sql (ver run_tests.sh).
--
-- Convencion: cada caso corre en su propio DO block, que inserta exactamente
-- una fila en test_results. Al final se imprime una fila por caso (PASS/FAIL)
-- y un resumen. ON_ERROR_STOP esta activo (ver run_tests.sh): si algun DO
-- block deja escapar un error que no esperaba, el script completo se detiene
-- ahi — eso es una falla real del test, no un resultado FAIL normal.
-- ============================================================================

create temporary table test_results (
  seq        serial primary key,
  case_name  text not null,
  status     text not null check (status in ('PASS', 'FAIL')),
  detail     text
);

-- Las pruebas que cambian de rol (anon/authenticated) usan set_config(...,
-- false) para dejar el resultado en una GUC de SESION (no de transaccion),
-- de forma que sobreviva al "reset role" de vuelta a postgres antes de
-- insertarlo en test_results.


-- ----------------------------------------------------------------------------
-- Caso 1: event_id repetido no duplica puntos (duplicate_event)
-- ----------------------------------------------------------------------------
do $$
declare
  v_volunteer_id uuid;
  v_event_id     uuid := gen_random_uuid();
  v_uid_hmac     text := encode(extensions.hmac('AAAA0001', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_r1           jsonb;
  v_r2           jsonb;
  v_points_after_first integer;
begin
  insert into volunteers (full_name, community) values ('Test Duplicate', 'x') returning id into v_volunteer_id;
  insert into cards (volunteer_id, uid_hmac, status) values (v_volunteer_id, v_uid_hmac, 'active');

  set role service_role;
  v_r1 := register_check_in(v_event_id, v_uid_hmac, 'term-1', null, now());
  v_r2 := register_check_in(v_event_id, v_uid_hmac, 'term-1', null, now());
  reset role;

  select points into v_points_after_first from volunteers where id = v_volunteer_id;

  insert into test_results (case_name, status, detail)
  values (
    'event_id repetido no duplica puntos',
    case when (v_r1->>'code' = 'ok')
           and (v_r2->>'code' = 'duplicate_event')
           and (v_r2->>'points_awarded')::int = (v_r1->>'points_awarded')::int
           and v_points_after_first = (v_r1->>'points_awarded')::int
         then 'PASS' else 'FAIL' end,
    format('r1=%s r2=%s points_en_volunteers=%s', v_r1, v_r2, v_points_after_first)
  );
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('event_id repetido no duplica puntos', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 2: daily_limit (segundo check-in del mismo dia calendario)
-- ----------------------------------------------------------------------------
do $$
declare
  v_volunteer_id uuid;
  v_uid_hmac     text := encode(extensions.hmac('AAAA0002', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_r1 jsonb;
  v_r2 jsonb;
begin
  insert into volunteers (full_name, community) values ('Test Daily Limit', 'x') returning id into v_volunteer_id;
  insert into cards (volunteer_id, uid_hmac, status) values (v_volunteer_id, v_uid_hmac, 'active');

  set role service_role;
  v_r1 := register_check_in(gen_random_uuid(), v_uid_hmac, 'term-1', null, now());
  -- Mismo dia calendario, otro momento (no en el futuro: eso seria invalid_ts).
  v_r2 := register_check_in(gen_random_uuid(), v_uid_hmac, 'term-1', null, now() - interval '10 minutes');
  reset role;

  insert into test_results (case_name, status, detail)
  values (
    'daily_limit en el segundo check-in del mismo dia',
    case when v_r1->>'code' = 'ok' and v_r2->>'code' = 'daily_limit' then 'PASS' else 'FAIL' end,
    format('r1=%s r2=%s', v_r1, v_r2)
  );
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('daily_limit en el segundo check-in del mismo dia', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 3: card_unknown (uid_hmac que no existe en cards)
-- ----------------------------------------------------------------------------
do $$
declare
  -- Se calcula ANTES del "set role": service_role (como cualquier rol de
  -- la API) no tiene por que tener USAGE sobre el schema extensions, igual
  -- que en el sistema real (la Edge Function ya manda el uid_hmac listo).
  v_uid_hmac text := encode(extensions.hmac('NOPE0000', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_r jsonb;
begin
  set role service_role;
  v_r := register_check_in(gen_random_uuid(), v_uid_hmac, 'term-1', null, now());
  reset role;

  insert into test_results (case_name, status, detail)
  values ('card_unknown con uid_hmac no registrado', case when v_r->>'code' = 'card_unknown' then 'PASS' else 'FAIL' end, v_r::text);
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('card_unknown con uid_hmac no registrado', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 4: card_inactive (status revoked y lost)
-- ----------------------------------------------------------------------------
do $$
declare
  v_volunteer_id uuid;
  v_uid_revoked  text := encode(extensions.hmac('AAAA0004', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_uid_lost     text := encode(extensions.hmac('AAAA0005', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_r_revoked jsonb;
  v_r_lost    jsonb;
begin
  insert into volunteers (full_name, community) values ('Test Card Inactive', 'x') returning id into v_volunteer_id;
  insert into cards (volunteer_id, uid_hmac, status) values (v_volunteer_id, v_uid_revoked, 'revoked');
  insert into cards (volunteer_id, uid_hmac, status) values (v_volunteer_id, v_uid_lost, 'lost');

  set role service_role;
  v_r_revoked := register_check_in(gen_random_uuid(), v_uid_revoked, 'term-1', null, now());
  v_r_lost    := register_check_in(gen_random_uuid(), v_uid_lost, 'term-1', null, now());
  reset role;

  insert into test_results (case_name, status, detail)
  values (
    'card_inactive con status revoked',
    case when v_r_revoked->>'code' = 'card_inactive' then 'PASS' else 'FAIL' end,
    v_r_revoked::text
  );
  insert into test_results (case_name, status, detail)
  values (
    'card_inactive con status lost',
    case when v_r_lost->>'code' = 'card_inactive' then 'PASS' else 'FAIL' end,
    v_r_lost::text
  );
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('card_inactive (revoked/lost)', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 5: stale_event e invalid_ts
-- ----------------------------------------------------------------------------
do $$
declare
  -- Dos voluntarios (no uno): el indice parcial unico de la seccion 2 solo
  -- deja una tarjeta 'active' por voluntario a la vez.
  v_volunteer_stale  uuid;
  v_volunteer_future uuid;
  v_uid_stale    text := encode(extensions.hmac('AAAA0006', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_uid_future   text := encode(extensions.hmac('AAAA0007', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_r_stale   jsonb;
  v_r_future  jsonb;
begin
  insert into volunteers (full_name, community) values ('Test Stale', 'x') returning id into v_volunteer_stale;
  insert into volunteers (full_name, community) values ('Test Invalid Ts', 'x') returning id into v_volunteer_future;
  insert into cards (volunteer_id, uid_hmac, status) values (v_volunteer_stale, v_uid_stale, 'active');
  insert into cards (volunteer_id, uid_hmac, status) values (v_volunteer_future, v_uid_future, 'active');

  set role service_role;
  v_r_stale  := register_check_in(gen_random_uuid(), v_uid_stale, 'term-1', null, now() - interval '49 hours');
  v_r_future := register_check_in(gen_random_uuid(), v_uid_future, 'term-1', null, now() + interval '6 minutes');
  reset role;

  insert into test_results (case_name, status, detail)
  values ('stale_event con client_ts de hace 49 horas', case when v_r_stale->>'code' = 'stale_event' then 'PASS' else 'FAIL' end, v_r_stale::text);
  insert into test_results (case_name, status, detail)
  values ('invalid_ts con client_ts 6 minutos en el futuro', case when v_r_future->>'code' = 'invalid_ts' then 'PASS' else 'FAIL' end, v_r_future::text);
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('stale_event / invalid_ts', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 6: frontera de tiers — visita 6 (15 pts) y visita 16 (25 pts)
-- ----------------------------------------------------------------------------
do $$
declare
  v_id_6  uuid;
  v_id_16 uuid;
  v_uid_6  text := encode(extensions.hmac('AAAA0008', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_uid_16 text := encode(extensions.hmac('AAAA0009', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_r_6  jsonb;
  v_r_16 jsonb;
begin
  insert into volunteers (full_name, community, points, total_visits) values ('Test Tier 6', 'x', 0, 5) returning id into v_id_6;
  insert into volunteers (full_name, community, points, total_visits) values ('Test Tier 16', 'x', 0, 15) returning id into v_id_16;
  insert into cards (volunteer_id, uid_hmac, status) values (v_id_6, v_uid_6, 'active');
  insert into cards (volunteer_id, uid_hmac, status) values (v_id_16, v_uid_16, 'active');

  set role service_role;
  v_r_6  := register_check_in(gen_random_uuid(), v_uid_6, 'term-1', null, now());
  v_r_16 := register_check_in(gen_random_uuid(), v_uid_16, 'term-1', null, now());
  reset role;

  insert into test_results (case_name, status, detail)
  values (
    'tier: la visita 6 otorga 15 puntos',
    case when (v_r_6->>'points_awarded')::int = 15 and (v_r_6->'volunteer'->>'total_visits')::int = 6
         then 'PASS' else 'FAIL' end,
    v_r_6::text
  );
  insert into test_results (case_name, status, detail)
  values (
    'tier: la visita 16 otorga 25 puntos',
    case when (v_r_16->>'points_awarded')::int = 25 and (v_r_16->'volunteer'->>'total_visits')::int = 16
         then 'PASS' else 'FAIL' end,
    v_r_16::text
  );
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('frontera de tiers (6 y 16)', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 7: issue_card deja una sola tarjeta activa por voluntario
-- ----------------------------------------------------------------------------
do $$
declare
  v_volunteer_id uuid;
  v_uid_1 text := encode(extensions.hmac('BBBB0001', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_uid_2 text := encode(extensions.hmac('BBBB0002', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_r1 jsonb;
  v_r2 jsonb;
  v_active_count integer;
  v_old_status   text;
begin
  insert into volunteers (full_name, community) values ('Test Issue Card', 'x') returning id into v_volunteer_id;

  set role service_role;
  v_r1 := issue_card(v_volunteer_id, v_uid_1, null);
  v_r2 := issue_card(v_volunteer_id, v_uid_2, null);
  reset role;

  select count(*) into v_active_count from cards where volunteer_id = v_volunteer_id and status = 'active';
  select status into v_old_status from cards where id = (v_r1->>'card_id')::uuid;

  insert into test_results (case_name, status, detail)
  values (
    'issue_card deja una sola tarjeta activa',
    case when v_r1->>'code' = 'ok' and (v_r1->>'revoked_previous')::boolean = false
           and v_r2->>'code' = 'ok' and (v_r2->>'revoked_previous')::boolean = true
           and v_active_count = 1
           and v_old_status = 'revoked'
         then 'PASS' else 'FAIL' end,
    format('r1=%s r2=%s activos=%s status_tarjeta_vieja=%s', v_r1, v_r2, v_active_count, v_old_status)
  );
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('issue_card deja una sola tarjeta activa', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 8: enroll_volunteer con uid duplicado -> card_in_use
-- ----------------------------------------------------------------------------
do $$
declare
  v_uid_hmac text := encode(extensions.hmac('CCCC0001', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  v_r1 jsonb;
  v_r2 jsonb;
  v_volunteer_count integer;
begin
  set role service_role;
  v_r1 := enroll_volunteer('Primero', 'x', v_uid_hmac, null);
  v_r2 := enroll_volunteer('Segundo', 'x', v_uid_hmac, null);
  reset role;

  select count(*) into v_volunteer_count from volunteers where full_name in ('Primero', 'Segundo');

  insert into test_results (case_name, status, detail)
  values (
    'enroll_volunteer con uid duplicado -> card_in_use',
    case when v_r1->>'code' = 'ok' and v_r2->>'code' = 'card_in_use' and v_volunteer_count = 1
         then 'PASS' else 'FAIL' end,
    format('r1=%s r2=%s voluntarios_creados=%s', v_r1, v_r2, v_volunteer_count)
  );
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('enroll_volunteer con uid duplicado', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 9: anon y authenticated no pueden ejecutar ninguna de las 3 funciones
-- ----------------------------------------------------------------------------
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    execute format('set role %I', v_role);

    begin
      perform register_check_in(gen_random_uuid(), 'deadbeef', 't', null, now());
      perform set_config('app.t9_register', 'FAIL: pudo ejecutar register_check_in', false);
    exception when insufficient_privilege then
      perform set_config('app.t9_register', 'PASS', false);
    end;

    begin
      perform enroll_volunteer('x', 'x', 'deadbeef', null);
      perform set_config('app.t9_enroll', 'FAIL: pudo ejecutar enroll_volunteer', false);
    exception when insufficient_privilege then
      perform set_config('app.t9_enroll', 'PASS', false);
    end;

    begin
      perform issue_card(gen_random_uuid(), 'deadbeef', null);
      perform set_config('app.t9_issue', 'FAIL: pudo ejecutar issue_card', false);
    exception when insufficient_privilege then
      perform set_config('app.t9_issue', 'PASS', false);
    end;

    reset role;

    insert into test_results (case_name, status, detail) values (
      format('%s no puede ejecutar register_check_in', v_role),
      case when current_setting('app.t9_register') = 'PASS' then 'PASS' else 'FAIL' end,
      current_setting('app.t9_register')
    );
    insert into test_results (case_name, status, detail) values (
      format('%s no puede ejecutar enroll_volunteer', v_role),
      case when current_setting('app.t9_enroll') = 'PASS' then 'PASS' else 'FAIL' end,
      current_setting('app.t9_enroll')
    );
    insert into test_results (case_name, status, detail) values (
      format('%s no puede ejecutar issue_card', v_role),
      case when current_setting('app.t9_issue') = 'PASS' then 'PASS' else 'FAIL' end,
      current_setting('app.t9_issue')
    );
  end loop;
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('anon/authenticated no ejecutan funciones', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 10: anon y authenticated no pueden escribir en las tablas (RLS, sin
-- policy de insert/update/delete) aunque ya tengan el grant de tabla.
-- ----------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_row_count integer;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    execute format('set role %I', v_role);

    begin
      insert into volunteers (full_name, community) values ('Hack Test', 'x');
      perform set_config('app.t10_insert', 'FAIL: pudo insertar en volunteers', false);
    exception when insufficient_privilege then
      perform set_config('app.t10_insert', 'PASS', false);
    end;

    -- UPDATE sin policy permisiva no truena: RLS filtra en silencio las
    -- filas visibles para ese comando, asi que el UPDATE "tiene exito" con
    -- 0 filas afectadas. Por eso aqui se revisa ROW_COUNT en vez de confiar
    -- en una excepcion (a diferencia de INSERT, donde una fila sin donde
    -- "caer" SI truena con insufficient_privilege).
    begin
      update volunteers set points = 999999;
      get diagnostics v_row_count = row_count;
      if v_row_count = 0 then
        perform set_config('app.t10_update', 'PASS', false);
      else
        perform set_config('app.t10_update', format('FAIL: actualizo %s fila(s) en volunteers', v_row_count), false);
      end if;
    exception when insufficient_privilege then
      perform set_config('app.t10_update', 'PASS', false);
    end;

    reset role;

    insert into test_results (case_name, status, detail) values (
      format('%s no puede insertar en volunteers (RLS)', v_role),
      case when current_setting('app.t10_insert') = 'PASS' then 'PASS' else 'FAIL' end,
      current_setting('app.t10_insert')
    );
    insert into test_results (case_name, status, detail) values (
      format('%s no puede actualizar volunteers (RLS)', v_role),
      case when current_setting('app.t10_update') = 'PASS' then 'PASS' else 'FAIL' end,
      current_setting('app.t10_update')
    );
  end loop;
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('anon/authenticated no escriben tablas', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 11: nadie puede modificar audit_logs — ni anon/authenticated (RLS +
-- falta de grant) ni service_role (le revocamos UPDATE/DELETE a nivel de
-- tabla aposta, porque BYPASSRLS lo deja pasar por encima de cualquier policy).
-- ----------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_log_id uuid;
begin
  insert into audit_logs (event_type, detail) values ('test_seed', '{}'::jsonb) returning id into v_log_id;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    execute format('set role %I', v_role);

    begin
      update audit_logs set event_type = 'tampered' where id = v_log_id;
      perform set_config('app.t11_update', 'FAIL: pudo actualizar audit_logs', false);
    exception when insufficient_privilege then
      perform set_config('app.t11_update', 'PASS', false);
    end;

    begin
      delete from audit_logs where id = v_log_id;
      perform set_config('app.t11_delete', 'FAIL: pudo borrar de audit_logs', false);
    exception when insufficient_privilege then
      perform set_config('app.t11_delete', 'PASS', false);
    end;

    reset role;

    insert into test_results (case_name, status, detail) values (
      format('%s no puede UPDATE audit_logs', v_role),
      case when current_setting('app.t11_update') = 'PASS' then 'PASS' else 'FAIL' end,
      current_setting('app.t11_update')
    );
    insert into test_results (case_name, status, detail) values (
      format('%s no puede DELETE audit_logs', v_role),
      case when current_setting('app.t11_delete') = 'PASS' then 'PASS' else 'FAIL' end,
      current_setting('app.t11_delete')
    );
  end loop;
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('nadie modifica audit_logs', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 12: cada usuario autenticado lee solo su propia fila de profiles
-- ----------------------------------------------------------------------------
do $$
declare
  v_user1 uuid := '10000000-0000-0000-0000-000000000001';
  v_user2 uuid := '10000000-0000-0000-0000-000000000002';
  v_count1_own   integer;
  v_count1_other integer;
begin
  insert into auth.users (id, email) values (v_user1, 'staff1@test.local'), (v_user2, 'staff2@test.local');
  insert into profiles (id, role) values (v_user1, 'admin'), (v_user2, 'guard');

  set role authenticated;
  set request.jwt.claim.role = 'authenticated';
  set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';

  select count(*) into v_count1_own from profiles where id = v_user1;
  select count(*) into v_count1_other from profiles where id = v_user2;

  reset role;
  reset request.jwt.claim.role;
  reset request.jwt.claim.sub;

  insert into test_results (case_name, status, detail)
  values (
    'usuario autenticado lee su propia fila de profiles',
    case when v_count1_own = 1 then 'PASS' else 'FAIL' end,
    format('filas_propias_visibles=%s', v_count1_own)
  );
  insert into test_results (case_name, status, detail)
  values (
    'usuario autenticado NO lee el profile de otro usuario',
    case when v_count1_other = 0 then 'PASS' else 'FAIL' end,
    format('filas_de_otro_visibles=%s', v_count1_other)
  );
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('profiles: cada usuario lee solo su fila', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 13 (extra, misma seccion 7 del contrato): is_staff()/is_admin() sí
-- filtran volunteers y audit_logs correctamente para admin/guard/volunteer.
-- Reutiliza los profiles del caso 12 (user1=admin, user2=guard).
-- ----------------------------------------------------------------------------
do $$
declare
  v_admin uuid := '10000000-0000-0000-0000-000000000001';
  v_guard uuid := '10000000-0000-0000-0000-000000000002';
  v_count_admin_volunteers integer;
  v_count_admin_audit      integer;
  v_count_guard_audit      integer;
begin
  set role authenticated;

  set request.jwt.claim.role = 'authenticated';
  set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
  select count(*) into v_count_admin_volunteers from volunteers;
  select count(*) into v_count_admin_audit from audit_logs;

  set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
  select count(*) into v_count_guard_audit from audit_logs;

  reset role;
  reset request.jwt.claim.role;
  reset request.jwt.claim.sub;

  insert into test_results (case_name, status, detail)
  values (
    'admin (staff) puede leer volunteers',
    case when v_count_admin_volunteers > 0 then 'PASS' else 'FAIL' end,
    format('filas_visibles=%s', v_count_admin_volunteers)
  );
  insert into test_results (case_name, status, detail)
  values (
    'admin puede leer audit_logs',
    case when v_count_admin_audit > 0 then 'PASS' else 'FAIL' end,
    format('filas_visibles=%s', v_count_admin_audit)
  );
  insert into test_results (case_name, status, detail)
  values (
    'guard (staff pero no admin) NO puede leer audit_logs',
    case when v_count_guard_audit = 0 then 'PASS' else 'FAIL' end,
    format('filas_visibles=%s', v_count_guard_audit)
  );
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('is_staff/is_admin filtran volunteers/audit_logs', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ----------------------------------------------------------------------------
-- Caso 14: reward_redemptions solo admin; point_tiers solo staff; ninguna
-- policy de lectura queda abierta (using true) para anon.
-- ----------------------------------------------------------------------------
do $$
declare
  v_admin   uuid := '10000000-0000-0000-0000-000000000001';
  v_guard   uuid := '10000000-0000-0000-0000-000000000002';
  v_noprof  uuid := '10000000-0000-0000-0000-000000000003';
  v_vol     uuid;
  v_reward  uuid;
  v_rr_anon int; v_rr_noprof int; v_rr_guard int; v_rr_admin int;
  v_pt_anon int; v_pt_noprof int; v_pt_guard int; v_pt_admin int;
  v_open    int;
begin
  insert into auth.users (id, email) values (v_noprof, 'noprofile@test.local');
  insert into volunteers (full_name, community) values ('Test RR', 'x') returning id into v_vol;
  insert into rewards (name, points_cost, stock) values ('Test reward', 10, 1) returning id into v_reward;
  insert into reward_redemptions (volunteer_id, reward_id, points_spent) values (v_vol, v_reward, 10);

  set role anon;
  select count(*) into v_rr_anon from reward_redemptions;
  select count(*) into v_pt_anon from point_tiers;
  reset role;

  set role authenticated;
  set request.jwt.claim.role = 'authenticated';
  set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
  select count(*) into v_rr_noprof from reward_redemptions;
  select count(*) into v_pt_noprof from point_tiers;
  set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
  select count(*) into v_rr_guard from reward_redemptions;
  select count(*) into v_pt_guard from point_tiers;
  set request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
  select count(*) into v_rr_admin from reward_redemptions;
  select count(*) into v_pt_admin from point_tiers;
  reset role;
  reset request.jwt.claim.role;
  reset request.jwt.claim.sub;

  select count(*) into v_open from pg_policies
  where schemaname = 'public' and cmd in ('SELECT', 'ALL') and trim(qual) = 'true';

  insert into test_results (case_name, status, detail) values (
    'anon no lee reward_redemptions ni point_tiers',
    case when v_rr_anon = 0 and v_pt_anon = 0 then 'PASS' else 'FAIL' end,
    format('rr=%s pt=%s', v_rr_anon, v_pt_anon));
  insert into test_results (case_name, status, detail) values (
    'autenticado sin perfil de staff no lee reward_redemptions ni point_tiers',
    case when v_rr_noprof = 0 and v_pt_noprof = 0 then 'PASS' else 'FAIL' end,
    format('rr=%s pt=%s', v_rr_noprof, v_pt_noprof));
  insert into test_results (case_name, status, detail) values (
    'guard NO lee reward_redemptions pero si point_tiers',
    case when v_rr_guard = 0 and v_pt_guard > 0 then 'PASS' else 'FAIL' end,
    format('rr=%s pt=%s', v_rr_guard, v_pt_guard));
  insert into test_results (case_name, status, detail) values (
    'admin lee reward_redemptions y point_tiers',
    case when v_rr_admin = 1 and v_pt_admin > 0 then 'PASS' else 'FAIL' end,
    format('rr=%s pt=%s', v_rr_admin, v_pt_admin));
  insert into test_results (case_name, status, detail) values (
    'no queda ninguna policy de lectura using (true)',
    case when v_open = 0 then 'PASS' else 'FAIL' end,
    format('policies_abiertas=%s', v_open));
exception when others then
  reset role;
  insert into test_results (case_name, status, detail) values ('reward_redemptions/point_tiers cerradas', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ============================================================================
-- Reporte final
-- ============================================================================
select seq, case_name, status, detail from test_results order by seq;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail
from test_results;

do $$
declare
  v_fail_count integer;
begin
  select count(*) into v_fail_count from test_results where status = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% caso(s) en FAIL — ver tabla de arriba', v_fail_count;
  end if;
end;
$$;
