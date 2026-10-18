-- ============================================================================
-- Casos de prueba de 006_redemptions.sql (redeem_rewards,
-- mark_redemption_delivered, notificaciones de admin y su RLS). Se corre
-- despues de 40_volunteer_accounts_cases.sql, sobre la misma base. La
-- concurrencia y el historial previo a 006 se prueban en run_tests.sh
-- ([1d] y [2c]). Un DO block por caso, una fila en test_results_006 por asercion.
-- ============================================================================

create table if not exists test_results_006 (
  seq        serial primary key,
  case_name  text not null,
  status     text not null check (status in ('PASS', 'FAIL')),
  detail     text
);

-- Cuentas: A, B, C, I (inactivo), U (volunteer sin vincular), 2 admins, guard.
insert into auth.users (id, email) values
  ('a6000000-0000-0000-0000-00000000000a', 'red-a@test.local'),
  ('a6000000-0000-0000-0000-00000000000b', 'red-b@test.local'),
  ('a6000000-0000-0000-0000-00000000000c', 'red-c@test.local'),
  ('a6000000-0000-0000-0000-0000000000a1', 'red-i@test.local'),
  ('a6000000-0000-0000-0000-0000000000a2', 'red-u@test.local'),
  ('a6000000-0000-0000-0000-0000000000d1', 'red-admin1@test.local'),
  ('a6000000-0000-0000-0000-0000000000d2', 'red-admin2@test.local'),
  ('a6000000-0000-0000-0000-0000000000ca', 'red-guard@test.local');
insert into profiles (id, role) values
  ('a6000000-0000-0000-0000-00000000000a', 'volunteer'),
  ('a6000000-0000-0000-0000-00000000000b', 'volunteer'),
  ('a6000000-0000-0000-0000-00000000000c', 'volunteer'),
  ('a6000000-0000-0000-0000-0000000000a1', 'volunteer'),
  ('a6000000-0000-0000-0000-0000000000a2', 'volunteer'),
  ('a6000000-0000-0000-0000-0000000000d1', 'admin'),
  ('a6000000-0000-0000-0000-0000000000d2', 'admin'),
  ('a6000000-0000-0000-0000-0000000000ca', 'guard');

insert into volunteers (id, full_name, community, points, user_id, is_active) values
  ('b6000000-0000-0000-0000-00000000000a', 'Red A', 'Centro', 500, 'a6000000-0000-0000-0000-00000000000a', true),
  ('b6000000-0000-0000-0000-00000000000b', 'Red B', 'Zapopan', 1000, 'a6000000-0000-0000-0000-00000000000b', true),
  ('b6000000-0000-0000-0000-00000000000c', 'Red C', 'Tonala', 500, 'a6000000-0000-0000-0000-00000000000c', true),
  ('b6000000-0000-0000-0000-0000000000a1', 'Red Inactivo', 'x', 1000, 'a6000000-0000-0000-0000-0000000000a1', false);

insert into rewards (id, name, points_cost, stock, is_active) values
  ('c6000000-0000-0000-0000-000000000100', 'Cien', 100, 5, true),
  ('c6000000-0000-0000-0000-000000000200', 'Doscientos', 200, 5, true),
  ('c6000000-0000-0000-0000-000000000600', 'Seiscientos', 600, 5, true),
  ('c6000000-0000-0000-0000-0000000000e1', 'Inactiva', 50, 5, false),
  ('c6000000-0000-0000-0000-0000000000e0', 'Sin stock', 10, 0, true),
  ('c6000000-0000-0000-0000-0000000000b1', 'Para B', 10, 5, true);

-- Atajos de lectura para las aserciones.
create or replace function pg_temp.pts(p uuid) returns integer language sql as $$ select points from volunteers where id = p $$;
create or replace function pg_temp.stk(p uuid) returns integer language sql as $$ select stock from rewards where id = p $$;
create or replace function pg_temp.n_req(p uuid) returns integer language sql as $$ select count(*)::int from redemption_requests where volunteer_id = p $$;
create or replace function pg_temp.n_items(p uuid) returns integer language sql as $$ select count(*)::int from reward_redemptions where volunteer_id = p $$;
create or replace function pg_temp.n_notif() returns integer language sql as $$ select count(*)::int from admin_notifications $$;

-- ----------------------------------------------------------------------------
-- Caso 1: 500 pts, canjea 100 + 200 -> ok, quedan 200; stock, solicitud,
-- renglones con costo historico, notificacion y auditoria
-- ----------------------------------------------------------------------------
do $$
declare
  v_r    jsonb;
  v_req  redemption_requests%rowtype;
  v_items text;
  v_n    admin_notifications%rowtype;
  v_aud  integer;
