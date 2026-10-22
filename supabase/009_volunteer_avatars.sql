-- ============================================================================
-- BAMX · Foto de perfil de voluntarios
--
-- Incremental sobre 002/003; no las reescribe. Agrega:
--   - Bucket de Storage "volunteer-avatars": lectura publica (la app muestra
--     la foto con su URL publica), maximo 2 MB, solo jpeg/png/webp.
--   - Policies de storage.objects: solo admins suben, reemplazan o borran
--     archivos de ese bucket. Nadie mas escribe.
--   - set_volunteer_avatar: guarda en volunteers.avatar_url la RUTA del archivo
--     dentro del bucket ("<volunteer_id>/<nombre>.<ext>"), no la URL completa;
--     el frontend arma la URL publica. Solo service_role (la Edge Function
--     set-volunteer-avatar, rol admin) la ejecuta.
--
-- avatar_url puede seguir teniendo URLs completas (seed.sql); el frontend
-- usa tal cual cualquier valor que empiece con http(s).
--
-- No necesita app.card_hmac_secret y se puede correr mas de una vez.
-- Como correrlo: SQL editor de Supabase, pegar/correr este archivo completo.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Bucket
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('volunteer-avatars', 'volunteer-avatars', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 2. Policies (la lectura no necesita policy: el bucket es publico)
-- ----------------------------------------------------------------------------
drop policy if exists "volunteer_avatars_insert_admin" on storage.objects;
create policy "volunteer_avatars_insert_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'volunteer-avatars' and public.is_admin());

drop policy if exists "volunteer_avatars_update_admin" on storage.objects;
create policy "volunteer_avatars_update_admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'volunteer-avatars' and public.is_admin())
  with check (bucket_id = 'volunteer-avatars' and public.is_admin());

drop policy if exists "volunteer_avatars_delete_admin" on storage.objects;
create policy "volunteer_avatars_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'volunteer-avatars' and public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. set_volunteer_avatar
-- ----------------------------------------------------------------------------
-- p_path debe estar en la carpeta del propio voluntario y el archivo ya debe
-- existir en el bucket (se sube antes desde la app). Como en update_volunteer,
-- las validaciones de formato son una segunda barrera: abortan con excepcion.
create or replace function set_volunteer_avatar(
  p_volunteer_id uuid,
  p_path         text,
  p_operator_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vol volunteers%rowtype;
begin
  if p_path is null
     or p_path !~ ('^' || p_volunteer_id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$') then
    raise exception 'set_volunteer_avatar: p_path invalido'
      using errcode = '22023';
  end if;

  select * into v_vol from volunteers where id = p_volunteer_id for update;
  if not found then
    insert into audit_logs (event_type, detail)
    values (
      'set_volunteer_avatar_not_found',
      jsonb_build_object('volunteer_id', p_volunteer_id, 'operator_id', p_operator_id)
    );
    return jsonb_build_object('code', 'volunteer_not_found', 'message', 'El voluntario no existe');
  end if;

  if not exists (
    select 1 from storage.objects where bucket_id = 'volunteer-avatars' and name = p_path
  ) then
    return jsonb_build_object('code', 'avatar_not_found', 'message', 'La foto no se encontro en Storage');
  end if;

  update volunteers
  set avatar_url = p_path,
      updated_at = now()
  where id = p_volunteer_id;

  insert into audit_logs (event_type, volunteer_id, detail)
  values ('volunteer_avatar_set', p_volunteer_id, jsonb_build_object('operator_id', p_operator_id));

  return jsonb_build_object(
    'code', 'ok',
    'volunteer', jsonb_build_object('id', v_vol.id, 'avatar_url', p_path)
  );
end;
$$;

comment on function set_volunteer_avatar(uuid, text, uuid) is
  'Guarda la ruta de la foto (bucket volunteer-avatars) en avatar_url. Codigos: ok | volunteer_not_found | avatar_not_found (docs/nfc-contract.md).';

revoke all on function set_volunteer_avatar(uuid, text, uuid) from public, anon, authenticated;
grant execute on function set_volunteer_avatar(uuid, text, uuid) to service_role;

commit;
