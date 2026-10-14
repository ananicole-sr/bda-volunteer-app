-- Requiere, igual que 002_nfc_security.sql, que app.card_hmac_secret ya este
-- definido en esta sesion antes de correr este archivo:
--   SET app.card_hmac_secret = '<el mismo valor que CARD_UID_HMAC_SECRET>';
-- Los UIDs de prueba (8 hex = 4 bytes, validos segun docs/nfc-contract.md)
-- se guardan como cards.uid_hmac, nunca en claro.

do $$
begin
  if current_setting('app.card_hmac_secret', true) is null
     or current_setting('app.card_hmac_secret', true) = '' then
    raise exception
      'app.card_hmac_secret no esta definido. Ver encabezado de este archivo.';
  end if;
end $$;

insert into volunteers (full_name, community, avatar_url, points, total_visits, last_check_in_at)
select 'Sofía Ramírez', 'Zapopan',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&auto=format',
  2240, 22, '2026-09-07 10:15:00-06'
where not exists (select 1 from volunteers where full_name = 'Sofía Ramírez');

insert into volunteers (full_name, community, avatar_url, points, total_visits, last_check_in_at)
select 'Carlos Mendoza', 'Zapopan',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&auto=format',
  1480, 9, '2026-09-06 09:40:00-06'
where not exists (select 1 from volunteers where full_name = 'Carlos Mendoza');

insert into volunteers (full_name, community, avatar_url, points, total_visits, last_check_in_at)
select 'Valeria Ríos', 'Centro',
  'https://images.unsplash.com/photo-1531427186611-ecfd6d936c79?w=80&h=80&fit=crop&auto=format',
  3120, 31, '2026-09-07 11:05:00-06'
where not exists (select 1 from volunteers where full_name = 'Valeria Ríos');

-- Tarjeta de cada voluntario de prueba, como HMAC (nunca el UID en claro).
insert into cards (volunteer_id, uid_hmac, status, issued_at)
select
  v.id,
  encode(extensions.hmac(upper(x.uid), current_setting('app.card_hmac_secret'), 'sha256'), 'hex'),
  'active',
  now()
from (values
  ('Sofía Ramírez', '04A1B2C3'),
  ('Carlos Mendoza', '04E5F6A7'),
  ('Valeria Ríos',  '04C9D0E1')
) as x(full_name, uid)
join volunteers v on v.full_name = x.full_name
on conflict (uid_hmac) do nothing;

alter table check_ins disable trigger trg_apply_checkin;

insert into check_ins (
  volunteer_id, point_tier_id, terminal_id, status, visit_number, points_awarded,
  checked_in_at, event_id, client_ts
)
select
  v.id,
  (select id from point_tiers where min_visits <= v.total_visits order by min_visits desc limit 1),
  'terminal-recepcion-1',
  'valid',
  v.total_visits,
  (select points_per_visit from point_tiers where min_visits <= v.total_visits order by min_visits desc limit 1),
  v.last_check_in_at,
  gen_random_uuid(),
  v.last_check_in_at
from volunteers v
where not exists (select 1 from check_ins c where c.volunteer_id = v.id);

alter table check_ins enable trigger trg_apply_checkin;

insert into rewards (name, description, points_cost, stock)
values
  ('Despensa básica', 'Paquete de despensa BAMX', 1000, 25),
  ('Playera BAMX', 'Playera conmemorativa de voluntariado', 500, 40),
  ('Certificado de horas', 'Constancia de horas de voluntariado', 0, 999)
on conflict do nothing;
