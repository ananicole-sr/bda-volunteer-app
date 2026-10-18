-- ============================================================================
-- BAMX · Cuentas de voluntario: vincular volunteers <-> auth.users y lectura
-- de sus propios datos
--
-- Incremental sobre 002_nfc_security.sql (requiere que ya este aplicada; no
-- depende de 003 ni de 004).
--   - volunteers.user_id: opcional, UNIQUE (una cuenta = un voluntario),
--     on delete set null (borrar la cuenta de Auth no borra al voluntario ni
--     su historial). Los voluntarios existentes quedan sin vincular.
--   - link_volunteer_account: SECURITY DEFINER, la expone la Edge Function
--     link-volunteer-account (docs/nfc-contract.md, funcion 9). Vincula y
--     audita en la misma transaccion.
--   - Policies NUEVAS de lectura para el rol 'volunteer'. Se suman (OR) a las
--     de staff/admin de 002, que no se tocan.
--   - anon/authenticated pierden INSERT/UPDATE/DELETE sobre volunteers (RLS ya
--     los bloqueaba; esto es una segunda barrera para que nadie asigne user_id
--     desde el cliente).
--
-- No necesita app.card_hmac_secret y se puede correr mas de una vez.
-- Como correrlo: SQL editor de Supabase, pegar/correr este archivo completo.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. volunteers.user_id
-- ----------------------------------------------------------------------------
alter table volunteers
  add column if not exists user_id uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'volunteers_user_id_key') then
    alter table volunteers add constraint volunteers_user_id_key unique (user_id);
  end if;
end $$;

comment on column volunteers.user_id is
  'Cuenta de Supabase Auth (rol volunteer) de este voluntario. Opcional y unica. Solo la asigna link_volunteer_account.';

-- Segunda barrera: el cliente nunca escribe volunteers directo (no hay
-- policies de escritura). Las funciones SECURITY DEFINER no se ven afectadas.
revoke insert, update, delete on volunteers from anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. Helpers de rol/identidad para las policies. SECURITY INVOKER (default),
--    igual que is_staff()/is_admin(): respetan profiles_read_own y la policy
--    volunteers_read_own de abajo.
-- ----------------------------------------------------------------------------
create or replace function is_volunteer()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'volunteer'
  );
$$;

comment on function is_volunteer() is 'true si el usuario autenticado tiene role volunteer en profiles.';

-- id del voluntario vinculado a la sesion actual (null si no hay vinculo).
create or replace function my_volunteer_id()
returns uuid
language sql
stable
as $$
  select id from volunteers where user_id = auth.uid();
$$;

comment on function my_volunteer_id() is 'volunteers.id vinculado a auth.uid(), o null si la cuenta no esta vinculada.';


