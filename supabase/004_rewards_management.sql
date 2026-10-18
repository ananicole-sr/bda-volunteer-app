-- ============================================================================
-- BAMX · Catalogo de recompensas: crear, actualizar y desactivar
--
-- Incremental sobre 002_nfc_security.sql (requiere que ya este aplicada; no
-- depende de 003). Agrega las 3 funciones SECURITY DEFINER que exponen las
-- Edge Functions create-reward, update-reward y deactivate-reward
-- (docs/nfc-contract.md, funciones 6, 7 y 8).
--
-- No hay borrado fisico: deactivate_reward pone is_active = false, asi que
-- reward_redemptions (FK on delete restrict) conserva su historial. Las
-- lecturas no cambian: rewards_read_staff (002) sigue siendo la unica policy.
--
-- No cambia tablas ni policies, no necesita app.card_hmac_secret y se puede
-- correr mas de una vez (create or replace + revoke/grant idempotentes).
--
-- Como correrlo: SQL editor de Supabase, pegar/correr este archivo completo.
-- ============================================================================

begin;

-- Limites de texto compartidos por las 3 funciones (los mismos que valida la
-- Edge Function). Los numericos ya los acota el tipo integer y los CHECK
-- (>= 0) de la tabla rewards.
create or replace function reward_check_text(p_name text, p_description text)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_name is not null and (p_name = '' or length(p_name) > 120) then
    raise exception 'reward: name vacio o de mas de 120 caracteres' using errcode = '22023';
  end if;
  if p_description is not null and length(p_description) > 500 then
    raise exception 'reward: description de mas de 500 caracteres' using errcode = '22023';
  end if;
end;
$$;

revoke all on function reward_check_text(text, text) from public, anon, authenticated;

-- Forma comun de la recompensa en las respuestas.
create or replace function reward_json(r rewards)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'description', r.description,
    'points_cost', r.points_cost,
    'stock', r.stock,
    'is_active', r.is_active,
    'created_at', r.created_at
  );
$$;

revoke all on function reward_json(rewards) from public, anon, authenticated;


