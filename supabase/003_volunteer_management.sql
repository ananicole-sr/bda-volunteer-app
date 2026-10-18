-- ============================================================================
-- BAMX · Gestion de voluntarios: actualizar datos y desactivar
--
-- Incremental sobre 002_nfc_security.sql (requiere que ya este aplicada).
-- Agrega las 2 funciones SECURITY DEFINER que exponen las Edge Functions
-- update-volunteer y deactivate-volunteer (docs/nfc-contract.md, funciones 4 y 5):
--   - update_volunteer:     cambia full_name y/o community.
--   - deactivate_volunteer: pone is_active = false. No toca la tarjeta: el
--     check-in ya responde volunteer_inactive para un voluntario inactivo
--     (register_check_in, paso 4), y asi la tarjeta sigue ligada a la persona.
--
-- No cambia tablas ni policies, no necesita app.card_hmac_secret y se puede
-- correr mas de una vez (create or replace + revoke/grant idempotentes).
--
-- Como correrlo: SQL editor de Supabase, pegar/correr este archivo completo.
-- ============================================================================

begin;

-- update_volunteer: p_full_name / p_community en null = "no cambiar".
-- Las Edge Functions ya validan el cuerpo; las validaciones de aqui son una
-- segunda barrera por si alguien con service_role la llama directo, y por eso
-- abortan con excepcion (500 generico) en vez de devolver un codigo de negocio.
create or replace function update_volunteer(
  p_volunteer_id uuid,
  p_full_name    text,
  p_community    text,
  p_operator_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old       volunteers%rowtype;
  v_new       volunteers%rowtype;
  v_full_name text := btrim(p_full_name);
  v_community text := btrim(p_community);
  v_changed   text[] := '{}';
begin
  if v_full_name is null and v_community is null then
    raise exception 'update_volunteer: se requiere p_full_name o p_community'
      using errcode = '22023';
  end if;
  if v_full_name is not null and (v_full_name = '' or length(v_full_name) > 120) then
    raise exception 'update_volunteer: p_full_name vacio o de mas de 120 caracteres'
      using errcode = '22023';
  end if;
  if v_community is not null and (v_community = '' or length(v_community) > 120) then
    raise exception 'update_volunteer: p_community vacio o de mas de 120 caracteres'
      using errcode = '22023';
  end if;

  -- FOR UPDATE: serializa con register_check_in y deactivate_volunteer, que
  -- toman el mismo lock de fila.
  select * into v_old from volunteers where id = p_volunteer_id for update;
  if not found then
    -- volunteer_id va en detail, no en la columna: audit_logs.volunteer_id es
    -- FK a volunteers y un id inexistente la violaria.
    insert into audit_logs (event_type, detail)
    values (
      'update_volunteer_not_found',
      jsonb_build_object('volunteer_id', p_volunteer_id, 'operator_id', p_operator_id)
    );
    return jsonb_build_object('code', 'volunteer_not_found', 'message', 'El voluntario no existe');
  end if;

  if v_full_name is not null and v_full_name <> v_old.full_name then
    v_changed := v_changed || 'full_name'::text;
  end if;
  if v_community is not null and v_community <> v_old.community then
    v_changed := v_changed || 'community'::text;
  end if;

  if cardinality(v_changed) = 0 then
    v_new := v_old;
  else
    update volunteers
    set full_name  = coalesce(v_full_name, full_name),
        community  = coalesce(v_community, community),
        updated_at = now()
    where id = p_volunteer_id
    returning * into v_new;

    -- Solo los nombres de los campos, no los valores: audit_logs no debe
    -- convertirse en una segunda copia de datos personales.
    insert into audit_logs (event_type, volunteer_id, detail)
    values (
      'volunteer_updated', p_volunteer_id,
      jsonb_build_object('operator_id', p_operator_id, 'changed_fields', to_jsonb(v_changed))
    );
  end if;

  return jsonb_build_object(
    'code', 'ok',
    'changed_fields', to_jsonb(v_changed),
    'volunteer', jsonb_build_object(
      'id', v_new.id,
      'full_name', v_new.full_name,
      'community', v_new.community,
      'is_active', v_new.is_active
    )
  );
end;
$$;

comment on function update_volunteer(uuid, text, text, uuid) is
  'Actualiza full_name y/o community (null = no cambiar). Codigos: ok | volunteer_not_found (docs/nfc-contract.md).';

-- deactivate_volunteer: idempotente. Si ya estaba inactivo responde ok con
-- already_inactive = true y no vuelve a auditar.
create or replace function deactivate_volunteer(
  p_volunteer_id uuid,
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
  select * into v_vol from volunteers where id = p_volunteer_id for update;
  if not found then
    insert into audit_logs (event_type, detail)
    values (
      'deactivate_volunteer_not_found',
      jsonb_build_object('volunteer_id', p_volunteer_id, 'operator_id', p_operator_id)
    );
    return jsonb_build_object('code', 'volunteer_not_found', 'message', 'El voluntario no existe');
  end if;

  if not v_vol.is_active then
    return jsonb_build_object(
      'code', 'ok',
      'already_inactive', true,
      'volunteer', jsonb_build_object('id', v_vol.id, 'full_name', v_vol.full_name, 'is_active', false)
    );
  end if;

  update volunteers
  set is_active = false,
      updated_at = now()
  where id = p_volunteer_id;

  insert into audit_logs (event_type, volunteer_id, detail)
  values ('volunteer_deactivated', p_volunteer_id, jsonb_build_object('operator_id', p_operator_id));

  return jsonb_build_object(
    'code', 'ok',
    'already_inactive', false,
    'volunteer', jsonb_build_object('id', v_vol.id, 'full_name', v_vol.full_name, 'is_active', false)
  );
end;
$$;

comment on function deactivate_volunteer(uuid, uuid) is
  'Marca al voluntario como inactivo (idempotente). Codigos: ok | volunteer_not_found (docs/nfc-contract.md).';

-- Mismo esquema de permisos que las funciones de 002: solo service_role
-- (las Edge Functions) las ejecuta.
revoke all on function update_volunteer(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function deactivate_volunteer(uuid, uuid) from public, anon, authenticated;

grant execute on function update_volunteer(uuid, text, text, uuid) to service_role;
grant execute on function deactivate_volunteer(uuid, uuid) to service_role;

commit;
