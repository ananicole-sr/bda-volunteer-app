# Despliegue: editar y desactivar voluntarios (migración 003)

Para quien tiene acceso al proyecto de Supabase. Nada de esto se ha
ejecutado contra el proyecto real: todo lo de abajo está **pendiente**.

## Qué se despliega

| Pieza | Archivo |
|---|---|
| Funciones SQL `update_volunteer` y `deactivate_volunteer` | `supabase/003_volunteer_management.sql` |
| Edge Function `update-volunteer` | `supabase/functions/update-volunteer/index.ts` |
| Edge Function `deactivate-volunteer` | `supabase/functions/deactivate-volunteer/index.ts` |
| Código compartido (cambió `handler.ts`, `specs.ts`, `validate.ts`) | `supabase/functions/_shared/` |

Contrato de request/response: `docs/nfc-contract.md`, funciones 4 y 5.

## Antes de empezar

1. `002_nfc_security.sql` ya debe estar aplicada. Compruébalo en el SQL editor:
   ```sql
   select proname from pg_proc where proname in ('enroll_volunteer', 'is_admin');  -- 2 filas
   ```
2. Debe existir al menos un usuario con `profiles.role = 'admin'` y otro con
   `role = 'guard'` (ver `supabase/dev_profiles.sql.example`), para probar.

## Pasos

1. **Migración.** Pega y corre `supabase/003_volunteer_management.sql` completo
   en el SQL editor. A diferencia de la 002, **no** necesita
   `app.card_hmac_secret` ni cambia tablas o policies. Se puede volver a correr.
   ```sql
   -- Verificación: 2 filas, y authenticated/anon NO deben poder ejecutarlas
   select p.proname,
          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
          has_function_privilege('anon', p.oid, 'execute')          as anon,
          has_function_privilege('service_role', p.oid, 'execute')  as service_role
   from pg_proc p
   where p.proname in ('update_volunteer', 'deactivate_volunteer');
   -- Esperado: authenticated = false, anon = false, service_role = true
   ```

2. **Edge Functions.** Despliega las dos nuevas **y vuelve a desplegar las tres
   existentes**, porque comparten `_shared/handler.ts`, que cambió (el HMAC ahora
   solo se calcula si el cuerpo trae `uid`; para check-in/enroll/issue-card el
   comportamiento es el mismo, ver pruebas).
   ```bash
   supabase functions deploy update-volunteer     --project-ref <ref>
   supabase functions deploy deactivate-volunteer --project-ref <ref>
   supabase functions deploy check-in             --project-ref <ref>
   supabase functions deploy enroll-volunteer     --project-ref <ref>
   supabase functions deploy issue-card           --project-ref <ref>
   ```
   No hacen falta secretos nuevos. Deja `verify_jwt` activado (el default).

## Pruebas de humo después de desplegar

Obtén un `access_token` iniciando sesión con cada cuenta (por ejemplo desde la
app, o con `POST /auth/v1/token?grant_type=password`). No los pegues en el
repo ni en chats.

```bash
URL=https://<ref>.supabase.co/functions/v1
H=(-H "apikey: $ANON_KEY" -H "Content-Type: application/json")

# a) Sin escritura: guard -> 403 forbidden
curl -s -X POST "$URL/update-volunteer" "${H[@]}" -H "Authorization: Bearer $GUARD_TOKEN" \
  -d '{"volunteer_id":"00000000-0000-4000-8000-000000000000","full_name":"x"}'

# b) Sin escritura de datos: admin con cuerpo inválido -> 400 invalid_request
curl -s -X POST "$URL/update-volunteer" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"volunteer_id":"00000000-0000-4000-8000-000000000000"}'

# c) admin, id inexistente -> 200 volunteer_not_found (deja 1 fila en audit_logs)
curl -s -X POST "$URL/deactivate-volunteer" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"volunteer_id":"00000000-0000-4000-8000-000000000000"}'
```

Si a), b) y c) dan lo esperado, la cadena gateway → JWT → rol → validación → RPC
funciona. Para probar la escritura real, usa un voluntario **de prueba** (no uno
real), por ejemplo creado con `enroll-volunteer`:

```bash
# d) editar -> {"code":"ok","changed_fields":["community"],...}
curl -s -X POST "$URL/update-volunteer" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"volunteer_id":"<id de prueba>","community":"Prueba"}'

# e) desactivar dos veces -> already_inactive false y luego true
curl -s -X POST "$URL/deactivate-volunteer" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"volunteer_id":"<id de prueba>"}'
```

Y en el SQL editor:

```sql
select event_type, volunteer_id, detail, created_at
from audit_logs
where event_type in ('volunteer_updated', 'volunteer_deactivated',
                     'update_volunteer_not_found', 'deactivate_volunteer_not_found')
order by created_at desc limit 10;
```

Comprueba también que `check-in`, `enroll-volunteer` e `issue-card` siguen
respondiendo igual que antes, porque se volvieron a desplegar.

## Si algo sale mal

- **500 `server_error`:** revisa los logs de la función (Dashboard → Edge
  Functions → Logs). Si dice `rpc update_volunteer fallo (code=PGRST202)`,
  PostgREST no ve la función: corre `notify pgrst, 'reload schema';` en el SQL
  editor y reintenta.
- **Revertir la migración:**
  `drop function update_volunteer(uuid, text, text, uuid); drop function deactivate_volunteer(uuid, uuid);`
  y borra las dos funciones desde el Dashboard. Los voluntarios ya desactivados
  quedan con `is_active = false`; para reactivar uno hoy (no hay función para
  eso todavía): `update volunteers set is_active = true where id = '<id>';`.

## Qué se probó y dónde (solo local)

| Prueba | Cómo | Resultado |
|---|---|---|
| Auth, rol, validación y argumentos RPC de las 5 Edge Functions | Deno + dependencias simuladas (`supabase/functions/_shared/shared_test.ts`) | 29/29 |
| Funciones SQL 002 + 003, permisos y RLS | Postgres 16 local (`supabase/tests/run_tests.sh`) | 40/40 + 16/16 + 4 extra |
| Servicios del frontend (`updateVolunteer`, `deactivateVolunteer`) | `frontend/src/services/__tests__/volunteers.test.ts` con `invoke` simulado | 8/8 |

**No se ha probado:** el gateway de Supabase, `auth.getUser` con tokens reales,
PostgREST real, la tabla `profiles` real, ni la app llamando a las funciones
desplegadas.

## Problema conocido (no corregido en este cambio)

`issue_card` (002) con un `volunteer_id` que no existe intenta guardar ese id en
`audit_logs.volunteer_id`, que tiene llave foránea hacia `volunteers`. Eso
lanza un error y la función responde 500 `server_error` en vez de
`volunteer_not_found`. Se reprodujo en el Postgres local. Las funciones
nuevas de la 003 guardan el id en `detail` para evitar ese problema.
