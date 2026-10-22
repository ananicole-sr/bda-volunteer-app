-- ============================================================================
-- Casos de prueba de 010_admin_redemptions.sql. Se corre al final, sobre la
-- misma base (50_redemptions_cases.sql ya corrio contra el redeem_rewards
-- redefinido por 010, asi que tambien sirve de prueba de regresion).
-- ============================================================================

create table if not exists test_results_010 (
  seq        serial primary key,
  case_name  text not null,
  status     text not null check (status in ('PASS', 'FAIL')),
  detail     text
);

insert into auth.users (id, email) values ('a1000000-0000-0000-0000-0000000000ad', 'redeem-admin@test.local');
insert into profiles (id, role) values ('a1000000-0000-0000-0000-0000000000ad', 'admin');

insert into volunteers (id, full_name, community, points, is_active) values
  ('b1000000-0000-0000-0000-000000000001', 'Admin Canje Uno', 'x', 500, true),
  ('b1000000-0000-0000-0000-000000000002', 'Admin Canje Pobre', 'x', 5, true),
  ('b1000000-0000-0000-0000-000000000003', 'Admin Canje Inactivo', 'x', 500, false),
  ('b1000000-0000-0000-0000-000000000004', 'Admin Canje Tarjeta', 'x', 300, true);

insert into rewards (id, name, points_cost, stock) values
  ('c1000000-0000-0000-0000-000000000010', 'Admin Gorra', 100, 10),
  ('c1000000-0000-0000-0000-000000000020', 'Admin Taza', 50, 10);

create or replace function pg_temp.h(p text) returns text language sql as
  $$ select encode(extensions.hmac(p, current_setting('app.card_hmac_secret'), 'sha256'), 'hex') $$;

insert into cards (volunteer_id, uid_hmac, status) values
  ('b1000000-0000-0000-0000-000000000004', pg_temp.h('EE100004'), 'active'),
  ('b1000000-0000-0000-0000-000000000001', pg_temp.h('EE100099'), 'revoked'),
  ('b1000000-0000-0000-0000-000000000003', pg_temp.h('EE100003'), 'active');

-- ----------------------------------------------------------------------------
-- Caso 1: tras 006 + 010, cada renglon con solicitud tiene el estado de su solicitud
-- ----------------------------------------------------------------------------
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from reward_redemptions rr join redemption_requests q on q.id = rr.request_id
  where rr.status is distinct from q.status;
  insert into test_results_010 (case_name, status, detail) values (
    'renglones de 50_redemptions: status igual al de su solicitud (ninguno null)',
    case when v_bad = 0 and not exists (select 1 from reward_redemptions where request_id is not null and status is null)
         then 'PASS' else 'FAIL' end, format('distintos=%s', v_bad));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 2: admin_redeem_rewards ok
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_req redemption_requests%rowtype;
  v_rr  reward_redemptions%rowtype;
  v_n   admin_notifications%rowtype;
begin
  set role service_role;
  v_r := admin_redeem_rewards('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-4000-8000-000000000001',
                              array['c1000000-0000-0000-0000-000000000010']::uuid[], 'a1000000-0000-0000-0000-0000000000ad');
  reset role;
  select * into v_req from redemption_requests where id = (v_r->'request'->>'id')::uuid;
  select * into v_rr from reward_redemptions where request_id = v_req.id;
  select * into v_n from admin_notifications where request_id = v_req.id;

  insert into test_results_010 (case_name, status, detail) values (
    'admin canjea: ok, saldo 400, canal admin, requested_by = admin, renglon pendiente',
    case when v_r->>'code' = 'ok' and (v_r->>'balance')::int = 400
          and (select points from volunteers where id = 'b1000000-0000-0000-0000-000000000001') = 400
          and (select stock from rewards where id = 'c1000000-0000-0000-0000-000000000010') = 9
          and v_req.channel = 'admin' and v_req.requested_by = 'a1000000-0000-0000-0000-0000000000ad'
          and v_rr.status = 'pending_delivery' and v_rr.delivered_at is null
          and v_r->'request'->'items'->0->>'status' = 'pending_delivery'
          and v_r->'request'->'items'->0->>'id' = v_rr.id::text
         then 'PASS' else 'FAIL' end, v_r::text);
  insert into test_results_010 (case_name, status, detail) values (
    'admin canjea: notificacion que dice que lo registro un admin',
    case when v_n.message like '%Registrado por un admin.%' and v_n.payload->>'channel' = 'admin'
         then 'PASS' else 'FAIL' end, v_n.message);
