-- ============================================================================
-- BAMX · Check-in NFC de Voluntarios y Dashboard de Recompensas
-- Schema de Supabase (Postgres)
--
-- Implementa los almacenes de datos definidos en el DFD Nivel 1 (Stage 2
-- Cybersecurity, sección 2.3):
--   DS1 Voluntarios              -> tabla volunteers
--   DS2 Asistencias / Check-ins  -> tabla check_ins
--   DS3 Puntos y Recompensas     -> tablas rewards + reward_redemptions
--                                   (puntos vivos como columna denormalizada
--                                   en volunteers.points, ver trigger abajo)
--   DS4 Credenciales / Sesiones Admin -> Supabase Auth (auth.users), no se
--                                   modela como tabla propia
--   DS5 Logs de auditoría        -> tabla audit_logs
--
-- Además, point_tiers: los puntos por check-in NO son un número fijo, suben
-- según cuántas visitas lleva el voluntario (decidido en conversación con el
-- equipo — BAMX todavía no define una regla oficial, así que queda como
-- tabla configurable en vez de hardcoded, ver trigger abajo).
--
-- Cómo correrlo:
--   1. Crear un proyecto en https://supabase.com
--   2. Abrir el SQL editor del proyecto y pegar/correr este archivo completo
--   3. Correr seed.sql para tener datos de prueba (los mismos 3 voluntarios
--      que hoy están hardcoded en el frontend)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- DS1: Voluntarios
-- ----------------------------------------------------------------------------
create table if not exists volunteers (
  id                uuid primary key default gen_random_uuid(),
  nfc_uid           text unique,                 -- UID de la tarjeta NFC asociada (F16 / P6)
  full_name         text not null,
  community         text not null default '',
  avatar_url        text,
  is_active         boolean not null default true,

  -- Denormalizado a propósito para que el dashboard (F10/F11) haga un solo
  -- SELECT sin joins ni agregaciones: se recalculan por trigger cada vez que
  -- se inserta un check-in válido (ver trigger fn_apply_checkin más abajo).
  points            integer not null default 0,
  total_visits      integer not null default 0,
  last_check_in_at  timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table volunteers is 'DS1 - Datos de cada voluntario y la tarjeta NFC que le corresponde.';

-- ----------------------------------------------------------------------------
-- Niveles de puntos por visita. Config editable, no hardcoded en el trigger.
-- min_visits = a partir de qué # de visita aplica ese valor de puntos.
-- ----------------------------------------------------------------------------
create table if not exists point_tiers (
  id                uuid primary key default gen_random_uuid(),
  min_visits        integer not null unique check (min_visits >= 1),
  points_per_visit  integer not null check (points_per_visit >= 0)
);

comment on table point_tiers is 'Niveles: a partir de min_visits, cada check-in vale points_per_visit puntos.';

insert into point_tiers (min_visits, points_per_visit) values
  (1, 10),   -- visitas 1 a 5
  (6, 15),   -- visitas 6 a 15
  (16, 25)   -- visita 16 en adelante
on conflict (min_visits) do nothing;

-- ----------------------------------------------------------------------------
-- DS2: Asistencias / Check-ins
-- ----------------------------------------------------------------------------
create table if not exists check_ins (
  id             uuid primary key default gen_random_uuid(),
  volunteer_id   uuid not null references volunteers(id) on delete cascade,
  point_tier_id  uuid references point_tiers(id),   -- qué nivel se aplicó en este check-in
  terminal_id    text not null default 'terminal-recepcion-1',
  status         text not null default 'valid'
                   check (status in ('valid', 'duplicate', 'rejected')),
  visit_number   integer,          -- qué visita # fue esta para el voluntario (solo si status = valid)
  points_awarded integer not null default 0,
  checked_in_at  timestamptz not null default now()
);

comment on table check_ins is 'DS2 - Historial de check-ins: quien llego, cuando, desde que terminal, y que nivel de puntos se aplico.';

create index if not exists idx_check_ins_volunteer on check_ins (volunteer_id, checked_in_at desc);

-- ----------------------------------------------------------------------------
-- DS3: Puntos y Recompensas (catalogo + canje)
-- ----------------------------------------------------------------------------
create table if not exists rewards (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  points_cost  integer not null check (points_cost >= 0),
  stock        integer not null default 0 check (stock >= 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

comment on table rewards is 'DS3 (catalogo) - Que recompensas existen, su costo en puntos y stock.';

create table if not exists reward_redemptions (
  id            uuid primary key default gen_random_uuid(),
  volunteer_id  uuid not null references volunteers(id) on delete cascade,
  reward_id     uuid not null references rewards(id) on delete restrict,
  points_spent  integer not null check (points_spent >= 0),
  redeemed_at   timestamptz not null default now()
);

comment on table reward_redemptions is 'DS3 (canje) - Que voluntario canjeo que recompensa y cuando.';

-- ----------------------------------------------------------------------------
-- DS5: Logs de auditoria
-- ----------------------------------------------------------------------------
create table if not exists audit_logs (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,             -- p.ej. 'checkin_rejected', 'checkin_duplicate'
  volunteer_id uuid references volunteers(id) on delete set null,
  terminal_id  text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

comment on table audit_logs is 'DS5 - Intentos de check-in fallidos o sospechosos, para revisarlos despues.';

-- ============================================================================
-- Trigger: F5/F6 -> "Aviso de que el check-in fue valido" + "Actualizacion
-- del saldo de puntos". Cada check-in valido cuenta como una visita mas del
-- voluntario, busca en point_tiers cuantos puntos vale ESA visita (segun
-- cuantas visitas ya lleva) y actualiza points/total_visits/last_check_in_at.
-- Si el check-in no es valido, se registra en audit_logs (DS5) en vez de
-- tocar el saldo del voluntario.
-- ============================================================================
create or replace function fn_apply_checkin()
returns trigger
language plpgsql
as $$
declare
  v_next_visit integer;
  v_tier_id    uuid;
  v_tier_points integer;
begin
  if new.status = 'valid' then
    -- Cuantas visitas lleva el voluntario CONTANDO esta.
    select total_visits + 1 into v_next_visit
    from volunteers
    where id = new.volunteer_id;

    -- Nivel que le corresponde: el min_visits mas alto que sea <= la visita actual.
    select id, points_per_visit into v_tier_id, v_tier_points
    from point_tiers
    where min_visits <= v_next_visit
    order by min_visits desc
    limit 1;

    new.visit_number   := v_next_visit;
    new.point_tier_id  := v_tier_id;
    new.points_awarded := coalesce(v_tier_points, 0);

    update volunteers
    set points = points + new.points_awarded,
        total_visits = v_next_visit,
        last_check_in_at = new.checked_in_at,
        updated_at = now()
    where id = new.volunteer_id;
  else
    insert into audit_logs (event_type, volunteer_id, terminal_id, detail)
    values (
      'checkin_' || new.status,
      new.volunteer_id,
      new.terminal_id,
      jsonb_build_object('check_in_id', new.id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_checkin on check_ins;
create trigger trg_apply_checkin
  before insert on check_ins
  for each row
  execute function fn_apply_checkin();

-- ============================================================================
-- Row Level Security
--
-- Alcance de este entregable: solo se evalua la operacion de Read. Se deja
-- lectura abierta (anon + authenticated) sobre datos no sensibles para que
-- el dashboard funcione sin login todavia. Las escrituras quedan cerradas
-- por RLS (solo el rol 'service_role' del backend puede escribir), y se
-- endurecen en el siguiente entregable cuando se implemente RBAC completo
-- (WBS 1.5.2 Autorizacion por roles) y MASVS-AUTH-1.
-- ============================================================================
alter table volunteers enable row level security;
alter table point_tiers enable row level security;
alter table check_ins enable row level security;
alter table rewards enable row level security;
alter table reward_redemptions enable row level security;
alter table audit_logs enable row level security;

create policy "volunteers_read" on volunteers
  for select using (true);

create policy "point_tiers_read" on point_tiers
  for select using (true);

create policy "check_ins_read" on check_ins
  for select using (true);

create policy "rewards_read" on rewards
  for select using (true);

create policy "reward_redemptions_read" on reward_redemptions
  for select using (auth.role() = 'authenticated');

create policy "audit_logs_read" on audit_logs
  for select using (auth.role() = 'authenticated');

-- Nota: no se crean policies "for insert/update/delete" para anon ni
-- authenticated a proposito -> sin una policy que lo permita, RLS bloquea
-- la escritura por default. El backend (NestJS, WBS 1.2) escribe usando la
-- service_role key, que ignora RLS.
