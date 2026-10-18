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

`operator_id` siempre es el id del usuario autenticado, nunca un valor del body.
HTTP: 401 `unauthorized`, 403 `forbidden`, 400 `invalid_request`, 200 para todo
codigo de negocio, 500 `server_error` (generico) ante errores inesperados.

## Variables de entorno

| Variable                     | Origen |
|------------------------------|--------|
| `CARD_UID_HMAC_SECRET`       | **La defines tu** con `supabase secrets set`. Debe ser el MISMO valor que `app.card_hmac_secret` al correr `002_nfc_security.sql`; si difieren, ninguna tarjeta migrada coincidira. Nunca va en el codigo. Las funciones de voluntarios (update/deactivate) y de recompensas no la usan. |
| `SUPABASE_URL`               | La inyecta Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY`  | La inyecta Supabase. |

`uid_hmac = hex(HMAC-SHA256(clave = CARD_UID_HMAC_SECRET, mensaje = UID normalizado en MAYUSCULAS))`,
identico a `encode(extensions.hmac(upper(uid), secreto, 'sha256'), 'hex')` de SQL.

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
(migracion 005), `docs/deploy-005-volunteer-accounts.md`.

Por defecto Supabase exige un JWT valido en el gateway (`verify_jwt`); ademas
cada funcion lo revalida con `auth.getUser` y comprueba el rol. Antes de
desplegar, la migracion `002_nfc_security.sql` debe estar aplicada en el proyecto.
