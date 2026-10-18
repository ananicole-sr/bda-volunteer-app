-- ============================================================================
-- Casos de prueba de 005_volunteer_accounts.sql (volunteers.user_id,
-- link_volunteer_account y RLS de lectura propia). Se corre despues de
-- 30_rewards_management_cases.sql, sobre la misma base (ver run_tests.sh).
-- Un DO block por caso, una fila en test_results_005 por asercion.
--
-- "Iniciar sesion como X" = set role authenticated + request.jwt.claim.sub,
-- igual que 10_test_cases.sql (ver el stub de auth.uid() en 00_fixtures.sql).
-- ============================================================================

create table if not exists test_results_005 (
  seq        serial primary key,
  case_name  text not null,
  status     text not null check (status in ('PASS', 'FAIL')),
  detail     text
);

-- Cuentas: A y B (volunteer), C (volunteer sin vincular), admin, guard, sin profile.
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-00000000000a', 'vol-a@test.local'),
  ('f1000000-0000-0000-0000-00000000000b', 'vol-b@test.local'),
  ('f1000000-0000-0000-0000-00000000000c', 'vol-c@test.local'),
  ('f1000000-0000-0000-0000-0000000000ad', 'admin005@test.local'),
  ('f1000000-0000-0000-0000-0000000000ca', 'guard005@test.local'),
  ('f1000000-0000-0000-0000-0000000000ee', 'noprofile005@test.local');
insert into profiles (id, role) values
  ('f1000000-0000-0000-0000-00000000000a', 'volunteer'),
  ('f1000000-0000-0000-0000-00000000000b', 'volunteer'),
  ('f1000000-0000-0000-0000-00000000000c', 'volunteer'),
  ('f1000000-0000-0000-0000-0000000000ad', 'admin'),
  ('f1000000-0000-0000-0000-0000000000ca', 'guard');

-- Voluntarios: A, B y U (U nunca se vincula; tiene tarjeta para el check-in de staff).
insert into volunteers (id, full_name, community) values
  ('f2000000-0000-0000-0000-00000000000a', 'Vol A', 'Centro'),
  ('f2000000-0000-0000-0000-00000000000b', 'Vol B', 'Zapopan'),
  ('f2000000-0000-0000-0000-0000000000a0', 'Vol U sin cuenta', 'Tonala');
insert into cards (volunteer_id, uid_hmac) values (
  'f2000000-0000-0000-0000-0000000000a0',
  encode(extensions.hmac('FF0000A0', current_setting('app.card_hmac_secret'), 'sha256'), 'hex')
);

-- Historial: A con 3 check-ins, B con 2 (el trigger les suma puntos).
insert into check_ins (volunteer_id, status, event_id, client_ts, checked_in_at)
select v, 'valid', gen_random_uuid(), t, t
from (values
  ('f2000000-0000-0000-0000-00000000000a'::uuid, now() - interval '3 days'),
  ('f2000000-0000-0000-0000-00000000000a'::uuid, now() - interval '2 days'),
  ('f2000000-0000-0000-0000-00000000000a'::uuid, now() - interval '1 day'),
  ('f2000000-0000-0000-0000-00000000000b'::uuid, now() - interval '2 days'),
  ('f2000000-0000-0000-0000-00000000000b'::uuid, now() - interval '1 day')
) as x(v, t);

-- Recompensas: R1 activa, R2 inactiva canjeada por A, R3 inactiva sin canjes.
insert into rewards (id, name, points_cost, stock, is_active) values
  ('f3000000-0000-0000-0000-000000000001', 'R1 activa', 10, 5, true),
  ('f3000000-0000-0000-0000-000000000002', 'R2 inactiva canjeada', 10, 5, false),
  ('f3000000-0000-0000-0000-000000000003', 'R3 inactiva', 10, 5, false);
insert into reward_redemptions (id, volunteer_id, reward_id, points_spent) values
  ('f4000000-0000-0000-0000-00000000000a', 'f2000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-000000000002', 10),
  ('f4000000-0000-0000-0000-00000000000b', 'f2000000-0000-0000-0000-00000000000b', 'f3000000-0000-0000-0000-000000000001', 10);

-- ----------------------------------------------------------------------------
-- Caso 1: columna user_id opcional; los voluntarios existentes quedan sin vincular
-- ----------------------------------------------------------------------------
do $$
declare
  v_nullable text;
  v_linked   integer;
