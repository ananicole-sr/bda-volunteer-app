# Despliegue: CORS en las Edge Functions + corrección de `issue_card` (migración 008)

Para quien tiene acceso al proyecto de Supabase. Nada de esto se ha
ejecutado contra el proyecto real: todo lo de abajo está **pendiente**.

## Qué se despliega

| Pieza | Archivo | Requiere |
|---|---|---|
| `issue_card` corregida (volunteer inexistente → `volunteer_not_found`) | `supabase/008_fix_issue_card.sql` | 002 aplicada |
| CORS en las 13 Edge Functions | `supabase/functions/_shared/cors.ts` (lo usan `handler.ts` y `registration.ts`) | redesplegar todas |
| Secreto `CORS_ALLOWED_ORIGINS` | — | definirlo |

## 1. Migración 008

En el SQL editor, pega y corre `supabase/008_fix_issue_card.sql` completo.
Solo reemplaza la función `issue_card`: misma firma, mismos códigos y mismo
reemplazo de tarjeta. Se puede volver a correr y no necesita `app.card_hmac_secret`.

```sql
-- Verificación: debe mostrar el insert nuevo (detail con volunteer_id)
select prosrc like '%jsonb_build_object(''volunteer_id'', p_volunteer_id, ''operator_id''%' as corregida
  from pg_proc where proname = 'issue_card';                                                   -- true
select has_function_privilege('authenticated', 'issue_card(uuid, text, uuid)', 'execute'),      -- false
       has_function_privilege('service_role',  'issue_card(uuid, text, uuid)', 'execute');      -- true
```

Prueba sin efectos: `volunteer_not_found` solo escribe una fila en `audit_logs`.
```sql
begin;
set local role service_role;
select issue_card('00000000-0000-4000-8000-0000000000ff', repeat('a', 64), null);
-- {"code": "volunteer_not_found", "message": "El voluntario no existe"}
rollback;
```

## 2. Orígenes permitidos (CORS)

```bash
supabase secrets set CORS_ALLOWED_ORIGINS='http://localhost:8081,https://<dominio-de-produccion>' --project-ref <ref>
```

- La lista va separada por comas y cada entrada es un origen exacto:
  `scheme://host[:puerto]`, sin ruta ni `/` final. No se admite `*`.
- **Desarrollo:** `http://localhost:8081` es el puerto por defecto de `npx expo start --web`.
  Si abres desde otra máquina, agrega `http://<IP>:8081`.
- **Producción:** el dominio donde se publique la versión web.
- Si no defines la variable, ningún navegador puede llamar las funciones. La app
  nativa sigue funcionando, porque no manda `Origin`.

## 3. Redesplegar las 13 funciones

Todas comparten `_shared/`, que cambió. `verify_jwt` se queda **activado**.

```bash
for f in check-in enroll-volunteer issue-card update-volunteer deactivate-volunteer \
         create-reward update-reward deactivate-reward link-volunteer-account \
         redeem-rewards mark-redemption-delivered mark-notifications-read register-volunteer-account; do
  supabase functions deploy "$f" --project-ref <ref>
done
```

## 4. Pruebas de humo

```bash
URL=https://<ref>.supabase.co/functions/v1

# a) Preflight desde un origen permitido -> 204 con Access-Control-Allow-*
curl -s -i -X OPTIONS "$URL/check-in" \
  -H "Origin: http://localhost:8081" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, apikey, content-type, x-client-info"

# b) Preflight desde otro origen -> 403 {"code":"origin_not_allowed"}, sin Access-Control-Allow-Origin
curl -s -i -X OPTIONS "$URL/check-in" -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST"

# c) POST real desde origen permitido, con token de guard, a una función de admin
#    -> 403 forbidden CON Access-Control-Allow-Origin
curl -s -i -X POST "$URL/create-reward" -H "Origin: http://localhost:8081" -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $GUARD_TOKEN" -H "Content-Type: application/json" -d '{}'

# d) issue-card con un voluntario inexistente (admin) -> 200 {"code":"volunteer_not_found",...}
curl -s -X POST "$URL/issue-card" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"volunteer_id":"00000000-0000-4000-8000-0000000000ff","uid":"04A1B2C3"}'
```

Por último, prueba desde Expo web (`npx expo start --web`), por ejemplo el
login y el dashboard de admin.

## Qué falta verificar con el Supabase real

1. **Que el gateway deje pasar el preflight con `verify_jwt` activado.** El
   navegador manda `OPTIONS` **sin** `Authorization`. Si el gateway lo rechaza
   con 401 antes de llegar a la función, la prueba (a) devolverá 401 sin
   headers CORS. En ese caso no desactives `verify_jwt` en todas las
   funciones: revisa la documentación vigente de Supabase y repórtalo.
2. **Respuestas que genera el gateway, no la función:** un 401 por JWT
   inválido o vencido, el 404 de una función inexistente, el 502 por error
   de arranque, los 504 por tiempo de espera y los límites de tasa. No pasan
   por `withCors`, así que en el navegador se ven como "error de CORS" y no
   como su código real. Desde la app nativa se ven normal.
3. **Que supabase-js en web no mande otro header** además de los cuatro
   permitidos. Si el preflight de (a) desde el navegador pide uno más, hay que
   agregarlo a `CORS_ALLOWED_HEADERS` en `cors.ts`.
4. **Que las instancias calientes tomen el secreto nuevo** sin redesplegar. Lo
   más seguro es redesplegar después de cambiarlo, como en los pasos 2 y 3.

## Revertir

- **CORS:** quitar el secreto (`supabase secrets unset CORS_ALLOWED_ORIGINS`)
  bloquea a los navegadores sin afectar la app nativa. Para quitar el código,
  redespliega la versión anterior de las funciones.
- **008:** volver a correr solo la definición de `issue_card` de la 002
  reintroduce el error de llave foránea. No hay motivo para hacerlo.

## Qué se probó y dónde (solo local)

| Prueba | Cómo | Resultado |
|---|---|---|
| CORS: orígenes permitidos y no permitidos, OPTIONS sin llamadas, headers en 200/400/401/403/500, rol exigido, app nativa sin cambios | Deno con dependencias simuladas (`_shared/cors_test.ts`) | 11/11 |
| Preflight y POST por HTTP real | `Deno.serve` local + `curl` | 204 / 403 / 401 con headers / 401 nativo |
| Regresión de todas las Edge Functions | `deno test supabase/functions/` | 84/84 |
| `issue_card`: no encontrado, primera tarjeta, reemplazo, `card_in_use`, permisos | Postgres 16 local (`70_issue_card_cases.sql`) | 7/7 |
| Sin 008 falla con FK; con 008 responde `volunteer_not_found` | `run_tests.sh` [2d] | PASS |
| Regresión SQL completa | `run_tests.sh` | todas las suites PASS |
