# Pruebas de las migraciones 002 a 010

`run_tests.sh` aplica 002 a 008 y 010 (009 usa el schema `storage` de
Supabase y no se aplica aqui) y corre `10_test_cases.sql` (002),
`20_volunteer_management_cases.sql` (003), `30_rewards_management_cases.sql`
(004), `40_volunteer_accounts_cases.sql` (005), `50_redemptions_cases.sql`
(006), `60_volunteer_registration_cases.sql` (007), `70_issue_card_cases.sql`
(008) y `80_admin_redemptions_cases.sql` (010). Como 010 redefine
`redeem_rewards`, las pruebas de 006 corren contra esa version (regresion).
Cada archivo imprime su
propia tabla y resumen. Secciones extra: [1c] misma cuenta vinculada en
paralelo; [1d] canjes en paralelo (saldo, ultima unidad de stock, mismo
request_id); [1e] dos altas con la misma tarjeta en paralelo; [2c] aplicar
006 sobre canjes previos no los marca como pendientes; [2d] issue_card con un
voluntario inexistente falla sin 008 y responde volunteer_not_found con 008.

El stub de `auth.users` (00_fixtures.sql) tiene `raw_app_meta_data`, como en
Supabase; las pruebas de 007 simulan `auth.admin.createUser` insertando ahi.

Ojo: si `10_test_cases.sql` falla, psql se detiene ahi (ON_ERROR_STOP) y los
archivos siguientes no corren.

En Linux con PostgreSQL 16 instalado (sin tocar el servicio del sistema), un
cluster desechable equivalente al de abajo:

```bash
B=/usr/lib/postgresql/16/bin
$B/initdb -D /tmp/pgdata-bamx -U postgres -A trust -E UTF8 --locale=C
$B/pg_ctl -D /tmp/pgdata-bamx -o "-p 5433 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l /tmp/pg-bamx.log start
PGPORT=5433 bash supabase/tests/run_tests.sh
$B/pg_ctl -D /tmp/pgdata-bamx stop
```

Corren contra un Postgres **local**, nunca contra el proyecto de Supabase real.

## Cómo se levantó el Postgres local (Windows, para esta sesión)

No había Postgres ni Docker instalados. Se instaló PostgreSQL 17 con:

```powershell
winget install --id PostgreSQL.PostgreSQL.17 --source winget --silent `
  --accept-package-agreements --accept-source-agreements --disable-interactivity
```

Eso instala el servicio de Windows `postgresql-x64-17` en el puerto 5432 (con
auth `scram-sha-256` y una contraseña que el instalador no expone en texto
plano). Para no tocar esa instalación/servicio de sistema, las pruebas usan
un **segundo clúster independiente**, creado con los mismos binarios pero
sin depender del servicio ni de su contraseña:

```bash
PGBIN="/c/Program Files/PostgreSQL/17/bin"
"$PGBIN/initdb.exe" -D /ruta/a/pgdata-nfc-test -U postgres -A trust -E UTF8 --locale=C
"$PGBIN/pg_ctl.exe" -D /ruta/a/pgdata-nfc-test -o "-p 5433" -l pg-nfc-test.log start
```

`-A trust` es intencional y **solo vale para este clúster de pruebas local**
(no accesible desde la red, puerto distinto al del servicio real): evita
tener que manejar contraseñas en los scripts de prueba. Para parar el
clúster: `"$PGBIN/pg_ctl.exe" -D /ruta/a/pgdata-nfc-test stop`.

## Cómo correr las pruebas

```bash
export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
export PGPORT=5433   # el clúster de pruebas de arriba; usa 5432 si ya tienes
                      # tu propio Postgres local con el usuario postgres
bash supabase/tests/run_tests.sh
```

Variables opcionales: `PSQL`, `PGHOST`, `PGPORT`, `PGUSER`, `TESTDB`,
`GUARDDB` (ver encabezado de `run_tests.sh`). El usuario debe poder crear
bases, extensiones (`pgcrypto`) y roles (`anon`, `authenticated`,
`service_role`) — en un Postgres local de desarrollo, el superusuario
`postgres` cumple esto.

El script:
1. Recrea `nfc_security_test`, corre el stub de `auth` + los roles de
   Supabase + los `ALTER DEFAULT PRIVILEGES` que imitan lo que Supabase ya
   trae de fábrica en todo proyecto nuevo (`00_fixtures.sql` — *antes* de
   crear ninguna tabla, para que apliquen a cada una que creen `schema.sql`
   y `002_nfc_security.sql`, y para que un `REVOKE` posterior de la
   migración no quede pisado por un `GRANT` genérico hecho después), fija
   un secreto de HMAC de prueba (`00b_set_test_secret.sql`), corre
   `schema.sql` + `002_nfc_security.sql`, y corre los casos de prueba
   (`10_test_cases.sql`), que imprime **PASS** o **FAIL** por caso y
   termina con un resumen.
2. En una base aparte (`nfc_security_test_backfill_guard`), corre solo
   `schema.sql` y luego intenta `002_nfc_security.sql` **sin** el secreto —
   confirma que el backfill aborta con el mensaje esperado.
3. Borra ambas bases de prueba al terminar (la principal la vuelve a crear
   cada corrida; no hace falta limpiarla a mano).

Salida esperada: `TODO PASS`. Si algo falla, el nombre del caso y el
`detail` de la fila en `FAIL` dicen qué comparación no se cumplió.

## Qué NO cubren estas pruebas

- Las Edge Functions (Fase 2) — estas pruebas son solo de las funciones SQL
  SECURITY DEFINER y de RLS.
- El HMAC real contra `CARD_UID_HMAC_SECRET` de Supabase — usan un secreto
  fijo de prueba (`00b_set_test_secret.sql`), no el del proyecto real.
- Que `seed.sql` corra limpio se verificó a mano por separado (no es parte
  de este runner, para que los casos de prueba no dependan de sus datos).