-- create_reward: description vacia o null => null. Las validaciones son una
-- segunda barrera tras la Edge Function: abortan con excepcion (500 generico).
create or replace function create_reward(
  p_name        text,
  p_description text,
  p_points_cost integer,
  p_stock       integer,
  p_operator_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name        text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
  v_reward      rewards%rowtype;
begin
  if v_name is null then
    raise exception 'create_reward: p_name requerido' using errcode = '22023';
  end if;
  if p_points_cost is null or p_points_cost < 0 or p_stock is null or p_stock < 0 then
    raise exception 'create_reward: points_cost y stock deben ser enteros >= 0' using errcode = '22023';
  end if;
  perform reward_check_text(v_name, v_description);

  insert into rewards (name, description, points_cost, stock)
  values (v_name, v_description, p_points_cost, p_stock)
  returning * into v_reward;

  insert into audit_logs (event_type, detail)
  values ('reward_created', jsonb_build_object('reward_id', v_reward.id, 'operator_id', p_operator_id));

  return jsonb_build_object('code', 'ok', 'reward', reward_json(v_reward));
end;
$$;

comment on function create_reward(text, text, integer, integer, uuid) is
  'Alta de recompensa activa. Codigos: ok (docs/nfc-contract.md).';


-- update_reward: null = "no cambiar" en name/points_cost/stock. description
-- es la unica columna que admite null, asi que se distingue con
-- p_clear_description: true => description = null (ignora p_description).
create or replace function update_reward(
  p_reward_id         uuid,
  p_name              text,
  p_description       text,
  p_clear_description boolean,
  p_points_cost       integer,
  p_stock             integer,
  p_operator_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clear       boolean := coalesce(p_clear_description, false);
  v_name        text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
  v_old         rewards%rowtype;
  v_new         rewards%rowtype;
  v_changed     text[] := '{}';
begin
  -- Descripcion en blanco equivale a borrarla.
  if p_description is not null and v_description is null then
    v_clear := true;
  end if;
  if v_name is null and not v_clear and v_description is null
     and p_points_cost is null and p_stock is null then
    raise exception 'update_reward: no hay nada que cambiar' using errcode = '22023';
  end if;
  if (p_points_cost is not null and p_points_cost < 0) or (p_stock is not null and p_stock < 0) then
    raise exception 'update_reward: points_cost y stock deben ser enteros >= 0' using errcode = '22023';
  end if;
  perform reward_check_text(v_name, v_description);

  select * into v_old from rewards where id = p_reward_id for update;
  if not found then
    insert into audit_logs (event_type, detail)
    values (
      'update_reward_not_found',
      jsonb_build_object('reward_id', p_reward_id, 'operator_id', p_operator_id)
    );
    return jsonb_build_object('code', 'reward_not_found', 'message', 'La recompensa no existe');
  end if;

  if v_name is not null and v_name <> v_old.name then
    v_changed := v_changed || 'name'::text;
  end if;
  if (v_clear and v_old.description is not null)
     or (not v_clear and v_description is not null and v_description is distinct from v_old.description) then
    v_changed := v_changed || 'description'::text;
  end if;
  if p_points_cost is not null and p_points_cost <> v_old.points_cost then
    v_changed := v_changed || 'points_cost'::text;
  end if;
  if p_stock is not null and p_stock <> v_old.stock then
    v_changed := v_changed || 'stock'::text;
  end if;

  if cardinality(v_changed) = 0 then
    v_new := v_old;
  else
    update rewards
    set name        = coalesce(v_name, name),
        description = case when v_clear then null else coalesce(v_description, description) end,
        points_cost = coalesce(p_points_cost, points_cost),
        stock       = coalesce(p_stock, stock)
    where id = p_reward_id
    returning * into v_new;

    insert into audit_logs (event_type, detail)
    values (
      'reward_updated',
      jsonb_build_object('reward_id', p_reward_id, 'operator_id', p_operator_id, 'changed_fields', to_jsonb(v_changed))
    );
  end if;

  return jsonb_build_object('code', 'ok', 'changed_fields', to_jsonb(v_changed), 'reward', reward_json(v_new));
end;
$$;

comment on function update_reward(uuid, text, text, boolean, integer, integer, uuid) is
  'Actualiza name/description/points_cost/stock (null = no cambiar; p_clear_description borra la descripcion). Codigos: ok | reward_not_found (docs/nfc-contract.md).';


-- deactivate_reward: is_active = false, idempotente. Nunca borra la fila.
create or replace function deactivate_reward(
  p_reward_id   uuid,
  p_operator_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reward rewards%rowtype;
begin
  select * into v_reward from rewards where id = p_reward_id for update;
  if not found then
    insert into audit_logs (event_type, detail)
    values (
      'deactivate_reward_not_found',
      jsonb_build_object('reward_id', p_reward_id, 'operator_id', p_operator_id)
    );
    return jsonb_build_object('code', 'reward_not_found', 'message', 'La recompensa no existe');
  end if;

  if not v_reward.is_active then
    return jsonb_build_object('code', 'ok', 'already_inactive', true, 'reward', reward_json(v_reward));
  end if;

  update rewards set is_active = false where id = p_reward_id returning * into v_reward;

  insert into audit_logs (event_type, detail)
  values ('reward_deactivated', jsonb_build_object('reward_id', p_reward_id, 'operator_id', p_operator_id));

  return jsonb_build_object('code', 'ok', 'already_inactive', false, 'reward', reward_json(v_reward));
end;
$$;

comment on function deactivate_reward(uuid, uuid) is
  'Marca la recompensa como inactiva (idempotente, sin borrar). Codigos: ok | reward_not_found (docs/nfc-contract.md).';


-- Solo service_role (las Edge Functions) ejecuta las 3 funciones.
revoke all on function create_reward(text, text, integer, integer, uuid) from public, anon, authenticated;
revoke all on function update_reward(uuid, text, text, boolean, integer, integer, uuid) from public, anon, authenticated;
revoke all on function deactivate_reward(uuid, uuid) from public, anon, authenticated;

grant execute on function create_reward(text, text, integer, integer, uuid) to service_role;
grant execute on function update_reward(uuid, text, text, boolean, integer, integer, uuid) to service_role;
grant execute on function deactivate_reward(uuid, uuid) to service_role;

commit;
