# Despliegue: canje de recompensas y notificaciones para admins (migración 006)

Para quien tiene acceso al proyecto de Supabase. Nada de esto se ha
ejecutado contra el proyecto real: todo lo de abajo está **pendiente**.

## Qué se despliega

| Pieza | Archivo |
|---|---|
| Tablas `redemption_requests`, `admin_notifications`, `admin_notification_reads`; columna `reward_redemptions.request_id` | `supabase/006_redemptions.sql` |
| Vista `admin_notifications_feed` (`security_invoker`) | ídem |
| Funciones `redeem_rewards`, `mark_redemption_delivered`, `mark_admin_notifications_read` | ídem |
| Edge Functions `redeem-rewards`, `mark-redemption-delivered`, `mark-notifications-read` | `supabase/functions/<nombre>/index.ts` |

Contrato: `docs/nfc-contract.md`, funciones 10 a 12.

## Antes de empezar

- Deben estar aplicadas la `002` y la **`005`**: la 006 usa `volunteers.user_id`,
  `is_volunteer()` y `my_volunteer_id()`. La 003 y la 004 no son necesarias,
  aunque sin la 004 no hay forma de crear recompensas desde la app.
- **Postgres 15 o mayor** (por `security_invoker` en la vista). Compruébalo con `select version();`.
- Haz un respaldo o anota cuántos canjes hay:
  `select count(*) from reward_redemptions;`. La migración no los modifica:
  quedan con `request_id = null`, sin estado de entrega.

## Pasos

1. **Migración.** Pega y corre `supabase/006_redemptions.sql` completo en el SQL
   editor. No necesita `app.card_hmac_secret` y se puede volver a correr.
   ```sql
   -- Verificación
   select count(*) from reward_redemptions where request_id is null;      -- = los canjes previos
   select count(*) from redemption_requests;                              -- 0
   select p.proname,
          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,  -- false
          has_function_privilege('service_role', p.oid, 'execute')  as service_role    -- true
     from pg_proc p
    where p.proname in ('redeem_rewards', 'mark_redemption_delivered', 'mark_admin_notifications_read');
   select has_table_privilege('authenticated', 'redemption_requests', 'insert'),       -- false
          has_table_privilege('authenticated', 'admin_notifications_feed', 'select'),  -- true
          has_table_privilege('anon', 'admin_notifications_feed', 'select');           -- false
   ```

2. **Edge Functions.** No necesitan secretos nuevos. Deja `verify_jwt` activado.
   ```bash
   supabase functions deploy redeem-rewards            --project-ref <ref>
   supabase functions deploy mark-redemption-delivered --project-ref <ref>
   supabase functions deploy mark-notifications-read   --project-ref <ref>
   ```
   En `_shared/` solo se agregó código, así que volver a desplegar las demás funciones es opcional.

## Pruebas de humo después de desplegar

Necesitas tres cuentas, con su `access_token` cada una:
- un voluntario **de prueba** ya vinculado (005);
- un admin;
- un guard.

No pegues los tokens en el repo ni en chats.

```bash
URL=https://<ref>.supabase.co/functions/v1
H=(-H "apikey: $ANON_KEY" -H "Content-Type: application/json")
CRID=$(python3 -c 'import uuid; print(uuid.uuid4())')

# a) Sin escritura: admin y guard no pueden canjear -> 403
curl -s -X POST "$URL/redeem-rewards" "${H[@]}" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "{\"client_request_id\":\"$CRID\",\"reward_ids\":[\"<reward_id>\"]}"

# b) Sin escritura: ids duplicados -> 400 invalid_request
curl -s -X POST "$URL/redeem-rewards" "${H[@]}" -H "Authorization: Bearer $VOLUNTEER_TOKEN" \
  -d "{\"client_request_id\":\"$CRID\",\"reward_ids\":[\"<id>\",\"<id>\"]}"

# c) Canje real con una recompensa DE PRUEBA de costo bajo -> ok, replayed false
curl -s -X POST "$URL/redeem-rewards" "${H[@]}" -H "Authorization: Bearer $VOLUNTEER_TOKEN" \
  -d "{\"client_request_id\":\"$CRID\",\"reward_ids\":[\"<reward_id de prueba>\"]}"
# d) Repetir EXACTAMENTE la misma llamada -> ok, replayed true, mismo request.id, mismo balance
```

Después:
- En la REST API con el token del admin: `GET /rest/v1/admin_notifications_feed?select=id,message,read_at`
  debe traer la notificación con `read_at: null`. Con el token del voluntario o del guard debe traer `[]`.
- `POST $URL/mark-notifications-read` con `{"all":true}` y el token del admin responde `unread: 0`.
  Con un **segundo** admin, la misma notificación debe seguir con `read_at: null`.
- `POST $URL/mark-redemption-delivered` con `{"request_id":"<request.id>"}`: primero
  `already_delivered: false`, luego `true`. Los puntos del voluntario no cambian.

## Si algo sale mal

- **PGRST202 en los logs:** `notify pgrst, 'reload schema';`.
- **Revertir.** Solo es posible si nadie ha canjeado todavía. Si ya hay solicitudes,
  revertir borra el registro de lo que se cobró.
  ```sql
  drop function if exists redeem_rewards(uuid, uuid, uuid[]);
  drop function if exists mark_redemption_delivered(uuid, uuid);
  drop function if exists mark_admin_notifications_read(uuid, uuid[]);
  drop function if exists redemption_request_json(uuid);
  drop function if exists redemption_max_items();
  drop view if exists admin_notifications_feed;
  drop table if exists admin_notification_reads;
  drop table if exists admin_notifications;
  alter table reward_redemptions drop constraint if exists reward_redemptions_request_reward_key;
  alter table reward_redemptions drop column if exists request_id;
  drop table if exists redemption_requests;
  ```

## Qué se probó y dónde (solo local)

| Prueba | Cómo | Resultado |
|---|---|---|
| Reglas de canje, rollback, idempotencia, entrega, RLS, estado de leído por admin | Postgres 16 local (`supabase/tests/50_redemptions_cases.sql`) | 45/45 |
| Concurrencia: saldo, última unidad de stock, mismo `request_id` | `run_tests.sh` [1d], dos sesiones `psql` | 3 PASS |
| Historial previo a la 006 | `run_tests.sh` [2c] | PASS |
| Auth, roles y validación de las 3 funciones | Deno con dependencias simuladas | 54/54 en total (7 de estas funciones) |
| Servicios del frontend | jest con Supabase simulado (`redemptions`, `adminNotifications`, `myVolunteer`) | 8 + 5 + 11 |

**No se ha probado:** Supabase real (gateway, tokens, PostgREST convirtiendo el
arreglo JSON a `uuid[]`, la vista con `security_invoker` en el Postgres real).
