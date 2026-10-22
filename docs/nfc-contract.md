# Contrato NFC backend <-> frontend

## Transporte
POST {EXPO_PUBLIC_SUPABASE_URL}/functions/v1/<nombre>
Headers: Authorization: Bearer <access_token del usuario>, apikey: <anon key>, Content-Type: application/json

## UID
Hex en MAYÚSCULAS, sin separadores. Longitudes válidas: 8, 14 o 20 caracteres (4, 7 o 10 bytes).
El cliente normaliza antes de enviar; el servidor vuelve a normalizar y rechaza lo inválido. 

## Funciones
1) check-in (roles: guard, admin)
   Request:  { event_id: uuid v4, uid: string, terminal_id: string (<=64), client_ts: ISO-8601 }
   Response: { code, message?, points_awarded?: number, volunteer?: { id, full_name, points, total_visits } }
   Códigos: ok | duplicate_event | daily_limit | card_unknown | card_inactive | volunteer_inactive | stale_event | invalid_ts
2) enroll-volunteer (rol: admin)
   Request:  { full_name: string, community: string, uid: string }
   Response: { code, message?, volunteer?: { id, full_name, community } }
   Códigos: ok | card_in_use
3) issue-card (rol: admin)
   Request:  { volunteer_id: uuid, uid: string }
   Response: { code, message?, card_id?: uuid, revoked_previous?: boolean }
   Códigos: ok | card_in_use | volunteer_not_found
   (volunteer_not_found responde 200 desde la migración 008; antes un voluntario inexistente daba 500.)
4) update-volunteer (rol: admin) — SQL: update_volunteer (supabase/003_volunteer_management.sql)
   Request:  { volunteer_id: uuid, full_name?: string (1-120), community?: string (1-120) }
             Al menos uno de full_name / community. Omitido = no cambiar; null es inválido.
             Cualquier otro campo (points, is_active, uid...) se ignora.
   Response: { code, message?, changed_fields?: ('full_name'|'community')[],
               volunteer?: { id, full_name, community, is_active } }
   Códigos: ok | volunteer_not_found
   changed_fields vacío = los valores ya eran esos (no se escribe ni se audita).
5) deactivate-volunteer (rol: admin) — SQL: deactivate_volunteer (supabase/003_volunteer_management.sql)
   Request:  { volunteer_id: uuid }
   Response: { code, message?, already_inactive?: boolean, volunteer?: { id, full_name, is_active: false } }
   Códigos: ok | volunteer_not_found
   Idempotente. No revoca la tarjeta: el check-in de un voluntario inactivo responde volunteer_inactive.
   No hay reactivación todavía.

Recompensas (supabase/004_rewards_management.sql). Las 3 son solo admin. Todas devuelven
reward = { id, name, description (string|null), points_cost, stock, is_active, created_at }.
points_cost y stock: enteros JSON (no texto, no decimales) entre 0 y 2147483647.
name: 1-120 caracteres tras recortar. description: hasta 500; vacía o null = sin descripción.
6) create-reward
   Request:  { name: string, description?: string|null, points_cost: integer, stock: integer }
   Response: { code: "ok", reward }   (se crea activa)
7) update-reward
   Request:  { reward_id: uuid, name?, description?: string|null, points_cost?, stock? }
             Al menos un campo. Omitido = no cambiar; description null o "" = borrarla.
   Response: { code, message?, changed_fields?: ('name'|'description'|'points_cost'|'stock')[], reward? }
   Códigos: ok | reward_not_found
8) deactivate-reward
   Request:  { reward_id: uuid }
   Response: { code, message?, already_inactive?: boolean, reward? }
   Códigos: ok | reward_not_found
   is_active = false; nunca se borra la fila, así que reward_redemptions conserva su historial.
   Idempotente. No hay reactivación todavía. update-reward funciona también sobre inactivas.
Cualquier otro campo del cuerpo (is_active, id, operator_id...) se ignora.

Cuentas de voluntario (supabase/005_volunteer_accounts.sql).
9) link-volunteer-account (rol: admin)
   Request:  { volunteer_id: uuid, user_id: uuid }   user_id = auth.users.id de una cuenta que YA existe
             y YA tiene profiles.role = 'volunteer'. No crea cuentas, no asigna roles, no busca por email/nombre.
   Response: { code, message?, already_linked?: boolean, volunteer?: { id, full_name, user_id } }
   Códigos: ok | volunteer_not_found | account_not_found | account_not_volunteer
            | volunteer_already_linked (el voluntario ya tiene OTRA cuenta; no se sobrescribe)
            | account_in_use (la cuenta ya está en otro voluntario)
   Repetir el mismo vínculo responde ok con already_linked = true. Vínculo y auditoría van en la misma transacción.