begin
  set role service_role;
  v_r := redeem_rewards('a6000000-0000-0000-0000-00000000000a', 'd6000000-0000-4000-8000-000000000001',
                        array['c6000000-0000-0000-0000-000000000200', 'c6000000-0000-0000-0000-000000000100']::uuid[]);
  reset role;

  select * into v_req from redemption_requests where volunteer_id = 'b6000000-0000-0000-0000-00000000000a';
  select string_agg(format('%s=%s', reward_id, points_spent), ',' order by reward_id) into v_items
    from reward_redemptions where request_id = v_req.id;
  select * into v_n from admin_notifications where request_id = v_req.id;
  select count(*) into v_aud from audit_logs
   where event_type = 'redemption_requested' and detail->>'request_id' = v_req.id::text;

  insert into test_results_006 (case_name, status, detail) values (
    '500 pts canjea 100 + 200: ok, balance 200, puntos 200',
    case when v_r->>'code' = 'ok' and (v_r->>'replayed')::boolean = false
          and (v_r->>'balance')::int = 200 and pg_temp.pts('b6000000-0000-0000-0000-00000000000a') = 200
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_r));
  insert into test_results_006 (case_name, status, detail) values (
    'descuenta 1 de stock a cada recompensa seleccionada',
    case when pg_temp.stk('c6000000-0000-0000-0000-000000000100') = 4
          and pg_temp.stk('c6000000-0000-0000-0000-000000000200') = 4
         then 'PASS' else 'FAIL' end, null);
  insert into test_results_006 (case_name, status, detail) values (
    'solicitud pending_delivery con total 300, 2 renglones con costo historico',
    case when v_req.status = 'pending_delivery' and v_req.total_points = 300 and v_req.item_count = 2
          and v_req.requested_by = 'a6000000-0000-0000-0000-00000000000a' and v_req.delivered_at is null
          and v_items = 'c6000000-0000-0000-0000-000000000100=100,c6000000-0000-0000-0000-000000000200=200'
          and jsonb_array_length(v_r->'request'->'items') = 2
         then 'PASS' else 'FAIL' end,
    format('status=%s total=%s items=%s', v_req.status, v_req.total_points, v_items));
  insert into test_results_006 (case_name, status, detail) values (
    'una notificacion de admin que dice quien canjeo que, y auditoria redemption_requested',
    case when v_n.id is not null and v_n.type = 'redemption_requested'
          and v_n.message = 'Red A canjeó: Cien (100 pts), Doscientos (200 pts). Total: 300 pts.'
          and v_n.payload->>'volunteer_name' = 'Red A'
          and jsonb_array_length(v_n.payload->'items') = 2
          and v_aud = 1
         then 'PASS' else 'FAIL' end,
    format('msg=%s aud=%s', v_n.message, v_aud));
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('canje 100 + 200', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 2: reintento con el mismo request_id (en otro orden) -> ok replayed,
-- sin cobrar, sin stock, sin solicitud ni notificacion nuevas
-- ----------------------------------------------------------------------------
do $$
declare
  v_r     jsonb;
  v_notif integer := pg_temp.n_notif();
  v_aud   integer;
begin
  select count(*) into v_aud from audit_logs where event_type = 'redemption_requested';
  set role service_role;
  v_r := redeem_rewards('a6000000-0000-0000-0000-00000000000a', 'd6000000-0000-4000-8000-000000000001',
                        array['c6000000-0000-0000-0000-000000000100', 'c6000000-0000-0000-0000-000000000200']::uuid[]);
  v_r := redeem_rewards('a6000000-0000-0000-0000-00000000000a', 'd6000000-0000-4000-8000-000000000001',
                        array['c6000000-0000-0000-0000-000000000100', 'c6000000-0000-0000-0000-000000000200']::uuid[]);
  reset role;

  insert into test_results_006 (case_name, status, detail) values (
    'reintento (x2) con el mismo request_id: ok replayed, mismo request, sin cobrar ni duplicar nada',
    case when v_r->>'code' = 'ok' and (v_r->>'replayed')::boolean = true
          and (v_r->'request'->>'total_points')::int = 300
          and pg_temp.pts('b6000000-0000-0000-0000-00000000000a') = 200
          and pg_temp.stk('c6000000-0000-0000-0000-000000000100') = 4
          and pg_temp.stk('c6000000-0000-0000-0000-000000000200') = 4
          and pg_temp.n_req('b6000000-0000-0000-0000-00000000000a') = 1
          and pg_temp.n_items('b6000000-0000-0000-0000-00000000000a') = 2
          and pg_temp.n_notif() = v_notif
          and (select count(*) from audit_logs where event_type = 'redemption_requested') = v_aud
         then 'PASS' else 'FAIL' end,
    format('r=%s notif=%s->%s', v_r->>'code', v_notif, pg_temp.n_notif()));
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('reintento', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 3: mismo request_id con otras recompensas -> idempotency_conflict
-- ----------------------------------------------------------------------------
do $$
declare
  v_r jsonb;
begin
  set role service_role;
  v_r := redeem_rewards('a6000000-0000-0000-0000-00000000000a', 'd6000000-0000-4000-8000-000000000001',
                        array['c6000000-0000-0000-0000-000000000100']::uuid[]);
  reset role;
  insert into test_results_006 (case_name, status, detail) values (
    'mismo request_id con otras recompensas -> idempotency_conflict, sin cambios',
    case when v_r->>'code' = 'idempotency_conflict'
          and pg_temp.pts('b6000000-0000-0000-0000-00000000000a') = 200
          and pg_temp.stk('c6000000-0000-0000-0000-000000000100') = 4
          and pg_temp.n_req('b6000000-0000-0000-0000-00000000000a') = 1
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_r));
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('idempotency_conflict', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 4: puntos insuficientes (500 no alcanza 600; 200 no alcanza 100+200)
-- ----------------------------------------------------------------------------
do $$
declare
  v_c jsonb;
  v_a jsonb;
begin
  set role service_role;
  v_c := redeem_rewards('a6000000-0000-0000-0000-00000000000c', gen_random_uuid(),
                        array['c6000000-0000-0000-0000-000000000600']::uuid[]);
  v_a := redeem_rewards('a6000000-0000-0000-0000-00000000000a', gen_random_uuid(),
                        array['c6000000-0000-0000-0000-000000000100', 'c6000000-0000-0000-0000-000000000200']::uuid[]);
  reset role;
  insert into test_results_006 (case_name, status, detail) values (
    '500 pts no puede canjear 600 -> insufficient_points (required 600, available 500), sin cambios',
    case when v_c->>'code' = 'insufficient_points'
          and (v_c->>'required')::int = 600 and (v_c->>'available')::int = 500
          and pg_temp.pts('b6000000-0000-0000-0000-00000000000c') = 500
          and pg_temp.stk('c6000000-0000-0000-0000-000000000600') = 5
          and pg_temp.n_req('b6000000-0000-0000-0000-00000000000c') = 0
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_c));
  insert into test_results_006 (case_name, status, detail) values (
    'la suma cuenta: con 200 no alcanza 100 + 200 -> insufficient_points, sin cambios',
    case when v_a->>'code' = 'insufficient_points' and (v_a->>'required')::int = 300
          and pg_temp.pts('b6000000-0000-0000-0000-00000000000a') = 200
          and pg_temp.stk('c6000000-0000-0000-0000-000000000100') = 4
         then 'PASS' else 'FAIL' end,
    format('r=%s', v_a));
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('insufficient_points', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 5: una recompensa mala invalida TODA la seleccion (inactiva, sin stock,
-- inexistente); la buena tampoco se cobra
-- ----------------------------------------------------------------------------
do $$
declare
  v_inact jsonb; v_zero jsonb; v_none jsonb;
  v_late_inact jsonb; v_late_zero jsonb; v_late_none jsonb;
  v_notif integer := pg_temp.n_notif();
begin
  set role service_role;
  v_inact := redeem_rewards('a6000000-0000-0000-0000-00000000000c', gen_random_uuid(),
               array['c6000000-0000-0000-0000-000000000100', 'c6000000-0000-0000-0000-0000000000e1']::uuid[]);
  v_zero  := redeem_rewards('a6000000-0000-0000-0000-00000000000c', gen_random_uuid(),
               array['c6000000-0000-0000-0000-000000000100', 'c6000000-0000-0000-0000-0000000000e0']::uuid[]);
  v_none  := redeem_rewards('a6000000-0000-0000-0000-00000000000c', gen_random_uuid(),
               array['c6000000-0000-0000-0000-000000000100', 'c6000000-0000-0000-0000-0000000000ff']::uuid[]);
  -- Mismas fallas, pero con la recompensa mala DESPUES de la buena en orden de
  -- id ('...b1' < '...e0' < '...e1' < '...ff'): se valida toda la seleccion.
  v_late_inact := redeem_rewards('a6000000-0000-0000-0000-00000000000c', gen_random_uuid(),
               array['c6000000-0000-0000-0000-0000000000e1', 'c6000000-0000-0000-0000-0000000000b1']::uuid[]);
  v_late_zero  := redeem_rewards('a6000000-0000-0000-0000-00000000000c', gen_random_uuid(),
               array['c6000000-0000-0000-0000-0000000000b1', 'c6000000-0000-0000-0000-0000000000e0']::uuid[]);
  v_late_none  := redeem_rewards('a6000000-0000-0000-0000-00000000000c', gen_random_uuid(),
               array['c6000000-0000-0000-0000-0000000000b1', 'c6000000-0000-0000-0000-0000000000ff']::uuid[]);
  reset role;

  insert into test_results_006 (case_name, status, detail) values (
    'la recompensa mala se detecta aunque vaya despues de la buena (orden de id); la buena no se cobra',
    case when v_late_inact->>'code' = 'reward_unavailable' and v_late_zero->>'code' = 'reward_unavailable'
          and v_late_none->>'code' = 'reward_unavailable'
          and pg_temp.stk('c6000000-0000-0000-0000-0000000000b1') = 5
          and pg_temp.pts('b6000000-0000-0000-0000-00000000000c') = 500
         then 'PASS' else 'FAIL' end,
    format('inact=%s zero=%s none=%s', v_late_inact->>'code', v_late_zero->>'code', v_late_none->>'code'));

  insert into test_results_006 (case_name, status, detail) values (
    'reward_unavailable con motivo por recompensa: inactive, out_of_stock, not_found',
    case when v_inact->>'code' = 'reward_unavailable'
          and v_inact->'rewards' = '[{"reason": "inactive", "reward_id": "c6000000-0000-0000-0000-0000000000e1"}]'::jsonb
          and v_zero->'rewards' = '[{"reason": "out_of_stock", "reward_id": "c6000000-0000-0000-0000-0000000000e0"}]'::jsonb
          and v_none->'rewards' = '[{"reason": "not_found", "reward_id": "c6000000-0000-0000-0000-0000000000ff"}]'::jsonb
         then 'PASS' else 'FAIL' end,
    format('inact=%s zero=%s none=%s', v_inact->'rewards', v_zero->'rewards', v_none->'rewards'));
  insert into test_results_006 (case_name, status, detail) values (
    'la seleccion completa se rechaza: la recompensa valida no se cobra ni descuenta stock',
    case when pg_temp.pts('b6000000-0000-0000-0000-00000000000c') = 500
          and pg_temp.stk('c6000000-0000-0000-0000-000000000100') = 4
          and pg_temp.n_req('b6000000-0000-0000-0000-00000000000c') = 0
          and pg_temp.n_items('b6000000-0000-0000-0000-00000000000c') = 0
          and pg_temp.n_notif() = v_notif
         then 'PASS' else 'FAIL' end,
    format('puntos=%s stock100=%s', pg_temp.pts('b6000000-0000-0000-0000-00000000000c'), pg_temp.stk('c6000000-0000-0000-0000-000000000100')));
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('reward_unavailable', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 6: voluntario inactivo / cuenta sin vincular / cuenta inexistente
-- ----------------------------------------------------------------------------
do $$
declare
  v_i jsonb; v_u jsonb; v_x jsonb;
begin
  set role service_role;
  v_i := redeem_rewards('a6000000-0000-0000-0000-0000000000a1', gen_random_uuid(), array['c6000000-0000-0000-0000-000000000100']::uuid[]);
  v_u := redeem_rewards('a6000000-0000-0000-0000-0000000000a2', gen_random_uuid(), array['c6000000-0000-0000-0000-000000000100']::uuid[]);
  v_x := redeem_rewards('a6000000-0000-0000-0000-0000000000ff', gen_random_uuid(), array['c6000000-0000-0000-0000-000000000100']::uuid[]);
  reset role;
  insert into test_results_006 (case_name, status, detail) values (
    'voluntario inactivo -> volunteer_inactive; sin vincular o inexistente -> volunteer_not_linked; sin cambios',
    case when v_i->>'code' = 'volunteer_inactive' and v_u->>'code' = 'volunteer_not_linked'
          and v_x->>'code' = 'volunteer_not_linked'
          and pg_temp.pts('b6000000-0000-0000-0000-0000000000a1') = 1000
          and pg_temp.n_req('b6000000-0000-0000-0000-0000000000a1') = 0
          and pg_temp.stk('c6000000-0000-0000-0000-000000000100') = 4
         then 'PASS' else 'FAIL' end,
    format('i=%s u=%s x=%s', v_i->>'code', v_u->>'code', v_x->>'code'));
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('inactivo / sin vincular', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 7: entrada invalida aborta con 22023 (vacia, null, duplicados, >20)
-- ----------------------------------------------------------------------------
do $$
declare
  v_state text;
  v_bad   text := '';
  v_i     integer;
  v_many  uuid[];
begin
  select array_agg(gen_random_uuid()) into v_many from generate_series(1, 21);
  for v_i in 1 .. 6 loop
    v_state := 'sin error';
    begin
      set role service_role;
      case v_i
        when 1 then perform redeem_rewards('a6000000-0000-0000-0000-00000000000b', gen_random_uuid(), '{}'::uuid[]);
        when 2 then perform redeem_rewards('a6000000-0000-0000-0000-00000000000b', gen_random_uuid(), null);
        when 3 then perform redeem_rewards('a6000000-0000-0000-0000-00000000000b', gen_random_uuid(),
                      array['c6000000-0000-0000-0000-0000000000b1', 'c6000000-0000-0000-0000-0000000000b1']::uuid[]);
        when 4 then perform redeem_rewards('a6000000-0000-0000-0000-00000000000b', gen_random_uuid(),
                      array['c6000000-0000-0000-0000-0000000000b1', null]::uuid[]);
        when 5 then perform redeem_rewards('a6000000-0000-0000-0000-00000000000b', gen_random_uuid(), v_many);
        when 6 then perform redeem_rewards('a6000000-0000-0000-0000-00000000000b', null,
                      array['c6000000-0000-0000-0000-0000000000b1']::uuid[]);
      end case;
      reset role;
    exception when others then
      v_state := sqlstate;
      reset role;
    end;
    if v_state <> '22023' then v_bad := v_bad || format('[%s: %s] ', v_i, v_state); end if;
  end loop;
  insert into test_results_006 (case_name, status, detail) values (
    'redeem_rewards rechaza seleccion vacia/null, ids duplicados o nulos, >20 y request_id null (22023), sin cambios',
    case when v_bad = '' and pg_temp.pts('b6000000-0000-0000-0000-00000000000b') = 1000
          and pg_temp.stk('c6000000-0000-0000-0000-0000000000b1') = 5
         then 'PASS' else 'FAIL' end,
    coalesce(nullif(v_bad, ''), 'todas 22023'));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 8: un fallo A MITAD de la escritura (forzado con un trigger en
-- admin_notifications) revierte todo: puntos, stock, solicitud y renglones
-- ----------------------------------------------------------------------------
create or replace function t006_boom_fn() returns trigger language plpgsql as $$
begin
  if new.payload->>'volunteer_name' = 'Red B' then
    raise exception 'fallo forzado al insertar la notificacion';
  end if;
  return new;
end $$;
create trigger t006_boom before insert on admin_notifications for each row execute function t006_boom_fn();

do $$
declare
  v_state text := 'sin error';
begin
  begin
    set role service_role;
    perform redeem_rewards('a6000000-0000-0000-0000-00000000000b', 'd6000000-0000-4000-8000-0000000000b8',
                           array['c6000000-0000-0000-0000-0000000000b1', 'c6000000-0000-0000-0000-000000000200']::uuid[]);
    reset role;
  exception when others then
    v_state := sqlerrm;
    reset role;
  end;
  insert into test_results_006 (case_name, status, detail) values (
    'fallo a mitad de la escritura revierte todo (puntos, stock, solicitud, renglones)',
    case when v_state like 'fallo forzado%'
          and pg_temp.pts('b6000000-0000-0000-0000-00000000000b') = 1000
          and pg_temp.stk('c6000000-0000-0000-0000-0000000000b1') = 5
          and pg_temp.stk('c6000000-0000-0000-0000-000000000200') = 4
          and pg_temp.n_req('b6000000-0000-0000-0000-00000000000b') = 0
          and pg_temp.n_items('b6000000-0000-0000-0000-00000000000b') = 0
         then 'PASS' else 'FAIL' end,
    v_state);
end;
$$;

drop trigger t006_boom on admin_notifications;
drop function t006_boom_fn();

-- B canjea de verdad (para los casos de aislamiento y notificaciones).
do $$
begin
  set role service_role;
  perform redeem_rewards('a6000000-0000-0000-0000-00000000000b', 'd6000000-0000-4000-8000-0000000000b9',
                         array['c6000000-0000-0000-0000-0000000000b1']::uuid[]);
  reset role;
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 9: costo historico: editar la recompensa despues no cambia lo canjeado
-- ----------------------------------------------------------------------------
do $$
declare
  v_r jsonb;
begin
  update rewards set points_cost = 150 where id = 'c6000000-0000-0000-0000-000000000100';
  set role service_role;
  v_r := redeem_rewards('a6000000-0000-0000-0000-00000000000a', 'd6000000-0000-4000-8000-000000000001',
                        array['c6000000-0000-0000-0000-000000000100', 'c6000000-0000-0000-0000-000000000200']::uuid[]);
  reset role;
  insert into test_results_006 (case_name, status, detail) values (
    'costo historico: tras subir Cien a 150, el renglon y el reintento siguen en 100',
    case when (select points_spent from reward_redemptions
                where volunteer_id = 'b6000000-0000-0000-0000-00000000000a'
                  and reward_id = 'c6000000-0000-0000-0000-000000000100') = 100
          and v_r->'request'->'items' @> '[{"reward_id": "c6000000-0000-0000-0000-000000000100", "points_spent": 100}]'::jsonb
          and (v_r->'request'->>'total_points')::int = 300
         then 'PASS' else 'FAIL' end,
    format('items=%s', v_r->'request'->'items'));
  update rewards set points_cost = 100 where id = 'c6000000-0000-0000-0000-000000000100';
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('costo historico', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 10: marcar entregado (service_role, como hace la Edge Function admin):
-- ok, sin cobrar de nuevo; repetir es seguro; inexistente -> request_not_found
-- ----------------------------------------------------------------------------
do $$
declare
  v_req   uuid := (select id from redemption_requests where volunteer_id = 'b6000000-0000-0000-0000-00000000000a');
  v_r1    jsonb; v_r2 jsonb; v_nf jsonb;
  v_q     redemption_requests%rowtype;
  v_aud   integer;
begin
  set role service_role;
  v_r1 := mark_redemption_delivered(v_req, 'a6000000-0000-0000-0000-0000000000d1');
  v_r2 := mark_redemption_delivered(v_req, 'a6000000-0000-0000-0000-0000000000d2');
  v_nf := mark_redemption_delivered('d6000000-0000-4000-8000-0000000000ff', null);
  reset role;
  select * into v_q from redemption_requests where id = v_req;
  select count(*) into v_aud from audit_logs where event_type = 'redemption_delivered' and detail->>'request_id' = v_req::text;

  insert into test_results_006 (case_name, status, detail) values (
    'entregar: ok, delivered con delivered_by, sin tocar puntos ni stock',
    case when v_r1->>'code' = 'ok' and (v_r1->>'already_delivered')::boolean = false
          and v_q.status = 'delivered' and v_q.delivered_at is not null
          and v_q.delivered_by = 'a6000000-0000-0000-0000-0000000000d1'
          and pg_temp.pts('b6000000-0000-0000-0000-00000000000a') = 200
          and pg_temp.stk('c6000000-0000-0000-0000-000000000100') = 4
          and pg_temp.stk('c6000000-0000-0000-0000-000000000200') = 4
         then 'PASS' else 'FAIL' end,
    format('r1=%s', v_r1->>'code'));
  insert into test_results_006 (case_name, status, detail) values (
    'entregar de nuevo: ok already_delivered, conserva el primer delivered_by, una sola auditoria',
    case when v_r2->>'code' = 'ok' and (v_r2->>'already_delivered')::boolean = true
          and v_q.delivered_by = 'a6000000-0000-0000-0000-0000000000d1' and v_aud = 1
         then 'PASS' else 'FAIL' end,
    format('r2=%s aud=%s', v_r2->>'already_delivered', v_aud));
  insert into test_results_006 (case_name, status, detail) values (
    'entregar solicitud inexistente -> request_not_found',
    case when v_nf->>'code' = 'request_not_found' then 'PASS' else 'FAIL' end, v_nf::text);
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('entregar', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 11: solo service_role ejecuta las funciones; ningun cliente (ni un
-- admin con sesion) escribe solicitudes, renglones ni notificaciones directo
-- ----------------------------------------------------------------------------
do $$
declare
  v_role text; v_what text; v_ok boolean; v_cnt integer;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_what in array array['redeem', 'deliver', 'mark_read', 'insert_request', 'update_request',
                                  'insert_item', 'insert_notification', 'insert_read'] loop
      v_ok := false;
      begin
        execute format('set role %I', v_role);
        perform set_config('request.jwt.claim.role', v_role, false);
        perform set_config('request.jwt.claim.sub',
          case when v_role = 'authenticated' then 'a6000000-0000-0000-0000-0000000000d1' else '' end, false);
        case v_what
          when 'redeem' then perform redeem_rewards('a6000000-0000-0000-0000-00000000000c', gen_random_uuid(),
                                                    array['c6000000-0000-0000-0000-000000000100']::uuid[]);
          when 'deliver' then perform mark_redemption_delivered(gen_random_uuid(), null);
          when 'mark_read' then perform mark_admin_notifications_read('a6000000-0000-0000-0000-0000000000d1', null);
          when 'insert_request' then
            insert into redemption_requests (volunteer_id, client_request_id, total_points, item_count)
            values ('b6000000-0000-0000-0000-00000000000c', gen_random_uuid(), 0, 1);
          when 'update_request' then
            update redemption_requests set status = 'delivered', delivered_at = now();
          when 'insert_item' then
            insert into reward_redemptions (volunteer_id, reward_id, points_spent)
            values ('b6000000-0000-0000-0000-00000000000c', 'c6000000-0000-0000-0000-000000000100', 0);
          when 'insert_notification' then
            insert into admin_notifications (type, title, message) values ('redemption_requested', 'x', 'x');
          when 'insert_read' then
            insert into admin_notification_reads (notification_id, admin_id)
            select id, 'a6000000-0000-0000-0000-0000000000d1' from admin_notifications limit 1;
        end case;
        reset role;
      exception when insufficient_privilege then
        v_ok := true;
        reset role;
      end;
      perform set_config('request.jwt.claim.sub', '', false);
      perform set_config('request.jwt.claim.role', '', false);
      insert into test_results_006 (case_name, status, detail)
      values (format('%s no puede %s', case when v_role = 'authenticated' then 'admin con sesion (authenticated)' else 'anon' end, v_what),
              case when v_ok then 'PASS' else 'FAIL' end, null);
    end loop;
  end loop;

  select count(*) into v_cnt from redemption_requests where volunteer_id = 'b6000000-0000-0000-0000-00000000000c';
  insert into test_results_006 (case_name, status, detail) values (
    'tras los intentos directos C sigue sin solicitudes y con 500 pts',
    case when v_cnt = 0 and pg_temp.pts('b6000000-0000-0000-0000-00000000000c') = 500 then 'PASS' else 'FAIL' end, null);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 12: aislamiento entre voluntarios y sin acceso a notificaciones
-- ----------------------------------------------------------------------------
do $$
declare
  v_a_req integer; v_a_req_b integer; v_a_items integer; v_a_items_b integer;
  v_a_notif integer; v_a_feed integer; v_a_reads integer;
  v_b_req integer; v_b_req_a integer;
  v_g_req integer; v_g_notif integer; v_g_feed integer;
begin
  set role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', false);

  perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-00000000000a', false);
  select count(*) into v_a_req from redemption_requests;
  select count(*) into v_a_req_b from redemption_requests where volunteer_id = 'b6000000-0000-0000-0000-00000000000b';
  select count(*) into v_a_items from reward_redemptions;
  select count(*) into v_a_items_b from reward_redemptions where volunteer_id = 'b6000000-0000-0000-0000-00000000000b';
  select count(*) into v_a_notif from admin_notifications;
  select count(*) into v_a_feed from admin_notifications_feed;
  select count(*) into v_a_reads from admin_notification_reads;

  perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-00000000000b', false);
  select count(*) into v_b_req from redemption_requests;
  select count(*) into v_b_req_a from redemption_requests where volunteer_id = 'b6000000-0000-0000-0000-00000000000a';

  perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-0000000000ca', false);
  select count(*) into v_g_req from redemption_requests;
  select count(*) into v_g_notif from admin_notifications;
  select count(*) into v_g_feed from admin_notifications_feed;
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);

  insert into test_results_006 (case_name, status, detail) values (
    'voluntario A ve solo su solicitud y sus 2 renglones; nada de B',
    case when v_a_req = 1 and v_a_req_b = 0 and v_a_items = 2 and v_a_items_b = 0 then 'PASS' else 'FAIL' end,
    format('req=%s req_B=%s items=%s items_B=%s', v_a_req, v_a_req_b, v_a_items, v_a_items_b));
  insert into test_results_006 (case_name, status, detail) values (
    'voluntario B ve solo su solicitud; nada de A',
    case when v_b_req = 1 and v_b_req_a = 0 then 'PASS' else 'FAIL' end,
    format('req=%s req_A=%s', v_b_req, v_b_req_a));
  insert into test_results_006 (case_name, status, detail) values (
    'voluntario no ve notificaciones de admin (tabla, feed ni lecturas)',
    case when v_a_notif = 0 and v_a_feed = 0 and v_a_reads = 0 then 'PASS' else 'FAIL' end,
    format('notif=%s feed=%s reads=%s', v_a_notif, v_a_feed, v_a_reads));
  insert into test_results_006 (case_name, status, detail) values (
    'guard no ve solicitudes de canje ni notificaciones de admin',
    case when v_g_req = 0 and v_g_notif = 0 and v_g_feed = 0 then 'PASS' else 'FAIL' end,
    format('req=%s notif=%s feed=%s', v_g_req, v_g_notif, v_g_feed));
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('aislamiento', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 13: anon no lee el feed ni las tablas nuevas
-- ----------------------------------------------------------------------------
do $$
declare
  v_feed text := 'sin error';
  v_req  text := 'sin error';
begin
  set role anon;
  begin perform 1 from admin_notifications_feed; exception when insufficient_privilege then v_feed := 'denegado'; end;
  begin perform 1 from redemption_requests;      exception when insufficient_privilege then v_req := 'denegado'; end;
  reset role;
  insert into test_results_006 (case_name, status, detail) values (
    'anon: permiso denegado sobre admin_notifications_feed y redemption_requests',
    case when v_feed = 'denegado' and v_req = 'denegado' then 'PASS' else 'FAIL' end,
    format('feed=%s req=%s', v_feed, v_req));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 14: admin ve todo; estado de leido POR admin
-- ----------------------------------------------------------------------------
do $$
declare
  v_total integer := pg_temp.n_notif();
  v_first uuid := (select id from admin_notifications order by created_at, id limit 1);
  v_m1 jsonb; v_m1b jsonb; v_m2 jsonb; v_ghost jsonb;
  v_a1_unread integer; v_a1_first timestamptz; v_a1_reqs integer;
  v_a2_unread_before integer; v_a2_first timestamptz; v_a2_unread_after integer;
  v_a1_sees_a2 integer;
begin
  set role service_role;
  v_m1  := mark_admin_notifications_read('a6000000-0000-0000-0000-0000000000d1', array[v_first]);
  v_m1b := mark_admin_notifications_read('a6000000-0000-0000-0000-0000000000d1', array[v_first]);
  v_ghost := mark_admin_notifications_read('a6000000-0000-0000-0000-0000000000d1', array[gen_random_uuid()]);
  reset role;

  set role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-0000000000d1', false);
  select count(*) into v_a1_unread from admin_notifications_feed where read_at is null;
  select read_at into v_a1_first from admin_notifications_feed where id = v_first;
  select count(*) into v_a1_reqs from redemption_requests;
  perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-0000000000d2', false);
  select count(*) into v_a2_unread_before from admin_notifications_feed where read_at is null;
  select read_at into v_a2_first from admin_notifications_feed where id = v_first;
  reset role;

  set role service_role;
  v_m2 := mark_admin_notifications_read('a6000000-0000-0000-0000-0000000000d2', null);
  reset role;

  set role authenticated;
  perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-0000000000d2', false);
  select count(*) into v_a2_unread_after from admin_notifications_feed where read_at is null;
  perform set_config('request.jwt.claim.sub', 'a6000000-0000-0000-0000-0000000000d1', false);
  select count(*) into v_a1_sees_a2 from admin_notification_reads where admin_id = 'a6000000-0000-0000-0000-0000000000d2';
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);

  insert into test_results_006 (case_name, status, detail) values (
    'admin ve todas las solicitudes y notificaciones',
    case when v_total >= 2 and v_a1_reqs = (select count(*) from redemption_requests) then 'PASS' else 'FAIL' end,
    format('notif=%s reqs=%s', v_total, v_a1_reqs));
  insert into test_results_006 (case_name, status, detail) values (
    'admin 1 marca una: marked 1; repetir marked 0; id inexistente se ignora',
    case when (v_m1->>'marked')::int = 1 and (v_m1->>'unread')::int = v_total - 1
          and (v_m1b->>'marked')::int = 0 and (v_ghost->>'marked')::int = 0
         then 'PASS' else 'FAIL' end,
    format('m1=%s m1b=%s ghost=%s', v_m1, v_m1b, v_ghost));
  insert into test_results_006 (case_name, status, detail) values (
    'leido por admin: admin 1 la ve leida, admin 2 la sigue viendo no leida',
    case when v_a1_first is not null and v_a1_unread = v_total - 1
          and v_a2_first is null and v_a2_unread_before = v_total
         then 'PASS' else 'FAIL' end,
    format('a1_unread=%s a2_unread=%s', v_a1_unread, v_a2_unread_before));
  insert into test_results_006 (case_name, status, detail) values (
    'admin 2 marca todas (null): unread 0; admin 1 no ve las lecturas de admin 2',
    case when (v_m2->>'unread')::int = 0 and v_a2_unread_after = 0 and v_a1_sees_a2 = 0 then 'PASS' else 'FAIL' end,
    format('m2=%s a2_after=%s a1_ve_a2=%s', v_m2, v_a2_unread_after, v_a1_sees_a2));
exception when others then
  reset role;
  insert into test_results_006 (case_name, status, detail) values ('notificaciones por admin', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 15: el historial previo (renglones sin solicitud) queda sin estado
-- ----------------------------------------------------------------------------
do $$
declare
  v_legacy integer;
  v_bad    integer;
begin
  -- Renglones creados por las pruebas 10/30/40 directamente (como el historial previo).
  select count(*) into v_legacy from reward_redemptions where request_id is null;
  -- Ninguna solicitud se creo fuera de redeem_rewards: todas tienen renglones propios.
  select count(*) into v_bad from redemption_requests q
   where not exists (select 1 from reward_redemptions rr where rr.request_id = q.id);
  insert into test_results_006 (case_name, status, detail) values (
    'renglones previos siguen con request_id null (sin estado inventado) y no hay solicitudes huerfanas',
    case when v_legacy >= 3 and v_bad = 0 then 'PASS' else 'FAIL' end,
    format('legacy=%s huerfanas=%s', v_legacy, v_bad));
end;
$$;


-- ============================================================================
-- Reporte final
-- ============================================================================
select seq, case_name, status, detail from test_results_006 order by seq;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail
from test_results_006;

do $$
declare
  v_fail_count integer;
begin
  select count(*) into v_fail_count from test_results_006 where status = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% caso(s) de 006 en FAIL — ver tabla de arriba', v_fail_count;
  end if;
end;
$$;
