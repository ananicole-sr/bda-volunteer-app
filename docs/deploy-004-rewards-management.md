# Despliegue: CRUD de recompensas (migración 004)

Para quien tiene acceso al proyecto de Supabase. Nada de esto se ha
ejecutado contra el proyecto real: todo lo de abajo está **pendiente**.

## Qué se despliega

| Pieza | Archivo |
|---|---|
| Funciones SQL `create_reward`, `update_reward` y `deactivate_reward` | `supabase/004_rewards_management.sql` |
| Edge Functions `create-reward`, `update-reward` y `deactivate-reward` | `supabase/functions/<nombre>/index.ts` |
| Validación y especificaciones compartidas | `supabase/functions/_shared/validate.ts`, `specs.ts` |

Contrato de request/response: `docs/nfc-contract.md`, funciones 6, 7 y 8.

## Antes de empezar

- `002_nfc_security.sql` debe estar aplicada. La 004 **no** depende de la 003.
  ```sql
  select proname from pg_proc where proname in ('is_admin', 'is_staff');  -- 2 filas
  ```
- Debe existir un usuario con `profiles.role = 'admin'` y otro con `'guard'` para las pruebas.

## Pasos

1. **Migración.** Pega y corre `supabase/004_rewards_management.sql` completo en
   el SQL editor. No necesita `app.card_hmac_secret`, no cambia tablas ni
   policies y se puede volver a correr.
   ```sql
   select p.proname,
          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
          has_function_privilege('anon', p.oid, 'execute')          as anon,
          has_function_privilege('service_role', p.oid, 'execute')  as service_role
   from pg_proc p
   where p.proname in ('create_reward', 'update_reward', 'deactivate_reward');
   -- Esperado: 3 filas con authenticated = false, anon = false, service_role = true
   ```

2. **Edge Functions.** No hacen falta secretos nuevos. Deja `verify_jwt` activado.
   ```bash
   supabase functions deploy create-reward     --project-ref <ref>
   supabase functions deploy update-reward     --project-ref <ref>
   supabase functions deploy deactivate-reward --project-ref <ref>
   ```
   `_shared/validate.ts` cambió de forma interna (helper `uuidField`), sin cambiar
   el comportamiento de las demás funciones. Volver a desplegarlas es opcional.
   Si la 003 todavía no se despliega, sigue también
   `docs/deploy-003-volunteer-management.md`.

## Pruebas de humo después de desplegar

Obtén los `access_token` iniciando sesión con cada cuenta. No los pegues en el
repo ni en chats.

```bash
URL=https://<ref>.supabase.co/functions/v1
H=(-H "apikey: $ANON_KEY" -H "Content-Type: application/json")

# a) Sin escritura: guard -> 403 {"code":"forbidden"}
curl -s -X POST "$URL/create-reward" "${H[@]}" -H "Authorization: Bearer $GUARD_TOKEN" \
  -d '{"name":"x","points_cost":1,"stock":1}'

# b) Sin escritura: admin con número inválido -> 400 invalid_request
curl -s -X POST "$URL/create-reward" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"x","points_cost":-1,"stock":1}'

# c) admin, id inexistente -> 200 {"code":"reward_not_found",...} (deja 1 fila en audit_logs)
curl -s -X POST "$URL/deactivate-reward" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"reward_id":"00000000-0000-4000-8000-000000000000"}'

# d) Escritura real con una recompensa DE PRUEBA:
curl -s -X POST "$URL/create-reward" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"PRUEBA - borrar","description":"smoke test","points_cost":1,"stock":0}'
# -> {"code":"ok","reward":{"id":"<id>",...,"is_active":true}}
curl -s -X POST "$URL/update-reward" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"reward_id":"<id>","stock":5,"description":null}'
# -> changed_fields ["description","stock"]
curl -s -X POST "$URL/deactivate-reward" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"reward_id":"<id>"}'
# -> already_inactive false; repetirlo -> true
```

```sql
select event_type, detail, created_at from audit_logs
where event_type like '%reward%' order by created_at desc limit 10;
```

La recompensa de prueba queda inactiva. `getRewards()` del frontend filtra
`is_active = true`, así que ya no aparece en la lista.

## Si algo sale mal

- **500 `server_error`:** revisa los logs de la función. Si dice
  `rpc create_reward fallo (code=PGRST202)`, corre `notify pgrst, 'reload schema';`
  y reintenta.
- **Revertir:**
  ```sql
  drop function create_reward(text, text, integer, integer, uuid);
  drop function update_reward(uuid, text, text, boolean, integer, integer, uuid);
  drop function deactivate_reward(uuid, uuid);
  drop function reward_check_text(text, text);
  drop function reward_json(rewards);
  ```
  y borra las 3 funciones del Dashboard. Para reactivar una recompensa (todavía
  no hay función para eso): `update rewards set is_active = true where id = '<id>';`.

## Qué se probó y dónde (solo local)

| Prueba | Cómo | Resultado |
|---|---|---|
| Auth, rol, validación y argumentos RPC | Deno con dependencias simuladas (`supabase/functions/_shared/shared_test.ts`) | 41/41 en total (12 de recompensas) |
| Funciones SQL, permisos, RLS, historial de canjes, lecturas | Postgres 16 local (`supabase/tests/run_tests.sh`) | 40 + 16 + 27/27 + 4 extra |
| Servicios del frontend | `frontend/src/services/__tests__/rewards.test.ts` con `invoke` simulado | 7/7 |

**No se ha probado:** el gateway de Supabase, `auth.getUser` con tokens reales,
PostgREST real, la tabla `profiles` real, ni la app llamando a las funciones.
