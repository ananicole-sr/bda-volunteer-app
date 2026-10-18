-- ============================================================================
-- BAMX · Correccion de issue_card (volunteer_not_found)
--
-- Incremental sobre 002_nfc_security.sql; no la reescribe. Problema: con un
-- volunteer_id inexistente, issue_card insertaba ese id en
-- audit_logs.volunteer_id, que es FK a volunteers, y la funcion abortaba con
-- foreign_key_violation (la Edge Function issue-card respondia 500
-- server_error) en vez del codigo documentado volunteer_not_found.
--
-- Cambio: SOLO el insert de auditoria del caso "voluntario no existe"; el id
-- intentado se guarda en detail.volunteer_id. Firma, codigos de respuesta
-- (ok | card_in_use | volunteer_not_found), reemplazo de tarjeta (revoca la
-- activa previa), auditorias del resto de casos y permisos: identicos a 002.
--
-- No necesita app.card_hmac_secret y se puede correr mas de una vez.
-- Como correrlo: SQL editor de Supabase, pegar/correr este archivo completo.
-- ============================================================================

begin;

create or replace function issue_card(
  p_volunteer_id uuid,
  p_uid_hmac     text,
  p_operator_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_card_id  uuid;
  v_new_card_id  uuid;
  v_revoked_prev boolean := false;
begin
  if not exists (select 1 from volunteers where id = p_volunteer_id) then
    -- 008: el id intentado va en detail, NO en audit_logs.volunteer_id (FK a
    -- volunteers): un id inexistente violaba la FK y la funcion lanzaba un
    -- error (500 en la Edge Function) en lugar de responder volunteer_not_found.
    insert into audit_logs (event_type, detail)
    values ('issue_card_volunteer_not_found',
            jsonb_build_object('volunteer_id', p_volunteer_id, 'operator_id', p_operator_id));
    return jsonb_build_object('code', 'volunteer_not_found', 'message', 'El voluntario no existe');
  end if;

  if exists (select 1 from cards where uid_hmac = p_uid_hmac) then
    insert into audit_logs (event_type, volunteer_id, detail)
    values ('issue_card_in_use', p_volunteer_id, jsonb_build_object('operator_id', p_operator_id));
    return jsonb_build_object('code', 'card_in_use', 'message', 'La tarjeta ya esta asignada a otro voluntario');
  end if;

  -- Mismo motivo que en enroll_volunteer: si el insert final choca por una
  -- condicion de carrera, el EXCEPTION revierte tambien el revoke de arriba.
  begin
    select id into v_old_card_id from cards
      where volunteer_id = p_volunteer_id and status = 'active';

    if v_old_card_id is not null then
      update cards set status = 'revoked' where id = v_old_card_id;
      v_revoked_prev := true;
    end if;

    insert into cards (volunteer_id, uid_hmac, status, issued_at, issued_by)
    values (p_volunteer_id, p_uid_hmac, 'active', now(), p_operator_id)
    returning id into v_new_card_id;
  exception when unique_violation then
    insert into audit_logs (event_type, volunteer_id, detail)
    values ('issue_card_in_use', p_volunteer_id, jsonb_build_object('operator_id', p_operator_id, 'race', true));
    return jsonb_build_object('code', 'card_in_use', 'message', 'La tarjeta ya esta asignada a otro voluntario');
  end;

  if v_revoked_prev then
    insert into audit_logs (event_type, volunteer_id, detail)
    values (
      'issue_card_revoked_previous', p_volunteer_id,
      jsonb_build_object('old_card_id', v_old_card_id, 'new_card_id', v_new_card_id, 'operator_id', p_operator_id)
    );
  end if;

  return jsonb_build_object(
    'code', 'ok',
    'card_id', v_new_card_id,
    'revoked_previous', v_revoked_prev
  );
end;
$$;


comment on function issue_card(uuid, text, uuid) is
  'Emite/reemplaza la tarjeta de un voluntario, revocando la activa previa. Codigos: ok | card_in_use | volunteer_not_found (docs/nfc-contract.md). 008: volunteer_not_found ya no viola la FK de audit_logs.';

-- create or replace conserva los permisos; se repiten para que el archivo sea
-- autosuficiente (mismos que 002: solo service_role).
revoke all on function issue_card(uuid, text, uuid) from public, anon, authenticated;
grant execute on function issue_card(uuid, text, uuid) to service_role;

commit;
