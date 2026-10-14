-- ============================================================================
-- Stub de lo que en un proyecto real de Supabase ya existe de fabrica:
--   - el schema auth con auth.users y las funciones auth.uid()/auth.role()
--     (aqui simplificadas: leen un par de GUCs de sesion en vez del JWT real)
--   - los roles de Postgres anon / authenticated / service_role
-- Se corre ANTES de schema.sql y 002_nfc_security.sql.
-- ============================================================================

create schema if not exists auth;

-- Sin default gen_random_uuid(): los tests siempre insertan ids explicitos
-- para que las aserciones sean deterministas.
create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);

-- En Supabase real, auth.uid()/auth.role() leen el JWT verificado por
-- PostgREST. Aqui, una prueba "inicia sesion como" alguien con:
--   set local request.jwt.claim.sub  = '<uuid>';
--   set local request.jwt.claim.role = 'authenticated';
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.role() returns text
language sql stable
as $$ select coalesce(current_setting('request.jwt.claim.role', true), current_user) $$;

-- Roles de Postgres que usa Supabase para la API. service_role tiene
-- BYPASSRLS (igual que en un proyecto real) justamente para poder probar que
-- el REVOKE UPDATE/DELETE de audit_logs (seccion 6 de 002_nfc_security.sql)
-- lo sigue bloqueando aunque RLS no aplique.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

-- Privilegios de TABLA que Supabase otorga por default a estos roles en
-- cualquier proyecto nuevo (no es cosa de este repo). Se hace con ALTER
-- DEFAULT PRIVILEGES -- no con GRANT -- y ANTES de correr schema.sql/
-- 002_nfc_security.sql, para que aplique automaticamente a cada tabla que
-- esas migraciones creen (search_path activo = quien conecta a psql, el
-- mismo rol que las va a crear). Si fuera un GRANT ... ON ALL TABLES hecho
-- DESPUES de las migraciones, re-otorgaria UPDATE/DELETE sobre audit_logs
-- que 002_nfc_security.sql acaba de revocar — asi es exactamente como NO
-- se debe simular esto (se detecto corriendo las pruebas).
alter default privileges in schema public
  grant select, insert, update, delete, truncate, references, trigger
  on tables to anon, authenticated;

alter default privileges in schema public
  grant all on tables to service_role;
