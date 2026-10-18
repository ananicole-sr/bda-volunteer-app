# Edge Functions (Fase 2)

Implementan el contrato de `docs/nfc-contract.md`. Cada funcion valida el JWT,
lee el rol en `profiles`, valida el cuerpo, calcula el HMAC del UID (solo las
que reciben `uid`) y llama a la funcion SQL con `service_role`.

| Funcion                | Roles         | Funcion SQL            | Migracion |
|------------------------|---------------|------------------------|-----------|
| `check-in`             | guard, admin  | `register_check_in`    | 002       |
| `enroll-volunteer`     | admin         | `enroll_volunteer`     | 002       |
| `issue-card`           | admin         | `issue_card`           | 002       |
| `update-volunteer`     | admin         | `update_volunteer`     | 003       |
| `deactivate-volunteer` | admin         | `deactivate_volunteer` | 003       |
| `create-reward`        | admin         | `create_reward`        | 004       |
| `update-reward`        | admin         | `update_reward`        | 004       |
| `deactivate-reward`    | admin         | `deactivate_reward`    | 004       |
| `link-volunteer-account` | admin       | `link_volunteer_account` | 005     |
| `redeem-rewards`       | volunteer     | `redeem_rewards`       | 006       |
| `mark-redemption-delivered` | admin    | `mark_redemption_delivered` | 006  |
| `mark-notifications-read` | admin      | `mark_admin_notifications_read` | 006 |
| `register-volunteer-account` | admin   | `begin_` / `complete_` / `fail_volunteer_registration` + `auth.admin.createUser` | 007 |

`register-volunteer-account` no usa `createHandler`: orquesta SQL + Supabase
Auth en `_shared/registration.ts` (reusa `authorize()` para JWT y rol).

`operator_id` siempre es el id del usuario autenticado, nunca un valor del body.
HTTP: 401 `unauthorized`, 403 `forbidden`, 400 `invalid_request`, 200 para todo
codigo de negocio, 500 `server_error` (generico) ante errores inesperados.

## Variables de entorno

| Variable                     | Origen |
|------------------------------|--------|
| `CARD_UID_HMAC_SECRET`       | **La defines tu** con `supabase secrets set`. Debe ser el MISMO valor que `app.card_hmac_secret` al correr `002_nfc_security.sql`; si difieren, ninguna tarjeta migrada coincidira. Nunca va en el codigo. Las funciones de voluntarios (update/deactivate) y de recompensas no la usan. |
| `CORS_ALLOWED_ORIGINS`       | **La defines tu**. Orígenes de navegador permitidos (Expo web), separados por coma, exactos: `scheme://host[:puerto]`, sin ruta ni `/` final. Ej.: `http://localhost:8081,https://<dominio-de-produccion>`. Sin la variable no se permite ningun navegador; la app nativa no la necesita. Ver "CORS" abajo. |
| `SUPABASE_URL`               | La inyecta Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY`  | La inyecta Supabase. |

`uid_hmac = hex(HMAC-SHA256(clave = CARD_UID_HMAC_SECRET, mensaje = UID normalizado en MAYUSCULAS))`,
identico a `encode(extensions.hmac(upper(uid), secreto, 'sha256'), 'hex')` de SQL.

## CORS (Expo web)

Todas las funciones pasan por `_shared/cors.ts` (`withCors`, aplicado dentro de
`createHandler` y `createRegistrationHandler`):

- `OPTIONS` se responde antes de autenticar, sin llamar a Auth, RPC ni `createUser`:
  `204` si el `Origin` esta permitido, `403 origin_not_allowed` si no.
- `POST` desde un `Origin` permitido sigue el flujo normal (JWT, rol, validacion)
  y toda respuesta (200/400/401/403/500) lleva `Access-Control-Allow-Origin` y `Vary: Origin`.
- `POST` desde un `Origin` no permitido -> `403 origin_not_allowed`, sin ejecutar nada.
- Sin `Origin` (app nativa, curl) -> igual que antes, sin headers CORS.
- Headers permitidos: `authorization, apikey, content-type, x-client-info`
  (los que manda supabase-js). Si el frontend agrega otro, va en
  `CORS_ALLOWED_HEADERS` de `cors.ts`.

Configurar (ejemplo con desarrollo local de Expo web + produccion):

```bash
supabase secrets set CORS_ALLOWED_ORIGINS='http://localhost:8081,https://<dominio-de-produccion>' --project-ref <ref>
```

`npx expo start --web` usa `http://localhost:8081` por defecto; si usas otro
puerto o abres por IP (`http://192.168.x.x:8081`), agregalo tal cual. Cambiar el
secreto no requiere redesplegar, pero las instancias ya calientes pueden tardar
en tomarlo; redesplegar lo fuerza. **No** desactives `verify_jwt` para "arreglar" CORS.

## Pruebas (sin tocar el proyecto real)

```bash
deno test --no-lock supabase/functions/          # requiere Deno 2.x (winget install DenoLand.Deno)
PGPORT=5433 bash supabase/tests/run_tests.sh      # SQL, incluye el vector de HMAC compartido
```

## Despliegue (NO ejecutado desde esta rama; hazlo tu cuando corresponda)

```bash
supabase secrets set CARD_UID_HMAC_SECRET='<el mismo valor que app.card_hmac_secret>' --project-ref <ref>

supabase functions deploy check-in --project-ref <ref>
supabase functions deploy enroll-volunteer --project-ref <ref>
supabase functions deploy issue-card --project-ref <ref>
```

Para `update-volunteer` y `deactivate-volunteer` (migracion 003) seguir
`docs/deploy-003-volunteer-management.md`. Para `create-reward`,
`update-reward` y `deactivate-reward` (migracion 004),
`docs/deploy-004-rewards-management.md`. Para `link-volunteer-account`
(migracion 005), `docs/deploy-005-volunteer-accounts.md`. Para canjes y
notificaciones (migracion 006), `docs/deploy-006-redemptions.md`. Para el
alta con cuenta (migracion 007), `docs/deploy-007-volunteer-registration.md`.
Para CORS y la correccion de `issue_card` (migracion 008),
`docs/deploy-008-cors-issue-card.md`.

Por defecto Supabase exige un JWT valido en el gateway (`verify_jwt`); ademas
cada funcion lo revalida con `auth.getUser` y comprueba el rol. Antes de
desplegar, la migracion `002_nfc_security.sql` debe estar aplicada en el proyecto.