exception when others then
  reset role;
  insert into test_results_010 (case_name, status, detail) values ('admin canjea ok', 'FAIL', 'error inesperado: ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 3: la misma recompensa dos veces = dos canjes, cada uno con su estado
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_n   integer;
  v_ids integer;
begin
  set role service_role;
  v_r := admin_redeem_rewards('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-4000-8000-000000000002',
                              array['c1000000-0000-0000-0000-000000000010']::uuid[], 'a1000000-0000-0000-0000-0000000000ad');
  reset role;
  select count(*), count(distinct id) into v_n, v_ids from reward_redemptions
   where volunteer_id = 'b1000000-0000-0000-0000-000000000001'
     and reward_id = 'c1000000-0000-0000-0000-000000000010' and status = 'pending_delivery';
  insert into test_results_010 (case_name, status, detail) values (
    'misma recompensa canjeada 2 veces: 2 renglones distintos, ambos pendientes, saldo 300',
    case when v_r->>'code' = 'ok' and v_n = 2 and v_ids = 2 and (v_r->>'balance')::int = 300
         then 'PASS' else 'FAIL' end, format('renglones=%s %s', v_n, v_r->>'code'));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 4: rechazos de admin_redeem_rewards
-- ----------------------------------------------------------------------------
do $$
declare
  v_r1 jsonb; v_r2 jsonb; v_r3 jsonb;
  v_reqs integer;
begin
  set role service_role;
  v_r1 := admin_redeem_rewards('b1000000-0000-0000-0000-000000000002', 'd1000000-0000-4000-8000-000000000003',
                               array['c1000000-0000-0000-0000-000000000020']::uuid[], 'a1000000-0000-0000-0000-0000000000ad');
  v_r2 := admin_redeem_rewards('b1000000-0000-0000-0000-0000000000ff', 'd1000000-0000-4000-8000-000000000004',
                               array['c1000000-0000-0000-0000-000000000020']::uuid[], 'a1000000-0000-0000-0000-0000000000ad');
  v_r3 := admin_redeem_rewards('b1000000-0000-0000-0000-000000000003', 'd1000000-0000-4000-8000-000000000005',
                               array['c1000000-0000-0000-0000-000000000020']::uuid[], 'a1000000-0000-0000-0000-0000000000ad');
  reset role;
  select count(*) into v_reqs from redemption_requests
   where volunteer_id in ('b1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003');

  insert into test_results_010 (case_name, status, detail) values (
    'puntos insuficientes -> insufficient_points con mensaje para el admin, sin cobrar',
    case when v_r1 = '{"code": "insufficient_points", "message": "El voluntario no tiene puntos suficientes", "required": 50, "available": 5}'::jsonb
          and (select points from volunteers where id = 'b1000000-0000-0000-0000-000000000002') = 5
         then 'PASS' else 'FAIL' end, v_r1::text);
  insert into test_results_010 (case_name, status, detail) values (
    'voluntario inexistente -> volunteer_not_found, auditado con el id en detail',
    case when v_r2->>'code' = 'volunteer_not_found'
          and exists (select 1 from audit_logs where event_type = 'redemption_rejected'
                        and detail->>'volunteer_id' = 'b1000000-0000-0000-0000-0000000000ff')
         then 'PASS' else 'FAIL' end, v_r2::text);
  insert into test_results_010 (case_name, status, detail) values (
    'voluntario inactivo -> volunteer_inactive; ninguna solicitud creada en los rechazos',
    case when v_r3->>'code' = 'volunteer_inactive' and v_reqs = 0 then 'PASS' else 'FAIL' end, v_r3::text);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 5: entregar UN renglon no toca los demas
-- ----------------------------------------------------------------------------
do $$
declare
  v_r     jsonb;
  v_req   uuid;
  v_a     uuid;
  v_b     uuid;
  v_m1    jsonb; v_m1b jsonb; v_m2 jsonb;
  v_other text; v_req_after1 text;
begin
  set role service_role;
  v_r := admin_redeem_rewards('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-4000-8000-000000000006',
                              array['c1000000-0000-0000-0000-000000000010', 'c1000000-0000-0000-0000-000000000020']::uuid[],
                              'a1000000-0000-0000-0000-0000000000ad');
  reset role;
  v_req := (v_r->'request'->>'id')::uuid;
  select id into v_a from reward_redemptions where request_id = v_req and reward_id = 'c1000000-0000-0000-0000-000000000010';
  select id into v_b from reward_redemptions where request_id = v_req and reward_id = 'c1000000-0000-0000-0000-000000000020';

  set role service_role;
  v_m1  := mark_redemption_item_delivered(v_a, 'a1000000-0000-0000-0000-0000000000ad');
  v_m1b := mark_redemption_item_delivered(v_a, 'a1000000-0000-0000-0000-0000000000ad');
  reset role;
  select status into v_other from reward_redemptions where id = v_b;
  select status into v_req_after1 from redemption_requests where id = v_req;

  insert into test_results_010 (case_name, status, detail) values (
    'entregar 1 de 2 renglones: ese queda delivered, el otro y la solicitud siguen pendientes',
    case when v_m1->>'code' = 'ok' and (v_m1->>'already_delivered')::boolean = false
          and v_m1->'redemption'->>'status' = 'delivered' and v_m1->>'request_status' = 'pending_delivery'
          and (select delivered_by from reward_redemptions where id = v_a) = 'a1000000-0000-0000-0000-0000000000ad'
          and v_other = 'pending_delivery' and v_req_after1 = 'pending_delivery'
         then 'PASS' else 'FAIL' end, v_m1::text);
  insert into test_results_010 (case_name, status, detail) values (
    'entregar el mismo renglon otra vez -> ok con already_delivered true',
    case when v_m1b->>'code' = 'ok' and (v_m1b->>'already_delivered')::boolean then 'PASS' else 'FAIL' end, v_m1b::text);

  set role service_role;
  v_m2 := mark_redemption_item_delivered(v_b, 'a1000000-0000-0000-0000-0000000000ad');
  reset role;
  insert into test_results_010 (case_name, status, detail) values (
    'entregar el ultimo renglon pendiente -> la solicitud pasa a delivered',
    case when v_m2->>'request_status' = 'delivered'
          and (select delivered_at from redemption_requests where id = v_req) is not null
         then 'PASS' else 'FAIL' end, v_m2::text);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 6: entregas por solicitud y renglon inexistente
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb;
  v_req uuid;
  v_m   jsonb;
  v_nf  jsonb;
begin
  set role service_role;
  v_r := admin_redeem_rewards('b1000000-0000-0000-0000-000000000001', 'd1000000-0000-4000-8000-000000000007',
                              array['c1000000-0000-0000-0000-000000000020']::uuid[], 'a1000000-0000-0000-0000-0000000000ad');
  v_req := (v_r->'request'->>'id')::uuid;
  v_m  := mark_redemption_delivered(v_req, 'a1000000-0000-0000-0000-0000000000ad');
  v_nf := mark_redemption_item_delivered('e1000000-0000-0000-0000-0000000000ff', 'a1000000-0000-0000-0000-0000000000ad');
  reset role;
  insert into test_results_010 (case_name, status, detail) values (
    'mark_redemption_delivered (por solicitud) tambien entrega sus renglones',
    case when v_m->>'code' = 'ok'
          and not exists (select 1 from reward_redemptions where request_id = v_req and status <> 'delivered')
          and v_m->'request'->'items'->0->>'status' = 'delivered'
         then 'PASS' else 'FAIL' end, v_m::text);
  insert into test_results_010 (case_name, status, detail) values (
    'renglon inexistente -> redemption_not_found',
    case when v_nf = '{"code": "redemption_not_found", "message": "El canje no existe"}'::jsonb
         then 'PASS' else 'FAIL' end, v_nf::text);
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 7: lookup_card_volunteer
-- ----------------------------------------------------------------------------
do $$
declare
  v_ok jsonb; v_unk jsonb; v_rev jsonb; v_ina jsonb;
  -- service_role no ve el schema extensions: los HMAC se calculan antes del set role.
  h_act text := pg_temp.h('EE100004'); h_unk text := pg_temp.h('EE1000FF');
  h_rev text := pg_temp.h('EE100099'); h_ina text := pg_temp.h('EE100003');
begin
  set role service_role;
  v_ok  := lookup_card_volunteer(h_act, 'a1000000-0000-0000-0000-0000000000ad');
  v_unk := lookup_card_volunteer(h_unk, 'a1000000-0000-0000-0000-0000000000ad');
  v_rev := lookup_card_volunteer(h_rev, 'a1000000-0000-0000-0000-0000000000ad');
  v_ina := lookup_card_volunteer(h_ina, 'a1000000-0000-0000-0000-0000000000ad');
  reset role;
  insert into test_results_010 (case_name, status, detail) values (
    'tarjeta activa -> ok con id, nombre y saldo del voluntario',
    case when v_ok->>'code' = 'ok' and v_ok->'volunteer'->>'id' = 'b1000000-0000-0000-0000-000000000004'
          and (v_ok->'volunteer'->>'points')::int = 300
         then 'PASS' else 'FAIL' end, v_ok::text);
  insert into test_results_010 (case_name, status, detail) values (
    'tarjeta desconocida / revocada / de voluntario inactivo -> card_unknown / card_inactive / volunteer_inactive',
    case when v_unk->>'code' = 'card_unknown' and v_rev->>'code' = 'card_inactive' and v_ina->>'code' = 'volunteer_inactive'
         then 'PASS' else 'FAIL' end, format('%s %s %s', v_unk->>'code', v_rev->>'code', v_ina->>'code'));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 8: admin_redeem_rewards_by_card
-- ----------------------------------------------------------------------------
do $$
declare
  v_r   jsonb; v_unk jsonb; v_rev jsonb;
  v_req redemption_requests%rowtype;
  h_act text := pg_temp.h('EE100004'); h_unk text := pg_temp.h('EE1000FF'); h_rev text := pg_temp.h('EE100099');
begin
  set role service_role;
  v_r   := admin_redeem_rewards_by_card(h_act, 'd1000000-0000-4000-8000-000000000008',
                                        array['c1000000-0000-0000-0000-000000000020']::uuid[], 'a1000000-0000-0000-0000-0000000000ad');
  v_unk := admin_redeem_rewards_by_card(h_unk, 'd1000000-0000-4000-8000-000000000009',
                                        array['c1000000-0000-0000-0000-000000000020']::uuid[], 'a1000000-0000-0000-0000-0000000000ad');
  v_rev := admin_redeem_rewards_by_card(h_rev, 'd1000000-0000-4000-8000-00000000000a',
                                        array['c1000000-0000-0000-0000-000000000020']::uuid[], 'a1000000-0000-0000-0000-0000000000ad');
  reset role;
  select * into v_req from redemption_requests where id = (v_r->'request'->>'id')::uuid;
  insert into test_results_010 (case_name, status, detail) values (
    'canje con tarjeta: el voluntario sale de la tarjeta, canal admin_card, saldo 250',
    case when v_r->>'code' = 'ok' and v_req.volunteer_id = 'b1000000-0000-0000-0000-000000000004'
          and v_req.channel = 'admin_card' and (v_r->>'balance')::int = 250
         then 'PASS' else 'FAIL' end, v_r::text);
  insert into test_results_010 (case_name, status, detail) values (
    'tarjeta desconocida / revocada -> card_unknown / card_inactive, auditados, sin cobrar',
    case when v_unk->>'code' = 'card_unknown' and v_rev->>'code' = 'card_inactive'
          and exists (select 1 from audit_logs where event_type = 'redemption_card_unknown')
          and exists (select 1 from audit_logs where event_type = 'redemption_card_inactive')
          and (select points from volunteers where id = 'b1000000-0000-0000-0000-000000000001') = 100
         then 'PASS' else 'FAIL' end, format('%s %s', v_unk->>'code', v_rev->>'code'));
end;
$$;

-- ----------------------------------------------------------------------------
-- Caso 9: solo service_role ejecuta las funciones nuevas
-- ----------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_fn   text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_fn in array array[
      'admin_redeem_rewards(uuid, uuid, uuid[], uuid)',
      'admin_redeem_rewards_by_card(text, uuid, uuid[], uuid)',
      'lookup_card_volunteer(text, uuid)',
      'mark_redemption_item_delivered(uuid, uuid)',
      'redeem_rewards_core(uuid, uuid, uuid[], uuid, text)'
    ] loop
      insert into test_results_010 (case_name, status, detail)
      values (format('%s no puede ejecutar %s', v_role, v_fn),
              case when has_function_privilege(v_role, v_fn, 'execute') then 'FAIL' else 'PASS' end, null);
    end loop;
  end loop;
  insert into test_results_010 (case_name, status, detail)
  values ('service_role si ejecuta las 4 funciones expuestas',
          case when has_function_privilege('service_role', 'admin_redeem_rewards(uuid, uuid, uuid[], uuid)', 'execute')
                and has_function_privilege('service_role', 'admin_redeem_rewards_by_card(text, uuid, uuid[], uuid)', 'execute')
                and has_function_privilege('service_role', 'lookup_card_volunteer(text, uuid)', 'execute')
                and has_function_privilege('service_role', 'mark_redemption_item_delivered(uuid, uuid)', 'execute')
               then 'PASS' else 'FAIL' end, null);
end;
$$;


-- ============================================================================
-- Reporte final
-- ============================================================================
select seq, case_name, status, detail from test_results_010 order by seq;

select
  count(*) as total,
  count(*) filter (where status = 'PASS') as pass,
  count(*) filter (where status = 'FAIL') as fail
from test_results_010;

do $$
declare
  v_fail_count integer;
begin
  select count(*) into v_fail_count from test_results_010 where status = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% caso(s) de 010 en FAIL — ver tabla de arriba', v_fail_count;
  end if;
end;
$$;