begin
  select is_nullable into v_nullable from information_schema.columns
   where table_name = 'volunteers' and column_name = 'user_id';
  select count(*) into v_linked from volunteers where user_id is not null;
  insert into test_results_005 (case_name, status, detail) values (
    'volunteers.user_id existe, es opcional y ningun voluntario previo queda vinculado',
    case when v_nullable = 'YES' and v_linked = 0 then 'PASS' else 'FAIL' end,
    format('nullable=%s vinculados=%s', v_nullable, v_linked));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 2: vincular A <- cuenta A: ok, audita en la misma operacion
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_uid uuid;
  v_aud integer;
begin
  set role service_role;
  v_r := link_volunteer_account('f2000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a',
                                'f1000000-0000-0000-0000-0000000000ad');
  reset role;
  select user_id into v_uid from volunteers where id = 'f2000000-0000-0000-0000-00000000000a';
  select count(*) into v_aud from audit_logs
   where event_type = 'volunteer_account_linked'
     and volunteer_id = 'f2000000-0000-0000-0000-00000000000a'
     and detail = '{"user_id": "f1000000-0000-0000-0000-00000000000a", "operator_id": "f1000000-0000-0000-0000-0000000000ad"}'::jsonb;

  insert into test_results_005 (case_name, status, detail) values (
    'link_volunteer_account: ok, already_linked=false, user_id asignado y auditado',
    case when v_r->>'code' = 'ok' and (v_r->>'already_linked')::boolean = false
          and v_uid = 'f1000000-0000-0000-0000-00000000000a' and v_aud = 1
         then 'PASS' else 'FAIL' end,
    format('r=%s filas=%s', v_r, v_aud));
