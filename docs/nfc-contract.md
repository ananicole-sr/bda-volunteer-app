\# Contrato NFC backend <-> frontend



\## Transporte

POST {EXPO\_PUBLIC\_SUPABASE\_URL}/functions/v1/<nombre>

Headers: Authorization: Bearer <access\_token del usuario>, apikey: <anon key>, Content-Type: application/json



\## UID

Hex en MAYÚSCULAS, sin separadores. Longitudes válidas: 8, 14 o 20 caracteres (4, 7 o 10 bytes).

El cliente normaliza antes de enviar; el servidor vuelve a normalizar y rechaza lo inválido.



\## Funciones

1\) check-in (roles: guard, admin)

&#x20;  Request:  { event\_id: uuid v4, uid: string, terminal\_id: string (<=64), client\_ts: ISO-8601 }

&#x20;  Response: { code, message?, points\_awarded?: number, volunteer?: { id, full\_name, points, total\_visits } }

&#x20;  Códigos: ok | duplicate\_event | daily\_limit | card\_unknown | card\_inactive | volunteer\_inactive | stale\_event | invalid\_ts

2\) enroll-volunteer (rol: admin)

&#x20;  Request:  { full\_name: string, community: string, uid: string }

&#x20;  Response: { code, message?, volunteer?: { id, full\_name, community } }

&#x20;  Códigos: ok | card\_in\_use

3\) issue-card (rol: admin)

&#x20;  Request:  { volunteer\_id: uuid, uid: string }

&#x20;  Response: { code, message?, card\_id?: uuid, revoked\_previous?: boolean }

&#x20;  Códigos: ok | card\_in\_use | volunteer\_not\_found



\## HTTP

200 para todos los códigos de negocio (incluidos los de error de negocio).

400 { code: "invalid\_request", message } | 401 { code: "unauthorized" } | 403 { code: "forbidden" }

El cliente trata "ok" y "duplicate\_event" como éxito (duplicate\_event devuelve el resultado original).



\## Roles y lecturas

Tabla profiles(id = auth.uid(), role in 'admin' | 'guard' | 'volunteer').

Policy obligatoria: cada usuario autenticado puede leer SU propia fila de profiles.

Con sesión admin, el dashboard sigue leyendo volunteers con el mismo select de hoy, sin nfc\_uid.

Cuentas de desarrollo: admin@bamx.test y guard@bamx.test (las crea el responsable a mano en Supabase Auth).



\## Reglas de negocio (valores por defecto)

Máx. 1 check-in por voluntario por día calendario (America/Mexico\_City). Eventos con más de 48 h de antigüedad

\-> stale\_event; más de 5 min en el futuro -> invalid\_ts. Los puntos los calcula siempre el servidor.

## Lectura NFC (interfaz que consume el frontend)

Módulo: frontend/src/lib/nfc/ (dueño: Paul; Ana solo lo importa)

\- getNfcReader(): NfcReader  (devuelve el lector simulado si EXPO\_PUBLIC\_NFC\_MOCK=1, si no el real)

\- interface NfcReader { readUid(): Promise<string>; cancel(): void }

\- readUid() devuelve el UID ya normalizado (hex en mayúsculas, sin separadores) o lanza NfcError.

\- class NfcError extends Error { code: 'nfc\_disabled' | 'cancelled' | 'timeout' | 'unsupported\_tag' | 'unavailable' }

\- MockNfcReader: setNextUid(uid: string) fija el UID de la siguiente lectura (por defecto devuelve un UID fijo de prueba).