-- ----------------------------------------------------------------------------
-- 3. link_volunteer_account
-- ----------------------------------------------------------------------------
-- Codigos: ok (already_linked true/false) | volunteer_not_found |
-- account_not_found | account_not_volunteer | volunteer_already_linked |
-- account_in_use. Los rechazos tambien se auditan (link_account_rejected).
-- Nunca crea cuentas ni asigna roles: solo vincula una cuenta que ya existe y
-- que ya tiene role = 'volunteer'.
create or replace function link_volunteer_account(
  p_volunteer_id uuid,
  p_user_id      uuid,
  p_operator_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vol        volunteers%rowtype;
  v_role       text;
  v_other      uuid;
  v_constraint text;

  -- Rechazo auditado. volunteer_id va en detail (no en la columna) porque
  -- puede no existir y audit_logs.volunteer_id es FK a volunteers.
  v_reject_code text;
  v_reject_msg  text;
begin
  if p_volunteer_id is null or p_user_id is null then
    raise exception 'link_volunteer_account: p_volunteer_id y p_user_id requeridos' using errcode = '22023';
  end if;

  -- FOR UPDATE: dos vinculaciones simultaneas del mismo voluntario se
  -- serializan; la segunda ve el user_id que dejo la primera.
  select * into v_vol from volunteers where id = p_volunteer_id for update;

  if not found then
    v_reject_code := 'volunteer_not_found';
    v_reject_msg  := 'El voluntario no existe';
  elsif not exists (select 1 from auth.users where id = p_user_id) then
    v_reject_code := 'account_not_found';
    v_reject_msg  := 'La cuenta no existe';
  else
    select role into v_role from profiles where id = p_user_id;
    if v_role is distinct from 'volunteer' then
      v_reject_code := 'account_not_volunteer';
      v_reject_msg  := 'La cuenta no tiene el rol volunteer';
    elsif v_vol.user_id = p_user_id then
      -- Repetir el mismo vinculo es seguro: no escribe ni audita otra vez.
      return jsonb_build_object(
        'code', 'ok',
        'already_linked', true,
        'volunteer', jsonb_build_object('id', v_vol.id, 'full_name', v_vol.full_name, 'user_id', v_vol.user_id)
      );
    elsif v_vol.user_id is not null then
      v_reject_code := 'volunteer_already_linked';
      v_reject_msg  := 'El voluntario ya esta vinculado a otra cuenta';
    else
      select id into v_other from volunteers where user_id = p_user_id;
      if v_other is not null then
        v_reject_code := 'account_in_use';
        v_reject_msg  := 'La cuenta ya esta vinculada a otro voluntario';
      end if;
    end if;
  end if;

  if v_reject_code is not null then
    insert into audit_logs (event_type, detail)
    values (
      'link_account_rejected',
      jsonb_build_object('reason', v_reject_code, 'volunteer_id', p_volunteer_id,
                         'user_id', p_user_id, 'operator_id', p_operator_id)
    );
    return jsonb_build_object('code', v_reject_code, 'message', v_reject_msg);
  end if;

  -- Vinculo + auditoria en la misma transaccion. Si otra sesion vinculo esa
  -- cuenta a otro voluntario en paralelo, el UNIQUE lo detecta.
  begin
    update volunteers
    set user_id = p_user_id,
        updated_at = now()
    where id = p_volunteer_id
    returning * into v_vol;

    insert into audit_logs (event_type, volunteer_id, detail)
    values (
      'volunteer_account_linked', p_volunteer_id,
      jsonb_build_object('user_id', p_user_id, 'operator_id', p_operator_id)
    );
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'volunteers_user_id_key' then
      raise;
    end if;
    insert into audit_logs (event_type, detail)
    values (
      'link_account_rejected',
      jsonb_build_object('reason', 'account_in_use', 'volunteer_id', p_volunteer_id,
                         'user_id', p_user_id, 'operator_id', p_operator_id, 'race', true)
    );
    return jsonb_build_object('code', 'account_in_use', 'message', 'La cuenta ya esta vinculada a otro voluntario');
  end;

  return jsonb_build_object(
    'code', 'ok',
    'already_linked', false,
    'volunteer', jsonb_build_object('id', v_vol.id, 'full_name', v_vol.full_name, 'user_id', v_vol.user_id)
  );
end;
$$;

comment on function link_volunteer_account(uuid, uuid, uuid) is
  'Vincula un voluntario existente a una cuenta Auth existente con role volunteer. Codigos: ok | volunteer_not_found | account_not_found | account_not_volunteer | volunteer_already_linked | account_in_use (docs/nfc-contract.md).';

revoke all on function link_volunteer_account(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function link_volunteer_account(uuid, uuid, uuid) to service_role;


-- ----------------------------------------------------------------------------
-- 4. RLS: lectura de los propios datos para el rol volunteer. Se suman a
--    volunteers_read_staff, check_ins_read_staff, rewards_read_staff y
--    reward_redemptions_read_admin (002), que quedan igual. cards,
--    audit_logs y point_tiers NO reciben policy para volunteer.
-- ----------------------------------------------------------------------------
drop policy if exists "volunteers_read_own" on volunteers;
create policy "volunteers_read_own" on volunteers
  for select to authenticated
  using (user_id is not null and user_id = auth.uid());

drop policy if exists "check_ins_read_own" on check_ins;
create policy "check_ins_read_own" on check_ins
  for select to authenticated
  using (volunteer_id = my_volunteer_id());

drop policy if exists "reward_redemptions_read_own" on reward_redemptions;
create policy "reward_redemptions_read_own" on reward_redemptions
  for select to authenticated
  using (volunteer_id = my_volunteer_id());

-- Catalogo activo para cualquier cuenta volunteer (vinculada o no), y ademas
-- las recompensas que ese voluntario ya canjeo aunque hoy esten inactivas,
-- para que su historial pueda mostrar el nombre.
drop policy if exists "rewards_read_volunteer" on rewards;
create policy "rewards_read_volunteer" on rewards
  for select to authenticated
  using (
    is_volunteer()
    and (
      is_active
      or id in (select rr.reward_id from reward_redemptions rr where rr.volunteer_id = my_volunteer_id())
    )
  );

commit;
