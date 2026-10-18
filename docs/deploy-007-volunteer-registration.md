# Despliegue: alta de voluntario con cuenta de acceso (migración 007)

Para quien tiene acceso al proyecto de Supabase. Nada de esto se ha
ejecutado contra el proyecto real: todo lo de abajo está **pendiente**,
y hay comportamiento de Supabase Auth que solo se puede verificar ahí
(ver "Qué falta verificar con el Auth real").

## Qué se despliega

| Pieza | Archivo |
|---|---|
| Tabla `volunteer_registrations` (sin contraseñas; RLS sin policies) | `supabase/007_volunteer_registration.sql` |
| Funciones `begin_`, `complete_` y `fail_volunteer_registration` (solo `service_role`) | ídem |
| Edge Function `register-volunteer-account` | `supabase/functions/register-volunteer-account/index.ts`, `_shared/registration.ts` |

`enroll-volunteer` y su contrato no cambian. Contrato de la nueva función:
`docs/nfc-contract.md`, función 13.

## Antes de empezar

- Deben estar aplicadas la `002` y la `005` (`volunteers.user_id`).
- La política de contraseñas del proyecto está en Dashboard → Authentication →
  Providers → Email → Password requirements. La función exige como mínimo
  8 caracteres y como máximo 72 bytes. Si Auth exige más, la función responde
  `weak_password`; conviene decírselo a Nicole para que la pantalla muestre
  la regla correcta.
- "Secure password change" (Authentication → Providers → Email): si está
  activado, el cambio de contraseña opcional responde `reauthentication_needed`.
  En ese caso habría que agregar un flujo con `supabase.auth.reauthenticate()`.

## Pasos

1. **Migración.** Pega y corre `supabase/007_volunteer_registration.sql` en el
   SQL editor. No necesita `app.card_hmac_secret` y se puede volver a correr.
   ```sql
   select p.proname,
          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,  -- false
          has_function_privilege('service_role', p.oid, 'execute')  as service_role    -- true
     from pg_proc p
    where p.proname in ('begin_volunteer_registration', 'complete_volunteer_registration',
                        'fail_volunteer_registration');
   select has_table_privilege('authenticated', 'volunteer_registrations', 'select');  -- false
   ```
2. **Edge Function.** Usa los mismos secretos que las demás:
   `CARD_UID_HMAC_SECRET`, más `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`,
   que inyecta Supabase. Deja `verify_jwt` activado.
   ```bash
   supabase functions deploy register-volunteer-account --project-ref <ref>
   ```
   `_shared/handler.ts` cambió por dentro (se extrajo `authorize()`), sin cambiar
   el comportamiento; las pruebas de las demás funciones siguen pasando. Si las
   vuelves a desplegar, toman ese mismo código.

## Pruebas de humo (con datos DE PRUEBA)

Usa un email que no exista en Auth, una tarjeta de prueba y una contraseña
temporal que inventes en ese momento. **No** la pegues en el repo, en chats
ni en este documento.

```bash
URL=https://<ref>.supabase.co/functions/v1
H=(-H "apikey: $ANON_KEY" -H "Content-Type: application/json")
CRID=$(python3 -c 'import uuid; print(uuid.uuid4())')
BODY="{\"client_request_id\":\"$CRID\",\"full_name\":\"PRUEBA alta\",\"community\":\"x\",
       \"uid\":\"<UID de prueba>\",\"email\":\"<email de prueba>\",\"password\":\"$TEMP_PASSWORD\"}"

# a) guard -> 403 (no crea nada)
curl -s -X POST "$URL/register-volunteer-account" "${H[@]}" -H "Authorization: Bearer $GUARD_TOKEN" -d "$BODY"
# b) admin -> {"code":"ok","replayed":false,...}
curl -s -X POST "$URL/register-volunteer-account" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" -d "$BODY"
# c) exactamente lo mismo otra vez -> {"code":"ok","replayed":true,...}; en Auth sigue habiendo UNA cuenta
# d) otro CRID con el email del admin -> {"code":"email_in_use"}; la contraseña del admin NO cambia
```

