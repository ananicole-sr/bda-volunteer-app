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

## HTTP
200 para todos los códigos de negocio (incluidos los de error de negocio).
400 { code: "invalid_request", message } | 401 { code: "unauthorized" } | 403 { code: "forbidden" }
El cliente trata "ok" y "duplicate_event" como éxito (duplicate_event devuelve el resultado original).

## Roles y lecturas
Tabla profiles(id = auth.uid(), role in 'admin' | 'guard' | 'volunteer').
Policy obligatoria: cada usuario autenticado puede leer SU propia fila de profiles.
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