exception when others then
  reset role;
  insert into test_results_005 (case_name, status, detail) values ('link ok', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 3: repetir el mismo vinculo es seguro (ok, already_linked, sin auditar)
-- ----------------------------------------------------------------------------
do $$
declare
  v_r      jsonb;
  v_before integer;
  v_after  integer;
begin
  select count(*) into v_before from audit_logs where event_type in ('volunteer_account_linked', 'link_account_rejected');
  set role service_role;
  v_r := link_volunteer_account('f2000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', null);
  reset role;
  select count(*) into v_after from audit_logs where event_type in ('volunteer_account_linked', 'link_account_rejected');

  insert into test_results_005 (case_name, status, detail) values (
    'repetir el mismo vinculo: ok, already_linked=true, no escribe auditoria',
    case when v_r->>'code' = 'ok' and (v_r->>'already_linked')::boolean = true and v_after = v_before
         then 'PASS' else 'FAIL' end,
    format('r=%s antes=%s despues=%s', v_r, v_before, v_after));
exception when others then
  reset role;
  insert into test_results_005 (case_name, status, detail) values ('link repetido', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 4: conflictos y cuentas invalidas se rechazan, se auditan y no cambian nada
-- ----------------------------------------------------------------------------
do $$
declare
  v_cases text[][] := array[
    -- volunteer_id, user_id, codigo esperado
    array['f2000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000a', 'account_in_use'],
    array['f2000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000b', 'volunteer_already_linked'],
    array['f2000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-0000000000ff', 'account_not_found'],
    array['f2000000-0000-0000-0000-0000000000ff', 'f1000000-0000-0000-0000-00000000000b', 'volunteer_not_found'],
    array['f2000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-0000000000ad', 'account_not_volunteer'],
    array['f2000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-0000000000ca', 'account_not_volunteer'],
    array['f2000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-0000000000ee', 'account_not_volunteer']
  ];
  v_i     integer;
  v_r     jsonb;
  v_bad   text := '';
  v_aud   integer;
  v_a     uuid;
  v_b     uuid;
begin
  for v_i in 1 .. array_length(v_cases, 1) loop
    set role service_role;
    v_r := link_volunteer_account(v_cases[v_i][1]::uuid, v_cases[v_i][2]::uuid, 'f1000000-0000-0000-0000-0000000000ad');
    reset role;
    select count(*) into v_aud from audit_logs
     where event_type = 'link_account_rejected'
       and detail->>'reason' = v_cases[v_i][3]
       and detail->>'volunteer_id' = v_cases[v_i][1]
       and detail->>'user_id' = v_cases[v_i][2];
    if v_r->>'code' is distinct from v_cases[v_i][3] or v_aud < 1 then
      v_bad := v_bad || format('[%s: %s aud=%s] ', v_i, v_r->>'code', v_aud);
    end if;
  end loop;
  select user_id into v_a from volunteers where id = 'f2000000-0000-0000-0000-00000000000a';
  select user_id into v_b from volunteers where id = 'f2000000-0000-0000-0000-00000000000b';

  insert into test_results_005 (case_name, status, detail) values (
    'rechaza account_in_use, volunteer_already_linked, account_not_found, volunteer_not_found y account_not_volunteer (admin/guard/sin profile), auditados',
    case when v_bad = '' then 'PASS' else 'FAIL' end,
    coalesce(nullif(v_bad, ''), 'los 7 con su codigo y auditoria'));
  insert into test_results_005 (case_name, status, detail) values (
    'tras los rechazos A sigue con su cuenta y B sigue sin vincular',
    case when v_a = 'f1000000-0000-0000-0000-00000000000a' and v_b is null then 'PASS' else 'FAIL' end,
    format('A=%s B=%s', v_a, v_b));
exception when others then
  reset role;
  insert into test_results_005 (case_name, status, detail) values ('rechazos de link', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 5: el UNIQUE impide que una cuenta represente a dos voluntarios
-- aunque alguien escriba directo con privilegios (sin pasar por la funcion)
-- ----------------------------------------------------------------------------
do $$
declare
  v_state text := 'sin error';
begin
  begin
    update volunteers set user_id = 'f1000000-0000-0000-0000-00000000000a'
     where id = 'f2000000-0000-0000-0000-0000000000a0';
  exception when unique_violation then
    v_state := 'unique_violation';
  end;
  insert into test_results_005 (case_name, status, detail) values (
    'UNIQUE(user_id): una cuenta no puede quedar en dos voluntarios',
    case when v_state = 'unique_violation' then 'PASS' else 'FAIL' end, v_state);
end;
$$;

-- Vincula B <- cuenta B para los casos de aislamiento.
do $$
begin
  set role service_role;
  perform link_volunteer_account('f2000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000b', null);
  reset role;
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 6: solo service_role ejecuta link_volunteer_account; el cliente no
-- puede escribir user_id directo (ni siquiera sobre su propia fila)
-- ----------------------------------------------------------------------------
do $$
declare
  v_role  text;
  v_what  text;
  v_ok    boolean;
  v_count integer;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_what in array array['rpc', 'update_own', 'update_other', 'insert'] loop
      v_ok := false;
      begin
        execute format('set role %I', v_role);
        perform set_config('request.jwt.claim.role', v_role, false);
        perform set_config('request.jwt.claim.sub',
          case when v_role = 'authenticated' then 'f1000000-0000-0000-0000-00000000000c' else '' end, false);
        case v_what
          when 'rpc' then
            perform link_volunteer_account('f2000000-0000-0000-0000-0000000000a0', 'f1000000-0000-0000-0000-00000000000c', null);
          when 'update_own' then
            -- C intenta quedarse con el voluntario U
            update volunteers set user_id = 'f1000000-0000-0000-0000-00000000000c'
             where id = 'f2000000-0000-0000-0000-0000000000a0';
          when 'update_other' then
            update volunteers set user_id = null where id = 'f2000000-0000-0000-0000-00000000000a';
          when 'insert' then
            insert into volunteers (full_name, user_id) values ('Hack', 'f1000000-0000-0000-0000-00000000000c');
        end case;
        reset role;
      exception when insufficient_privilege then
        v_ok := true;
        reset role;
      end;
      perform set_config('request.jwt.claim.sub', '', false);
      perform set_config('request.jwt.claim.role', '', false);
      insert into test_results_005 (case_name, status, detail)
      values (format('%s no puede %s', v_role,
                     case v_what when 'rpc' then 'ejecutar link_volunteer_account'
                                 when 'update_own' then 'asignarse user_id en volunteers'
                                 when 'update_other' then 'cambiar el user_id de otro voluntario'
                                 else 'insertar volunteers con user_id' end),
              case when v_ok then 'PASS' else 'FAIL' end, null);
    end loop;
  end loop;

  select count(*) into v_count from volunteers
   where (id = 'f2000000-0000-0000-0000-0000000000a0' and user_id is not null)
      or (id = 'f2000000-0000-0000-0000-00000000000a' and user_id is distinct from 'f1000000-0000-0000-0000-00000000000a')
      or full_name = 'Hack';
  insert into test_results_005 (case_name, status, detail) values (
    'tras los intentos del cliente ningun user_id cambio',
    case when v_count = 0 then 'PASS' else 'FAIL' end, format('filas_alteradas=%s', v_count));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 7: voluntario A ve SOLO lo suyo; nada de B, ni tarjetas, auditoria o tiers
-- ----------------------------------------------------------------------------
do $$
declare
  v_vols     integer; v_vol_id uuid;
  v_ci       integer; v_ci_b   integer;
  v_rr       integer; v_rr_b   integer;
  v_rw_ids   text;
  v_cards    integer; v_audit  integer; v_tiers integer; v_profiles integer;
  v_b_direct integer;
begin
  set role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-00000000000a', false);

  select count(*), max(id::text)::uuid into v_vols, v_vol_id from volunteers;
  select count(*) into v_ci from check_ins;
  select count(*) into v_ci_b from check_ins where volunteer_id = 'f2000000-0000-0000-0000-00000000000b';
  select count(*) into v_rr from reward_redemptions;
  select count(*) into v_rr_b from reward_redemptions where volunteer_id = 'f2000000-0000-0000-0000-00000000000b';
  select string_agg(name, ',' order by name) into v_rw_ids from rewards where id::text like 'f3000000%';
  select count(*) into v_cards from cards;
  select count(*) into v_audit from audit_logs;
  select count(*) into v_tiers from point_tiers;
  select count(*) into v_profiles from profiles;
  select count(*) into v_b_direct from volunteers where id = 'f2000000-0000-0000-0000-00000000000b';

  reset role;
  perform set_config('request.jwt.claim.sub', '', false);

  insert into test_results_005 (case_name, status, detail) values (
    'voluntario A lee solo su fila de volunteers (ni B ni los no vinculados)',
    case when v_vols = 1 and v_vol_id = 'f2000000-0000-0000-0000-00000000000a' and v_b_direct = 0 then 'PASS' else 'FAIL' end,
    format('visibles=%s id=%s B_directo=%s', v_vols, v_vol_id, v_b_direct));
  insert into test_results_005 (case_name, status, detail) values (
    'voluntario A lee solo sus 3 check-ins; filtrar por B devuelve 0',
    case when v_ci = 3 and v_ci_b = 0 then 'PASS' else 'FAIL' end,
    format('check_ins=%s de_B=%s', v_ci, v_ci_b));
  insert into test_results_005 (case_name, status, detail) values (
    'voluntario A lee solo su canje; filtrar por B devuelve 0',
    case when v_rr = 1 and v_rr_b = 0 then 'PASS' else 'FAIL' end,
    format('canjes=%s de_B=%s', v_rr, v_rr_b));
  insert into test_results_005 (case_name, status, detail) values (
    'voluntario A ve recompensas activas + la inactiva que canjeo, no otras inactivas',
    case when v_rw_ids = 'R1 activa,R2 inactiva canjeada' then 'PASS' else 'FAIL' end,
    format('visibles=%s', v_rw_ids));
  insert into test_results_005 (case_name, status, detail) values (
    'voluntario A no ve cards (HMAC), audit_logs ni point_tiers; solo su profile',
    case when v_cards = 0 and v_audit = 0 and v_tiers = 0 and v_profiles = 1 then 'PASS' else 'FAIL' end,
    format('cards=%s audit=%s tiers=%s profiles=%s', v_cards, v_audit, v_tiers, v_profiles));
exception when others then
  reset role;
  insert into test_results_005 (case_name, status, detail) values ('aislamiento A', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 8: B ve lo suyo y nada de A (simetria)
-- ----------------------------------------------------------------------------
do $$
declare
  v_vol uuid; v_ci integer; v_rr_a integer; v_rw text;
begin
  set role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-00000000000b', false);
  select id into v_vol from volunteers;
  select count(*) into v_ci from check_ins;
  select count(*) into v_rr_a from reward_redemptions where volunteer_id = 'f2000000-0000-0000-0000-00000000000a';
  select string_agg(name, ',' order by name) into v_rw from rewards where id::text like 'f3000000%';
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);

  insert into test_results_005 (case_name, status, detail) values (
    'voluntario B ve su fila y sus 2 check-ins, ningun canje de A, y no ve la R2 que canjeo A',
    case when v_vol = 'f2000000-0000-0000-0000-00000000000b' and v_ci = 2 and v_rr_a = 0 and v_rw = 'R1 activa'
         then 'PASS' else 'FAIL' end,
    format('vol=%s check_ins=%s canjes_A=%s rewards=%s', v_vol, v_ci, v_rr_a, v_rw));
exception when others then
  reset role;
  insert into test_results_005 (case_name, status, detail) values ('aislamiento B', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 9: cuenta volunteer SIN vincular: no ve datos personales, si el catalogo activo.
-- Cuenta sin profile: no ve nada.
-- ----------------------------------------------------------------------------
do $$
declare
  v_c_vol integer; v_c_ci integer; v_c_rr integer; v_c_rw text; v_c_myid uuid;
  v_n_vol integer; v_n_rw integer;
begin
  set role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-00000000000c', false);
  select count(*) into v_c_vol from volunteers;
  select count(*) into v_c_ci from check_ins;
  select count(*) into v_c_rr from reward_redemptions;
  select string_agg(name, ',' order by name) into v_c_rw from rewards where id::text like 'f3000000%';
  v_c_myid := my_volunteer_id();
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-0000000000ee', false);
  select count(*) into v_n_vol from volunteers;
  select count(*) into v_n_rw from rewards;
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);

  insert into test_results_005 (case_name, status, detail) values (
    'volunteer sin vincular: 0 voluntarios/check-ins/canjes, my_volunteer_id() null, catalogo solo activas',
    case when v_c_vol = 0 and v_c_ci = 0 and v_c_rr = 0 and v_c_myid is null and v_c_rw = 'R1 activa'
         then 'PASS' else 'FAIL' end,
    format('vol=%s ci=%s rr=%s myid=%s rewards=%s', v_c_vol, v_c_ci, v_c_rr, v_c_myid, v_c_rw));
  insert into test_results_005 (case_name, status, detail) values (
    'cuenta autenticada sin profile no ve voluntarios ni recompensas',
    case when v_n_vol = 0 and v_n_rw = 0 then 'PASS' else 'FAIL' end,
    format('vol=%s rewards=%s', v_n_vol, v_n_rw));
exception when others then
  reset role;
  insert into test_results_005 (case_name, status, detail) values ('sin vincular / sin profile', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 10: anon no ve nada
-- ----------------------------------------------------------------------------
do $$
declare
  v_vol integer; v_ci integer; v_rr integer; v_rw integer;
begin
  set role anon;
  perform set_config('request.jwt.claim.role', 'anon', false);
  select count(*) into v_vol from volunteers;
  select count(*) into v_ci from check_ins;
  select count(*) into v_rr from reward_redemptions;
  select count(*) into v_rw from rewards;
  reset role;
  perform set_config('request.jwt.claim.role', '', false);
  insert into test_results_005 (case_name, status, detail) values (
    'anon (sin sesion) no lee volunteers, check_ins, reward_redemptions ni rewards',
    case when v_vol + v_ci + v_rr + v_rw = 0 then 'PASS' else 'FAIL' end,
    format('vol=%s ci=%s rr=%s rw=%s', v_vol, v_ci, v_rr, v_rw));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 11: staff sin cambios: guard y admin leen todo lo de antes, incluidos
-- los voluntarios no vinculados; el check-in de un no vinculado funciona
-- ----------------------------------------------------------------------------
do $$
declare
  v_g_vol integer; v_g_u integer; v_g_ci integer; v_g_rw integer; v_g_cards integer; v_g_audit integer; v_g_rr integer;
  v_a_vol integer; v_a_audit integer; v_a_rr integer;
  v_total_vol integer; v_total_ci integer; v_total_rw integer;
  v_hmac text;
  v_ci jsonb;
begin
  select count(*) into v_total_vol from volunteers;
  select count(*) into v_total_ci from check_ins;
  select count(*) into v_total_rw from rewards;

  set role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-0000000000ca', false);
  select count(*) into v_g_vol from volunteers;
  select count(*) into v_g_u from volunteers where id = 'f2000000-0000-0000-0000-0000000000a0' and user_id is null;
  select count(*) into v_g_ci from check_ins;
  select count(*) into v_g_rw from rewards;
  select count(*) into v_g_cards from cards;
  select count(*) into v_g_audit from audit_logs;
  select count(*) into v_g_rr from reward_redemptions;
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-0000000000ad', false);
  select count(*) into v_a_vol from volunteers;
  select count(*) into v_a_audit from audit_logs;
  select count(*) into v_a_rr from reward_redemptions;
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);

  v_hmac := encode(extensions.hmac('FF0000A0', current_setting('app.card_hmac_secret'), 'sha256'), 'hex');
  set role service_role;
  v_ci := register_check_in(gen_random_uuid(), v_hmac, 'term-005', 'f1000000-0000-0000-0000-0000000000ca', now());
  reset role;

  insert into test_results_005 (case_name, status, detail) values (
    'guard lee todos los volunteers (incl. no vinculados), check_ins, rewards y cards; no audit ni canjes',
    case when v_g_vol = v_total_vol and v_g_u = 1 and v_g_ci = v_total_ci and v_g_rw = v_total_rw
          and v_g_cards > 0 and v_g_audit = 0 and v_g_rr = 0
         then 'PASS' else 'FAIL' end,
    format('vol=%s/%s u=%s ci=%s/%s rw=%s/%s cards=%s audit=%s rr=%s',
           v_g_vol, v_total_vol, v_g_u, v_g_ci, v_total_ci, v_g_rw, v_total_rw, v_g_cards, v_g_audit, v_g_rr));
  insert into test_results_005 (case_name, status, detail) values (
    'admin sigue leyendo todos los volunteers, audit_logs y reward_redemptions',
    case when v_a_vol = v_total_vol and v_a_audit > 0 and v_a_rr >= 2 then 'PASS' else 'FAIL' end,
    format('vol=%s audit=%s rr=%s', v_a_vol, v_a_audit, v_a_rr));
  insert into test_results_005 (case_name, status, detail) values (
    'voluntario no vinculado sigue haciendo check-in por NFC (staff)',
    case when v_ci->>'code' = 'ok' then 'PASS' else 'FAIL' end, format('r=%s', v_ci));
exception when others then
  reset role;
  insert into test_results_005 (case_name, status, detail) values ('staff sin cambios', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 12: borrar la cuenta de Auth de B no borra al voluntario ni su historial
-- ----------------------------------------------------------------------------
do $$
declare
  v_ci_before integer; v_ci_after integer;
  v_rr_after  integer;
  v_vol       volunteers%rowtype;
begin
  select count(*) into v_ci_before from check_ins where volunteer_id = 'f2000000-0000-0000-0000-00000000000b';
  delete from auth.users where id = 'f1000000-0000-0000-0000-00000000000b';
  select * into v_vol from volunteers where id = 'f2000000-0000-0000-0000-00000000000b';
  select count(*) into v_ci_after from check_ins where volunteer_id = 'f2000000-0000-0000-0000-00000000000b';
  select count(*) into v_rr_after from reward_redemptions where volunteer_id = 'f2000000-0000-0000-0000-00000000000b';

  insert into test_results_005 (case_name, status, detail) values (
    'borrar la cuenta de Auth: voluntario sigue (user_id null), con sus check-ins, puntos y canjes',
    case when v_vol.id is not null and v_vol.user_id is null
          and v_ci_after = v_ci_before and v_ci_before = 2 and v_rr_after = 1 and v_vol.points > 0
         then 'PASS' else 'FAIL' end,
    format('user_id=%s ci=%s->%s rr=%s puntos=%s', v_vol.user_id, v_ci_before, v_ci_after, v_rr_after, v_vol.points));
exception when others then
  insert into test_results_005 (case_name, status, detail) values ('borrar cuenta Auth', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;


-- ============================================================================
-- Reporte final
-- ============================================================================
select seq, case_name, status, detail from test_results_005 order by seq;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail
from test_results_005;

do $$
declare
  v_fail_count integer;
begin
  select count(*) into v_fail_count from test_results_005 where status = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% caso(s) de 005 en FAIL — ver tabla de arriba', v_fail_count;
  end if;
end;
$$;
