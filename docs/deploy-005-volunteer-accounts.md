# Despliegue: cuentas de voluntario (migración 005)

Para quien tiene acceso al proyecto de Supabase. Nada de esto se ha
ejecutado contra el proyecto real: todo lo de abajo está **pendiente**.

## Qué se despliega

| Pieza | Archivo |
|---|---|
| Columna `volunteers.user_id` (opcional, `UNIQUE`, `on delete set null`) | `supabase/005_volunteer_accounts.sql` |
| Función SQL `link_volunteer_account` y helpers `is_volunteer()` y `my_volunteer_id()` | ídem |
| Policies de lectura propia: `volunteers_read_own`, `check_ins_read_own`, `reward_redemptions_read_own`, `rewards_read_volunteer` | ídem |
| `REVOKE INSERT, UPDATE, DELETE ON volunteers FROM anon, authenticated` | ídem |
| Edge Function `link-volunteer-account` | `supabase/functions/link-volunteer-account/index.ts` |

Contrato: `docs/nfc-contract.md`, función 9 y la sección "Lecturas del rol volunteer".

## Antes de empezar

- `002_nfc_security.sql` debe estar aplicada. La 005 no depende de la 003 ni de la 004.
- **Revisa que nadie escriba `volunteers` desde el cliente con la anon key.**
  Hoy ningún código del frontend lo hace, y la RLS ya lo bloqueaba. Esta
  migración además quita esos permisos a nivel de tabla.

## Pasos

1. **Migración.** Pega y corre `supabase/005_volunteer_accounts.sql` completo en
   el SQL editor. No necesita `app.card_hmac_secret` y se puede volver a correr.
   Los voluntarios existentes quedan con `user_id = null`, sin vincular.
   ```sql
   -- Verificación
   select column_name, is_nullable from information_schema.columns
    where table_name = 'volunteers' and column_name = 'user_id';             -- 1 fila, YES
   select conname from pg_constraint where conname = 'volunteers_user_id_key'; -- 1 fila
   select policyname, tablename from pg_policies
    where policyname in ('volunteers_read_own', 'check_ins_read_own',
                         'reward_redemptions_read_own', 'rewards_read_volunteer'); -- 4 filas
   select has_function_privilege('authenticated', 'link_volunteer_account(uuid, uuid, uuid)', 'execute'), -- false
          has_function_privilege('service_role',  'link_volunteer_account(uuid, uuid, uuid)', 'execute'), -- true
          has_table_privilege('authenticated', 'volunteers', 'update');                                   -- false
   ```

2. **Edge Function.**
   ```bash
   supabase functions deploy link-volunteer-account --project-ref <ref>
   ```
   No necesita secretos nuevos. Deja `verify_jwt` activado.
   `_shared/validate.ts` y `specs.ts` solo recibieron código nuevo, así que
   volver a desplegar las demás funciones es opcional.

## Cómo se vincula una cuenta (manual, a propósito)

1. Crear el usuario en Authentication → Users. Copia su **User UID**.
2. Darle el rol en el SQL editor (ver `supabase/dev_profiles.sql.example`):
   `insert into profiles (id, role) values ('<User UID>', 'volunteer');`
3. Un admin llama a `link-volunteer-account` con el `id` del voluntario y ese UID.

La función nunca crea cuentas, nunca asigna roles y nunca empareja por nombre
o email. Hoy no existe forma de que el admin busque el UID desde la app; eso
queda pendiente.

## Pruebas de humo después de desplegar

```bash
URL=https://<ref>.supabase.co/functions/v1
H=(-H "apikey: $ANON_KEY" -H "Content-Type: application/json")

# a) guard -> 403 {"code":"forbidden"} (no escribe)
curl -s -X POST "$URL/link-volunteer-account" "${H[@]}" -H "Authorization: Bearer $GUARD_TOKEN" \
  -d '{"volunteer_id":"<id>","user_id":"<uid>"}'

# b) admin con un user_id que no es UUID -> 400 invalid_request (no escribe)
curl -s -X POST "$URL/link-volunteer-account" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"volunteer_id":"<id>","user_id":"voluntario@bamx.test"}'

# c) admin intenta vincular la cuenta del guard -> 200 {"code":"account_not_volunteer"} (solo auditoría)
curl -s -X POST "$URL/link-volunteer-account" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"volunteer_id":"<id de prueba>","user_id":"<UID del guard>"}'

# d) vínculo real con un voluntario y una cuenta DE PRUEBA -> ok, already_linked false; repetir -> true
curl -s -X POST "$URL/link-volunteer-account" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"volunteer_id":"<id de prueba>","user_id":"<UID volunteer de prueba>"}'
```

Después inicia sesión con la cuenta del voluntario de prueba y comprueba con
la REST API (o con `getMyVolunteerProfile()` desde la app):

```bash
# solo 1 fila, la suya
curl -s "https://<ref>.supabase.co/rest/v1/volunteers?select=id,full_name,points" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $VOLUNTEER_TOKEN"
# [] : no ve tarjetas ni auditoría
curl -s "https://<ref>.supabase.co/rest/v1/cards?select=id"      -H "apikey: $ANON_KEY" -H "Authorization: Bearer $VOLUNTEER_TOKEN"
curl -s "https://<ref>.supabase.co/rest/v1/audit_logs?select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $VOLUNTEER_TOKEN"
```

Y confirma que el dashboard de admin sigue mostrando todos los voluntarios.

## Si algo sale mal

- **PGRST202 en los logs de la función:** corre `notify pgrst, 'reload schema';`.
- **Revertir** (los vínculos hechos se pierden):
  ```sql
  drop policy if exists "volunteers_read_own" on volunteers;
  drop policy if exists "check_ins_read_own" on check_ins;
  drop policy if exists "reward_redemptions_read_own" on reward_redemptions;
  drop policy if exists "rewards_read_volunteer" on rewards;
  drop function if exists link_volunteer_account(uuid, uuid, uuid);
  drop function if exists my_volunteer_id();
  drop function if exists is_volunteer();
  alter table volunteers drop column if exists user_id;
  grant insert, update, delete on volunteers to anon, authenticated;  -- default de Supabase; la RLS sigue bloqueando
  ```
- **Desvincular una cuenta** (no hay función para eso todavía):
  `update volunteers set user_id = null where id = '<id>';`, desde el SQL editor.

## Qué se probó y dónde (solo local)

| Prueba | Cómo | Resultado |
|---|---|---|
| Auth, rol admin, validación y argumentos RPC | Deno con dependencias simuladas (`supabase/functions/_shared/shared_test.ts`) | 47/47 en total (6 de esta función) |
| Migración, conflictos, RLS por usuario, staff sin cambios, borrado de cuenta | Postgres 16 local (`supabase/tests/40_volunteer_accounts_cases.sql`) | 28/28 |
| Misma cuenta vinculada en paralelo a dos voluntarios | `run_tests.sh` sección [1c], dos sesiones `psql` | PASS |
| Servicios del frontend | `frontend/src/services/__tests__/myVolunteer.test.ts` y `volunteers.test.ts`, Supabase simulado | 9/9 y 11/11 |

**No se ha probado:** Supabase real (gateway, tokens reales, PostgREST, el
`auth.users` real), ni que la REST API real aplique estas policies igual que el
Postgres local con el stub de `auth.uid()`.
