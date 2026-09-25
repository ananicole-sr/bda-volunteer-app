-- ============================================================================
-- Datos de prueba: replica los 3 voluntarios que hoy estan hardcoded en
-- frontend/src/app/admin/index.tsx, para que el video del entregable muestre
-- el mismo contenido pero leido desde Supabase en vez de un array local.
--
-- Correr DESPUES de schema.sql.
--
-- Nota sobre total_visits: se eligieron a proposito para que los 3
-- voluntarios queden en niveles distintos de point_tiers y el video pueda
-- mostrar que los puntos por check-in SI varian segun cuantas visitas lleva
-- cada quien (10 / 15 / 25 pts, ver point_tiers en schema.sql).
-- ============================================================================

insert into volunteers (nfc_uid, full_name, community, avatar_url, points, total_visits, last_check_in_at)
values
  -- 22 visitas -> nivel 3 (>=16), su ULTIMO check-in valio 25 pts
  ('04A1B2C3D4', 'Sofía Ramírez', 'Zapopan',
   'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&auto=format',
   2240, 22, '2026-09-07 10:15:00-06'),
  -- 9 visitas -> nivel 2 (6-15), su ultimo check-in valio 15 pts
  ('04E5F6A7B8', 'Carlos Mendoza', 'Zapopan',
   'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&auto=format',
   1480, 9, '2026-09-06 09:40:00-06'),
  -- 31 visitas -> nivel 3 (>=16), su ultimo check-in valio 25 pts
  ('04C9D0E1F2', 'Valeria Ríos', 'Centro',
   'https://images.unsplash.com/photo-1531427186611-ecfd6d936c79?w=80&h=80&fit=crop&auto=format',
   3120, 31, '2026-09-07 11:05:00-06')
on conflict (nfc_uid) do nothing;

-- Un check-in de ejemplo por voluntario (deja algo real en DS2 por si el
-- video quiere mostrar esa tabla). Se desactiva el trigger mientras se
-- insertan: los puntos/total_visits de arriba YA representan el estado
-- final acumulado, así que no queremos que el trigger los vuelva a sumar.
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

-- Catálogo mínimo de recompensas (DS3), para futuras pantallas de Rewards.
insert into rewards (name, description, points_cost, stock)
values
  ('Despensa básica', 'Paquete de despensa BAMX', 1000, 25),
  ('Playera BAMX', 'Playera conmemorativa de voluntariado', 500, 40),
  ('Certificado de horas', 'Constancia de horas de voluntariado', 0, 999)
on conflict do nothing;