Lecturas del rol volunteer (RLS, sin Edge Function; el cliente consulta con su sesión):
- volunteers: solo su fila (user_id = auth.uid()).
- check_ins y reward_redemptions: solo las de su voluntario.
- rewards: las activas, más las que él canjeó aunque hoy estén inactivas.
- Nada de cards, audit_logs, point_tiers ni datos de otros voluntarios.
Una cuenta volunteer sin vincular solo ve el catálogo activo.

Canjes y notificaciones (supabase/006_redemptions.sql).
10) redeem-rewards (rol: volunteer; la identidad sale del JWT)
   Request:  { client_request_id: uuid v4, reward_ids: uuid[] }   1 a 20 ids distintos, 1 unidad de cada uno.
             El cliente genera client_request_id al confirmar y lo REUSA en los reintentos.
             volunteer_id, saldo y costos NO se aceptan: se ignoran si vienen.
   Response ok: { code: "ok", replayed: boolean, balance: integer,
                  request: { id, client_request_id, status: "pending_delivery"|"delivered", total_points,
                             created_at, delivered_at, items: [{ reward_id, name, points_spent }] } }
   Códigos: ok | insufficient_points { required, available } | reward_unavailable { rewards: [{ reward_id,
            reason: not_found|inactive|out_of_stock }] } | idempotency_conflict | volunteer_not_linked
            | volunteer_inactive
   Todo o nada en una transacción: se descuentan puntos y stock, se guarda la solicitud (pending_delivery)
   con el costo histórico de cada renglón y se crea la notificación para admins. Un rechazo no cambia nada.
   Mismo client_request_id y mismas recompensas -> ok con replayed = true, sin volver a cobrar ni notificar.
   Mismo client_request_id con otras recompensas -> idempotency_conflict.
11) mark-redemption-delivered (rol: admin)
   Request:  { request_id: uuid }   (redemption_requests.id)
   Response: { code, message?, already_delivered?: boolean, request? }   Códigos: ok | request_not_found
   No toca puntos ni stock. Repetirlo responde ok con already_delivered = true.
12) mark-notifications-read (rol: admin; el estado de leído es del admin de la sesión)
   Request:  { notification_ids: uuid[] (1 a 100) }  o  { all: true }   (uno de los dos)
   Response: { code: "ok", marked: integer, unread: integer }   Los ids que no existen se ignoran.

Lecturas (RLS):
- redemption_requests: el voluntario lee solo las suyas; el admin todas. reward_redemptions.request_id liga
  cada renglón con su solicitud (null = canje previo a 006, sin estado de entrega conocido).
- admin_notifications_feed (vista): solo admins; read_at es el del admin que consulta (null = no leída).
- Voluntarios y guards no ven notificaciones.

Alta con cuenta de acceso (supabase/007_volunteer_registration.sql). enroll-volunteer (función 2) no cambia.
13) register-volunteer-account (rol: admin)
   Request:  { client_request_id: uuid v4, full_name: string (1-120), community: string (1-120), uid: string,
               email: string (<=254; se recorta y pasa a minúsculas), password: string (>= 8 caracteres, <= 72 bytes) }
             El rol lo asigna el servidor ('volunteer'); cualquier campo role/user_id del cuerpo se ignora.
             Supabase Auth puede exigir una política más estricta: si la rechaza -> weak_password.
             Reintentos: mismo client_request_id (y mismos datos salvo la contraseña).
   Response ok: { code: "ok", replayed: boolean, registration_id, volunteer: { id, full_name, community, user_id },
                  account: { user_id, email }, card_id }
   Códigos: ok | email_in_use (la cuenta existente no se modifica ni se vincula) | card_in_use | weak_password
            | invalid_email | account_conflict | idempotency_conflict | registration_not_pending
            Los conflictos que ocurren después de crear la cuenta traen account_cleanup: "done" (la cuenta se borró)
            o "pending" (no se pudo borrar; reintentar con el mismo client_request_id vuelve a intentarlo).
   HTTP 500 server_error = la operación quedó a medias de forma recuperable: reintentar con el mismo client_request_id.
   La cuenta se crea con el email ya confirmado. La contraseña no se guarda en tablas, auditoría ni logs.

Foto de perfil (supabase/009_volunteer_avatars.sql).
14) set-volunteer-avatar (rol: admin)
   Antes: el admin sube la imagen con su sesión al bucket público "volunteer-avatars" en la ruta
          "<volunteer_id>/<nombre>.<ext>" (jpeg/png/webp, máx. 2 MB). Solo admins pueden escribir en el bucket.
   Request:  { volunteer_id: uuid, path: "<volunteer_id>/<nombre>.(jpg|jpeg|png|webp)" }   nombre: [A-Za-z0-9_-]{1,64}
   Response: { code, message?, volunteer?: { id, avatar_url } }
   Códigos: ok | volunteer_not_found | avatar_not_found (el archivo no está en el bucket)
   volunteers.avatar_url guarda la ruta, no la URL; el cliente arma la URL pública. Valores que empiezan con
   http(s) (datos viejos o seed) se usan tal cual.