Después: inicia sesión en la app con el email y la contraseña de prueba. Con
`getMyVolunteerProfile()` deben verse el voluntario y 0 puntos; un check-in
con la tarjeta de prueba debe sumar puntos.

## Qué falta verificar con el Auth real

1. Los códigos de error de `auth.admin.createUser` y `updateUserById`:
   `email_exists` o `user_already_exists`, `weak_password` y
   `email_address_invalid`. Si tu versión de GoTrue usa otros, ajusta
   `mapAuthAdminError` en `_shared/deps.ts`; los demás se tratan como `unavailable` (500, reintentable).
2. Que `app_metadata.bamx_registration_id` quede en `auth.users.raw_app_meta_data`.
   Compruébalo con `select raw_app_meta_data from auth.users where email = '<email de prueba>';`.
3. Que `email_confirm: true` permita iniciar sesión sin confirmar el correo.
4. Que Auth guarde el email en minúsculas. La función ya lo manda en minúsculas.
5. Que `deleteUser` responda sin error (o 404) en la compensación. Solo se
   llama con cuentas sin profile y sin vínculo.

## Recuperación ante fallas

- **500 antes de crear la cuenta:** no se creó nada. Reintentar con el mismo `client_request_id`.
- **500 después de crear la cuenta** (se cayó la conexión antes de completar):
  el reintento reconoce la cuenta por `app_metadata.bamx_registration_id`, le
  pone la contraseña de ese intento y termina. No se crea una segunda cuenta.
- **`card_in_use` con `account_cleanup: "done"`:** la cuenta que se alcanzó a
  crear se borró. No queda nada a medias.
- **`account_conflict`:** la cuenta creada por el alta ya tenía un rol o un
  vínculo, puesto a mano desde el Dashboard o SQL. **No se borra**: hay que
  revisarla manualmente. La compensación solo borra cuentas sin profile y sin
  voluntario vinculado.
- **`account_cleanup: "pending"`:** no se pudo borrar. Reintentar con el mismo
  `client_request_id` lo vuelve a intentar. Si nadie reintenta, la cuenta queda
  sin rol ni voluntario: puede iniciar sesión, pero todo le responde 403 o vacío.
- **Si se abandona un alta a medias** (500 después de crear la cuenta y nadie
  reintenta), se puede encontrar así:
  ```sql
  select r.id, r.status, r.failure_reason, r.created_at, u.id as auth_user_id
  from volunteer_registrations r
  join auth.users u on u.raw_app_meta_data->>'bamx_registration_id' = r.id::text
  where r.status <> 'completed';
  ```
  Esas cuentas se pueden borrar desde Authentication → Users, o reintentar el
  alta con el mismo `client_request_id` (está en `r.client_request_id`).

## Revertir

Las altas completadas ya son voluntarios y cuentas normales y no se deshacen
solas. Para quitar solo la operación nueva:
```sql
drop function if exists begin_volunteer_registration(uuid, text, text, text, text, uuid);
drop function if exists complete_volunteer_registration(uuid, uuid, uuid);
drop function if exists fail_volunteer_registration(uuid, text, uuid);
drop function if exists registration_fail(uuid, text, text, uuid, uuid);
drop function if exists registration_result(volunteer_registrations, boolean);
drop function if exists registration_account(uuid, text);
drop table if exists volunteer_registrations;
```
y borra la Edge Function desde el Dashboard.

## Qué se probó y dónde (solo local)

| Prueba | Cómo | Resultado |
|---|---|---|
| Máquina de estados SQL, conflictos, reintentos, compensación, permisos, compatibilidad | Postgres 16 local (`supabase/tests/60_volunteer_registration_cases.sql`) | 29/29 |
| Dos altas con la misma tarjeta en paralelo | `run_tests.sh` [1e] | PASS |
| Orquestación Auth + SQL, fallas en cada paso, logs sin contraseña | Deno con Auth y RPC simulados (`_shared/registration_test.ts`) | 19/19 |
| Servicios del frontend | jest con Supabase simulado (`volunteers.test.ts`, `account.test.ts`) | 15/15 y 6/6 |
