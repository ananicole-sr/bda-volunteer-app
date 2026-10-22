# Despliegue: canje por el admin + entrega por canje (migración 010)

Para quien tiene acceso al proyecto de Supabase. Nada de esto se ha
ejecutado contra el proyecto real: todo lo de abajo está **pendiente**.

## Qué se despliega

| Pieza | Archivo | Requiere |
|---|---|---|
| Estado por canje, canal, canje por admin / con tarjeta, consulta de tarjeta, entrega por canje | `supabase/010_admin_redemptions.sql` | 002 y 006 aplicadas |
| Edge Functions `admin-redeem-rewards`, `redeem-rewards-card`, `lookup-card`, `mark-redemption-item-delivered` | `supabase/functions/<nombre>/` | migración 010 |

`redeem-rewards` y `mark-redemption-delivered` **no** se redesplegan: las
funciones SQL que llaman cambian por dentro pero conservan firma y respuesta.

## 1. Migración 010

En el SQL editor, pega y corre `supabase/010_admin_redemptions.sql` completo.
Se puede volver a correr. Copia el estado de cada solicitud a sus canjes
existentes (los históricos sin solicitud quedan con estado `null`).

```sql
-- Verificación
select count(*) from reward_redemptions rr join redemption_requests q on q.id = rr.request_id
 where rr.status is distinct from q.status;                                   -- 0
select distinct channel from redemption_requests;                             -- volunteer_app
select has_function_privilege('authenticated', 'admin_redeem_rewards(uuid, uuid, uuid[], uuid)', 'execute'),  -- false
       has_function_privilege('service_role',  'admin_redeem_rewards(uuid, uuid, uuid[], uuid)', 'execute');  -- true
```

## 2. Edge Functions

```bash
supabase functions deploy admin-redeem-rewards --project-ref <ref>
supabase functions deploy redeem-rewards-card --project-ref <ref>
supabase functions deploy lookup-card --project-ref <ref>
supabase functions deploy mark-redemption-item-delivered --project-ref <ref>
```

`redeem-rewards-card` y `lookup-card` usan `CARD_UID_HMAC_SECRET` (el mismo
que `check-in`); sin él responden 500.

## 3. Pruebas locales

```bash
PGPORT=5433 bash supabase/tests/run_tests.sh       # incluye 80_admin_redemptions_cases.sql
deno test --no-lock supabase/functions/
```
