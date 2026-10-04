insert into volunteers (nfc_uid, full_name, community, avatar_url, points, total_visits, last_check_in_at)
values
  ('04A1B2C3D4', 'Sofía Ramírez', 'Zapopan',
   'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&auto=format',
   2240, 22, '2026-09-07 10:15:00-06'),
  ('04E5F6A7B8', 'Carlos Mendoza', 'Zapopan',
   'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&auto=format',
   1480, 9, '2026-09-06 09:40:00-06'),
  ('04C9D0E1F2', 'Valeria Ríos', 'Centro',
   'https://images.unsplash.com/photo-1531427186611-ecfd6d936c79?w=80&h=80&fit=crop&auto=format',
   3120, 31, '2026-09-07 11:05:00-06')
on conflict (nfc_uid) do nothing;

alter table check_ins disable trigger trg_apply_checkin;

insert into check_ins (volunteer_id, point_tier_id, terminal_id, status, visit_number, points_awarded, checked_in_at)
select
  v.id,
  (select id from point_tiers where min_visits <= v.total_visits order by min_visits desc limit 1),
  'terminal-recepcion-1',
  'valid',
  v.total_visits,
  (select points_per_visit from point_tiers where min_visits <= v.total_visits order by min_visits desc limit 1),
  v.last_check_in_at
from volunteers v;

alter table check_ins enable trigger trg_apply_checkin;

insert into rewards (name, description, points_cost, stock)
values
  ('Despensa básica', 'Paquete de despensa BAMX', 1000, 25),
  ('Playera BAMX', 'Playera conmemorativa de voluntariado', 500, 40),
  ('Certificado de horas', 'Constancia de horas de voluntariado', 0, 999)
on conflict do nothing;
