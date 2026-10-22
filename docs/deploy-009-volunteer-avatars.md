# Despliegue: foto de perfil de voluntarios (migración 009)

Para quien tiene acceso al proyecto de Supabase. Nada de esto se ha
ejecutado contra el proyecto real: todo lo de abajo está **pendiente**.

## Qué se despliega

| Pieza | Archivo | Requiere |
|---|---|---|
| Bucket `volunteer-avatars` + policies + `set_volunteer_avatar` | `supabase/009_volunteer_avatars.sql` | 002 y 003 aplicadas |
| Edge Function `set-volunteer-avatar` | `supabase/functions/set-volunteer-avatar/` | migración 009 |
| `expo-image-picker` en la app | `frontend/package.json`, `frontend/app.json` | nuevo build nativo (dev client) |

## 1. Migración 009

En el SQL editor, pega y corre `supabase/009_volunteer_avatars.sql` completo.
Se puede volver a correr.

```sql
-- Verificación
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'volunteer-avatars';            -- public = true, 2097152
select policyname from pg_policies
 where schemaname = 'storage' and policyname like 'volunteer_avatars_%';   -- 3 filas
select has_function_privilege('authenticated', 'set_volunteer_avatar(uuid, text, uuid)', 'execute'),  -- false
       has_function_privilege('service_role',  'set_volunteer_avatar(uuid, text, uuid)', 'execute');  -- true
```

## 2. Edge Function

```bash
supabase functions deploy set-volunteer-avatar --project-ref <ref>
```

Usa los mismos secretos que las demás (incluido `CORS_ALLOWED_ORIGINS`); no
necesita `CARD_UID_HMAC_SECRET`.

## 3. App

`expo-image-picker` es un módulo nativo: hay que generar un nuevo build del
dev client (`npx expo run:android` / `run:ios` o EAS) antes de probarlo en el
teléfono. En web funciona sin rebuild.

## Notas

- El bucket es público: cualquiera con la URL puede ver la foto. Los nombres
  de archivo son UUID aleatorios, así que no se pueden adivinar, pero no es
  un bucket privado.
- Si la subida o el guardado fallan después del alta, el voluntario queda
  creado sin foto; la app lo avisa y deja ir al perfil.