Canje por el admin y entrega por canje (supabase/010_admin_redemptions.sql).
Cada renglón de reward_redemptions es un canje con su propio estado (status: pending_delivery | delivered;
null = histórico previo a 006). Entregar un canje no toca los demás; la solicitud (redemption_requests.status)
pasa a delivered cuando ya no le queda ninguno pendiente. Canjear la misma recompensa dos veces = dos canjes.
redemption_requests.channel: volunteer_app | admin | admin_card. Los items de "request" (funciones 10, 11,
15 y 16) traen además id, status y delivered_at.
15) admin-redeem-rewards (rol: admin)
   Request:  { volunteer_id: uuid, client_request_id: uuid v4, reward_ids: uuid[] }   mismas reglas que la función 10.
   Response: igual que la función 10. Códigos: ok | volunteer_not_found | volunteer_inactive | idempotency_conflict
             | reward_unavailable | insufficient_points
16) redeem-rewards-card (rol: admin)
   Request:  { uid: string, client_request_id: uuid v4, reward_ids: uuid[] }   el voluntario sale de la tarjeta;
             un volunteer_id en el cuerpo se ignora.
   Response: igual que la función 10. Códigos: los de la 15 (salvo volunteer_not_found) | card_unknown | card_inactive
17) lookup-card (rol: admin; solo lectura)
   Request:  { uid: string }
   Response: { code, message?, volunteer?: { id, full_name, community, points, avatar_url } }
   Códigos: ok | card_unknown | card_inactive | volunteer_inactive (trae volunteer: { id, full_name })
   Flujo de canje con tarjeta: lookup-card para mostrar dueño y saldo -> el admin confirma ->
   redeem-rewards-card con el MISMO uid (el servidor vuelve a resolver al voluntario).
18) mark-redemption-item-delivered (rol: admin)
   Request:  { redemption_id: uuid }   (reward_redemptions.id)
   Response: { code, message?, already_delivered?: boolean, request_status?: "pending_delivery"|"delivered"|null,
               redemption?: { id, request_id, volunteer_id, reward_id, name, points_spent, redeemed_at, status, delivered_at } }
   Códigos: ok | redemption_not_found. Idempotente. No toca puntos ni stock.
mark-redemption-delivered (función 11) ahora también entrega todos los canjes pendientes de la solicitud.

Cambio de contraseña (opcional, sin Edge Function): el usuario con sesión usa supabase.auth.updateUser({ password })
tras verificar su contraseña actual. Nunca recibe un id de usuario.

## HTTP
200 para todos los códigos de negocio (incluidos los de error de negocio).
400 { code: "invalid_request", message } | 401 { code: "unauthorized" } | 403 { code: "forbidden" }
403 { code: "origin_not_allowed" }: petición de navegador cuyo Origin no está en CORS_ALLOWED_ORIGINS
(no se ejecuta nada). Las peticiones sin Origin (app nativa, curl) no cambian.
CORS (todas las funciones): OPTIONS -> 204 con Access-Control-Allow-Methods "POST, OPTIONS" y
Access-Control-Allow-Headers "authorization, apikey, content-type, x-client-info", sin autenticar ni ejecutar
lógica. Toda respuesta a un Origin permitido (200, 400, 401, 403, 500) lleva Access-Control-Allow-Origin y Vary: Origin.
El cliente trata "ok" y "duplicate_event" como éxito (duplicate_event devuelve el resultado original).

## Roles y lecturas
Tabla profiles(id = auth.uid(), role in 'admin' | 'guard' | 'volunteer').
Policy obligatoria: cada usuario autenticado puede leer SU propia fila de profiles.
Una cuenta volunteer se liga a su registro con volunteers.user_id (ver función 9).
Con sesión admin, el dashboard sigue leyendo volunteers con el mismo select de hoy, sin nfc_uid.
Cuentas de desarrollo: admin@bamx.test y guard@bamx.test (las crea el responsable a mano en Supabase Auth).

## Reglas de negocio (valores por defecto)
Máx. 1 check-in por voluntario por día calendario (America/Mexico_City). Eventos con más de 48 h de antigüedad
-> stale_event; más de 5 min en el futuro -> invalid_ts. Los puntos los calcula siempre el servidor.

## Lectura NFC (interfaz que consume el frontend)
Módulo: frontend/src/lib/nfc/ (dueño: Paul; el resto del frontend solo lo importa)
- getNfcReader(): NfcReader  (devuelve el lector simulado si EXPO_PUBLIC_NFC_MOCK=1, si no el real)
- interface NfcReader { readUid(): Promise<string>; cancel(): void }
- readUid() devuelve el UID ya normalizado (hex en mayúsculas, sin separadores) o lanza NfcError.
- class NfcError extends Error { code: 'nfc_disabled' | 'cancelled' | 'timeout' | 'unsupported_tag' | 'unavailable' }
- MockNfcReader: setNextUid(uid: string) fija el UID de la siguiente lectura (por defecto devuelve un UID fijo de prueba).
