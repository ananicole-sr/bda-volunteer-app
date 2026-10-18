#!/usr/bin/env bash
# ============================================================================
# Corre las pruebas de supabase/002_nfc_security.sql,
# supabase/003_volunteer_management.sql, supabase/004_rewards_management.sql,
# supabase/005_volunteer_accounts.sql, supabase/006_redemptions.sql y
# supabase/007_volunteer_registration.sql contra un Postgres
# local (no contra el proyecto de Supabase real).
#
# Variables de entorno opcionales:
#   PSQL      ruta al binario psql (default: "psql", busca en PATH)
#   PGHOST    default 127.0.0.1
#   PGPORT    default 5432
#   PGUSER    default postgres (debe poder crear bases, roles y extensiones)
#   TESTDB    nombre de la base de pruebas principal (se borra y recrea)
#   GUARDDB   nombre de la base aparte para el caso del backfill sin secreto
#
# Ver supabase/tests/README.md para como se levanto el Postgres local usado
# al desarrollar esto.
# ============================================================================
set -uo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER
PSQL="${PSQL:-psql}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TESTDB="${TESTDB:-nfc_security_test}"
GUARDDB="${GUARDDB:-nfc_security_test_backfill_guard}"

fail_setup() {
  echo "ERROR preparando el entorno de pruebas: $1" >&2
  exit 2
}

prepare_db() {
  local db="$1"
  "$PSQL" -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists \"$db\";" \
    || fail_setup "no se pudo dropear $db"
  "$PSQL" -d postgres -v ON_ERROR_STOP=1 -c "create database \"$db\";" \
    || fail_setup "no se pudo crear $db"
  "$PSQL" -d "$db" -v ON_ERROR_STOP=1 -c \
    "create schema if not exists extensions; create extension if not exists pgcrypto schema extensions; alter database \"$db\" set search_path to public, extensions;" \
    || fail_setup "no se pudo preparar pgcrypto/search_path en $db"
}

echo "== [1/3] Base principal: $TESTDB =="
prepare_db "$TESTDB"

"$PSQL" -d "$TESTDB" -v ON_ERROR_STOP=1 \
  -f "$SCRIPT_DIR/00_fixtures.sql" \
  -f "$SCRIPT_DIR/00b_set_test_secret.sql" \
  -f "$SUPABASE_DIR/schema.sql" \
  -f "$SUPABASE_DIR/002_nfc_security.sql" \
  -f "$SUPABASE_DIR/003_volunteer_management.sql" \
  -f "$SUPABASE_DIR/004_rewards_management.sql" \
  -f "$SUPABASE_DIR/005_volunteer_accounts.sql" \
  -f "$SUPABASE_DIR/006_redemptions.sql" \
  -f "$SUPABASE_DIR/007_volunteer_registration.sql" \
  -f "$SCRIPT_DIR/10_test_cases.sql" \
  -f "$SCRIPT_DIR/20_volunteer_management_cases.sql" \
  -f "$SCRIPT_DIR/30_rewards_management_cases.sql" \
  -f "$SCRIPT_DIR/40_volunteer_accounts_cases.sql" \
  -f "$SCRIPT_DIR/50_redemptions_cases.sql" \
  -f "$SCRIPT_DIR/60_volunteer_registration_cases.sql"
MAIN_STATUS=$?

echo
echo "== [1b] Concurrencia: dos sesiones psql sobre el mismo voluntario =="
# Sesion A abre una transaccion, hace el check-in y se queda 3 s con el lock
# antes de COMMIT; la sesion B arranca 1 s despues (mientras A sigue abierta).
# Sin FOR UPDATE en register_check_in, B no veria el insert de A y ambos
# darian 'ok'.
CONC_SETUP="
  set app.card_hmac_secret = 'test-only-secret-do-not-use-in-prod';
  insert into volunteers (id, full_name, community) values
    ('c0000000-0000-0000-0000-000000000001','Conc daily','x'),
    ('c0000000-0000-0000-0000-000000000002','Conc event','x');
  insert into cards (volunteer_id, uid_hmac) values
    ('c0000000-0000-0000-0000-000000000001', encode(extensions.hmac('CC000001', current_setting('app.card_hmac_secret'), 'sha256'), 'hex')),
    ('c0000000-0000-0000-0000-000000000002', encode(extensions.hmac('CC000002', current_setting('app.card_hmac_secret'), 'sha256'), 'hex'));"
"$PSQL" -d "$TESTDB" -v ON_ERROR_STOP=1 -q -c "$CONC_SETUP" || fail_setup "setup de concurrencia"

conc_call() { # $1 event_id  $2 uid  $3 sleep-after (segundos)
  "$PSQL" -d "$TESTDB" -At -v ON_ERROR_STOP=1 2>&1 <<SQL | grep -vE '^$|^SET$|^BEGIN$|^COMMIT$|^[0-9]+$'
set app.card_hmac_secret = 'test-only-secret-do-not-use-in-prod';
select encode(extensions.hmac('$2', current_setting('app.card_hmac_secret'), 'sha256'), 'hex') as h \gset
begin;
set local role service_role;
select register_check_in('$1', :'h', 'term-conc', null, now())->>'code';
select pg_sleep($3);
commit;
SQL
}
conc_pair() { # $1 evA  $2 evB  $3 uid -> imprime "codigoA codigoB"
  local fa fb
  fa="$(mktemp)"; fb="$(mktemp)"
  conc_call "$1" "$3" 3 >"$fa" & local pa=$!
  sleep 1
  conc_call "$2" "$3" 0 >"$fb" & local pb=$!
  wait $pa $pb
  echo "$(tr '
' ',' <"$fa")|$(tr '
' ',' <"$fb")"
  rm -f "$fa" "$fb"
}

CONC_STATUS=0
R1="$(conc_pair 'c1000000-0000-0000-0000-00000000000a' 'c1000000-0000-0000-0000-00000000000b' 'CC000001')"
if [ "$R1" = "ok,|daily_limit," ]; then
  echo "PASS - 2 check-ins simultaneos (event_id distintos) -> exactamente un ok y un daily_limit"
else
  echo "FAIL - concurrencia daily_limit: $R1 (esperado 'ok,|daily_limit,')"; CONC_STATUS=1
fi
R2="$(conc_pair 'c2000000-0000-0000-0000-00000000000a' 'c2000000-0000-0000-0000-00000000000a' 'CC000002')"
if [ "$R2" = "ok,|duplicate_event," ]; then
  echo "PASS - mismo event_id en paralelo -> ok + duplicate_event, sin error"
else
  echo "FAIL - concurrencia mismo event_id: $R2 (esperado 'ok,|duplicate_event,')"; CONC_STATUS=1
fi

echo
echo "== [1c] Concurrencia (005): misma cuenta a dos voluntarios en paralelo =="
# Sesion A vincula la cuenta al voluntario 1 y espera 3 s antes de COMMIT; B
# intenta la misma cuenta con el voluntario 2 mientras A sigue abierta. B no
# ve el vinculo sin confirmar de A, asi que debe ser el UNIQUE(user_id) el que
# lo frene: esperado ok + account_in_use, sin error.
"$PSQL" -d "$TESTDB" -v ON_ERROR_STOP=1 -q -c "
  insert into auth.users (id, email) values ('c5000000-0000-0000-0000-0000000000aa', 'conc005@test.local');
  insert into profiles (id, role) values ('c5000000-0000-0000-0000-0000000000aa', 'volunteer');
  insert into volunteers (id, full_name, community) values
    ('c5000000-0000-0000-0000-000000000001', 'Conc link 1', 'x'),
    ('c5000000-0000-0000-0000-000000000002', 'Conc link 2', 'x');" || fail_setup "setup de concurrencia 005"

link_call() { # $1 volunteer_id  $2 sleep-after (segundos)
  "$PSQL" -d "$TESTDB" -At -v ON_ERROR_STOP=1 2>&1 <<SQL | grep -vE '^$|^SET$|^BEGIN$|^COMMIT$|^[0-9]+$'
begin;
set local role service_role;
select link_volunteer_account('$1', 'c5000000-0000-0000-0000-0000000000aa', null)->>'code';
select pg_sleep($2);
commit;
SQL
}
LA="$(mktemp)"; LB="$(mktemp)"
link_call 'c5000000-0000-0000-0000-000000000001' 3 >"$LA" & PA=$!
sleep 1
link_call 'c5000000-0000-0000-0000-000000000002' 0 >"$LB" & PB=$!
wait $PA $PB
R3="$(tr '\n' ',' <"$LA")|$(tr '\n' ',' <"$LB")"
rm -f "$LA" "$LB"
LINKED="$("$PSQL" -d "$TESTDB" -At -c "select count(*) from volunteers where user_id = 'c5000000-0000-0000-0000-0000000000aa'")"
if [ "$R3" = "ok,|account_in_use," ] && [ "$LINKED" = "1" ]; then
  echo "PASS - misma cuenta a 2 voluntarios en paralelo -> ok + account_in_use, 1 solo vinculo"
else
  echo "FAIL - concurrencia link: $R3 vinculos=$LINKED (esperado 'ok,|account_in_use,' y 1)"; CONC_STATUS=1
fi

echo
echo "== [1d] Concurrencia (006): canjes en paralelo =="
# Cada llamada abre una transaccion, canjea, espera N s y hace COMMIT. La
# segunda arranca 1 s despues, mientras la primera sigue con sus locks.
"$PSQL" -d "$TESTDB" -v ON_ERROR_STOP=1 -q -c "
  insert into auth.users (id, email) values
    ('c6100000-0000-0000-0000-00000000000d', 'conc006-d@test.local'),
    ('c6100000-0000-0000-0000-00000000000e', 'conc006-e@test.local'),
    ('c6100000-0000-0000-0000-00000000000f', 'conc006-f@test.local'),
    ('c6100000-0000-0000-0000-000000000010', 'conc006-g@test.local');
  insert into profiles (id, role) select id, 'volunteer' from auth.users where email like 'conc006-%';
  insert into volunteers (id, full_name, community, points, user_id) values
    ('c6200000-0000-0000-0000-00000000000d', 'Conc D', 'x', 300, 'c6100000-0000-0000-0000-00000000000d'),
    ('c6200000-0000-0000-0000-00000000000e', 'Conc E', 'x', 100, 'c6100000-0000-0000-0000-00000000000e'),
    ('c6200000-0000-0000-0000-00000000000f', 'Conc F', 'x', 100, 'c6100000-0000-0000-0000-00000000000f'),
    ('c6200000-0000-0000-0000-000000000010', 'Conc G', 'x', 100, 'c6100000-0000-0000-0000-000000000010');
  insert into rewards (id, name, points_cost, stock) values
    ('c6300000-0000-0000-0000-000000000200', 'Conc 200', 200, 10),
    ('c6300000-0000-0000-0000-000000000150', 'Conc 150', 150, 10),
    ('c6300000-0000-0000-0000-000000000001', 'Conc ultima unidad', 10, 1),
    ('c6300000-0000-0000-0000-000000000002', 'Conc reintento', 10, 10);" || fail_setup "setup de concurrencia 006"

redeem_call() { # $1 user_id  $2 client_request_id  $3 reward_ids (csv)  $4 sleep-after
  "$PSQL" -d "$TESTDB" -At -v ON_ERROR_STOP=1 2>&1 <<SQL | grep -vE '^$|^SET$|^BEGIN$|^COMMIT$|^[0-9]+$'
begin;
set local role service_role;
select r->>'code' || coalesce(':' || (r->>'replayed'), '')
  from redeem_rewards('$1', '$2', string_to_array('$3', ',')::uuid[]) as r;
select pg_sleep($4);
commit;
SQL
}
redeem_pair() { # $1..$3 llamada A  $4..$6 llamada B -> "codigoA|codigoB"
  local fa fb
  fa="$(mktemp)"; fb="$(mktemp)"
  redeem_call "$1" "$2" "$3" 3 >"$fa" & local pa=$!
  sleep 1
  redeem_call "$4" "$5" "$6" 0 >"$fb" & local pb=$!
  wait $pa $pb
  echo "$(tr '\n' ',' <"$fa")|$(tr '\n' ',' <"$fb")"
  rm -f "$fa" "$fb"
}
q() { "$PSQL" -d "$TESTDB" -At -c "$1"; }

# a) mismo voluntario (300 pts), dos solicitudes distintas de 200 y 150: no puede gastar 350
R4="$(redeem_pair c6100000-0000-0000-0000-00000000000d c6400000-0000-4000-8000-00000000000a c6300000-0000-0000-0000-000000000200 \
                  c6100000-0000-0000-0000-00000000000d c6400000-0000-4000-8000-00000000000b c6300000-0000-0000-0000-000000000150)"
P4="$(q "select points from volunteers where id = 'c6200000-0000-0000-0000-00000000000d'")"
if [ "$R4" = "ok:false,|insufficient_points," ] && [ "$P4" = "100" ]; then
  echo "PASS - 300 pts, 200 y 150 en paralelo -> ok + insufficient_points, saldo final 100 (nunca negativo)"
else
  echo "FAIL - concurrencia saldo: $R4 puntos=$P4 (esperado 'ok:false,|insufficient_points,' y 100)"; CONC_STATUS=1
fi

# b) dos voluntarios por la ultima unidad: no se sobrevende
R5="$(redeem_pair c6100000-0000-0000-0000-00000000000e c6400000-0000-4000-8000-00000000000c c6300000-0000-0000-0000-000000000001 \
                  c6100000-0000-0000-0000-00000000000f c6400000-0000-4000-8000-00000000000d c6300000-0000-0000-0000-000000000001)"
S5="$(q "select stock from rewards where id = 'c6300000-0000-0000-0000-000000000001'")"
N5="$(q "select count(*) from reward_redemptions where reward_id = 'c6300000-0000-0000-0000-000000000001'")"
PF="$(q "select points from volunteers where id = 'c6200000-0000-0000-0000-00000000000f'")"
if [ "$R5" = "ok:false,|reward_unavailable," ] && [ "$S5" = "0" ] && [ "$N5" = "1" ] && [ "$PF" = "100" ]; then
  echo "PASS - 2 voluntarios por la ultima unidad en paralelo -> ok + reward_unavailable, stock 0, 1 renglon, al perdedor no se le cobra"
else
  echo "FAIL - concurrencia stock: $R5 stock=$S5 renglones=$N5 puntos_F=$PF"; CONC_STATUS=1
fi

# c) mismo request_id dos veces en paralelo: un solo cobro, una sola notificacion
R6="$(redeem_pair c6100000-0000-0000-0000-000000000010 c6400000-0000-4000-8000-00000000000e c6300000-0000-0000-0000-000000000002 \
                  c6100000-0000-0000-0000-000000000010 c6400000-0000-4000-8000-00000000000e c6300000-0000-0000-0000-000000000002)"
P6="$(q "select points from volunteers where id = 'c6200000-0000-0000-0000-000000000010'")"
S6="$(q "select stock from rewards where id = 'c6300000-0000-0000-0000-000000000002'")"
N6="$(q "select count(*) from redemption_requests where volunteer_id = 'c6200000-0000-0000-0000-000000000010'")"
M6="$(q "select count(*) from admin_notifications where payload->>'volunteer_id' = 'c6200000-0000-0000-0000-000000000010'")"
if [ "$R6" = "ok:false,|ok:true," ] && [ "$P6" = "90" ] && [ "$S6" = "9" ] && [ "$N6" = "1" ] && [ "$M6" = "1" ]; then
  echo "PASS - mismo request_id en paralelo -> ok + ok replayed; 1 cobro, 1 de stock, 1 solicitud, 1 notificacion"
else
  echo "FAIL - concurrencia reintento: $R6 puntos=$P6 stock=$S6 solicitudes=$N6 notificaciones=$M6"; CONC_STATUS=1
fi

echo
echo "== [1e] Concurrencia (007): dos altas con la misma tarjeta en paralelo =="
# Dos solicitudes distintas (emails distintos, misma tarjeta) ya pasaron begin
# y tienen su cuenta creada; ambas llaman complete a la vez. Solo una puede
# quedarse la tarjeta: la otra debe responder card_in_use con cleanup.
REG_SETUP="$("$PSQL" -d "$TESTDB" -At -v ON_ERROR_STOP=1 <<'SQL' | grep -E '^[0-9a-f-]{36}$'
set app.card_hmac_secret = 'test-only-secret-do-not-use-in-prod';
select encode(extensions.hmac('CC0000E7', current_setting('app.card_hmac_secret'), 'sha256'), 'hex') as h \gset
set role service_role;
select begin_volunteer_registration('e7100000-0000-4000-8000-00000000000a', 'conc007-a@test.local', :'h', 'Conc A', 'x', null)->>'registration_id';
select begin_volunteer_registration('e7100000-0000-4000-8000-00000000000b', 'conc007-b@test.local', :'h', 'Conc B', 'x', null)->>'registration_id';
SQL
)"
REG_A="$(echo "$REG_SETUP" | sed -n 1p)"; REG_B="$(echo "$REG_SETUP" | sed -n 2p)"
"$PSQL" -d "$TESTDB" -v ON_ERROR_STOP=1 -q -c "
  insert into auth.users (id, email, raw_app_meta_data) values
    ('e7200000-0000-0000-0000-00000000000a', 'conc007-a@test.local', jsonb_build_object('bamx_registration_id', '$REG_A')),
    ('e7200000-0000-0000-0000-00000000000b', 'conc007-b@test.local', jsonb_build_object('bamx_registration_id', '$REG_B'));" \
  || fail_setup "setup de concurrencia 007"
complete_call() { # $1 registration_id  $2 auth_user_id  $3 sleep-after
  "$PSQL" -d "$TESTDB" -At -v ON_ERROR_STOP=1 2>&1 <<SQL | grep -vE '^$|^SET$|^BEGIN$|^COMMIT$|^[0-9]+$'
begin;
set local role service_role;
select complete_volunteer_registration('$1', '$2', null)->>'code';
select pg_sleep($3);
commit;
SQL
}
CA="$(mktemp)"; CB="$(mktemp)"
complete_call "$REG_A" e7200000-0000-0000-0000-00000000000a 3 >"$CA" & PA=$!
sleep 1
complete_call "$REG_B" e7200000-0000-0000-0000-00000000000b 0 >"$CB" & PB=$!
wait $PA $PB
R7="$(tr '\n' ',' <"$CA")|$(tr '\n' ',' <"$CB")"
rm -f "$CA" "$CB"
V7="$("$PSQL" -d "$TESTDB" -At -c "select count(*) from volunteers where user_id in ('e7200000-0000-0000-0000-00000000000a', 'e7200000-0000-0000-0000-00000000000b')")"
P7="$("$PSQL" -d "$TESTDB" -At -c "select count(*) from profiles where id = 'e7200000-0000-0000-0000-00000000000b'")"
if [ "$R7" = "ok,|card_in_use," ] && [ "$V7" = "1" ] && [ "$P7" = "0" ]; then
  echo "PASS - 2 altas con la misma tarjeta en paralelo -> ok + card_in_use; 1 voluntario, el perdedor sin profile"
else
  echo "FAIL - concurrencia alta: $R7 voluntarios=$V7 profile_perdedor=$P7 (esperado 'ok,|card_in_use,', 1, 0)"; CONC_STATUS=1
fi

echo
echo "== [2/3] Base aparte: el backfill debe abortar sin app.card_hmac_secret =="
prepare_db "$GUARDDB"
"$PSQL" -d "$GUARDDB" -v ON_ERROR_STOP=1 \
  -f "$SCRIPT_DIR/00_fixtures.sql" \
  -f "$SUPABASE_DIR/schema.sql" \
  || fail_setup "no se pudo preparar el esquema base en $GUARDDB"

GUARD_OUT="$(mktemp)"
# ON_ERROR_STOP=1 aqui es el punto: sin el, psql por default sigue
# corriendo el resto del script (y el resto SI pasa, dejando el DROP COLUMN
# y las funciones creadas) e igual sale con exit 0, aunque haya impreso el
# ERROR del RAISE EXCEPTION a la mitad (se detecto corriendo las pruebas).
if "$PSQL" -d "$GUARDDB" -v ON_ERROR_STOP=1 -f "$SUPABASE_DIR/002_nfc_security.sql" >"$GUARD_OUT" 2>&1; then
  echo "FAIL - 002_nfc_security.sql NO aborto sin app.card_hmac_secret"
  GUARD_STATUS=1
elif grep -q "app.card_hmac_secret no esta definido" "$GUARD_OUT"; then
  echo "PASS - 002_nfc_security.sql aborta sin app.card_hmac_secret"
  GUARD_STATUS=0
else
  echo "FAIL - 002_nfc_security.sql fallo, pero no por el motivo esperado:"
  cat "$GUARD_OUT"
  GUARD_STATUS=1
fi
rm -f "$GUARD_OUT"
"$PSQL" -d postgres -c "drop database if exists \"$GUARDDB\";" >/dev/null 2>&1

echo
echo "== [2b] Backfill: nfc_uid de longitud no admitida se omite con NOTICE =="
BFDB="${BFDB:-nfc_security_test_backfill_len}"
prepare_db "$BFDB"
"$PSQL" -d "$BFDB" -v ON_ERROR_STOP=1 -q   -f "$SCRIPT_DIR/00_fixtures.sql" -f "$SUPABASE_DIR/schema.sql"   || fail_setup "no se pudo preparar el esquema base en $BFDB"
"$PSQL" -d "$BFDB" -v ON_ERROR_STOP=1 -q -c "
  insert into volunteers (id, full_name, community, nfc_uid) values
   ('b0000000-0000-0000-0000-000000000008','Ocho','x','a1:b2-c3 d4'),
   ('b0000000-0000-0000-0000-000000000010','Diez','x','A1B2C3D4E5'),
   ('b0000000-0000-0000-0000-000000000014','Catorce','x','04A1B2C3D4E5F6');"
BF_OUT="$(mktemp)"
"$PSQL" -d "$BFDB" -v ON_ERROR_STOP=1   -f "$SCRIPT_DIR/00b_set_test_secret.sql" -f "$SUPABASE_DIR/002_nfc_security.sql" >"$BF_OUT" 2>&1
BF_RC=$?
BF_CARDS="$("$PSQL" -d "$BFDB" -At -c "select string_agg(volunteer_id::text, ',' order by volunteer_id) from cards")"
if [ "$BF_RC" -eq 0 ]    && grep -q "b0000000-0000-0000-0000-000000000010" "$BF_OUT" && grep -q "NOTICE:  backfill" "$BF_OUT"    && [ "$BF_CARDS" = "b0000000-0000-0000-0000-000000000008,b0000000-0000-0000-0000-000000000014" ]; then
  echo "PASS - backfill omite el UID de 10 hex (NOTICE con volunteer_id), no falla, y crea las de 8 y 14"
  BF_STATUS=0
else
  echo "FAIL - backfill con UID de longitud invalida (rc=$BF_RC cards=$BF_CARDS)"
  cat "$BF_OUT"
  BF_STATUS=1
fi
rm -f "$BF_OUT"
"$PSQL" -d postgres -c "drop database if exists \"$BFDB\";" >/dev/null 2>&1

echo
echo "== [2c] Historial previo a 006: los canjes existentes no se marcan pendientes =="
LGDB="${LGDB:-nfc_security_test_legacy_006}"
prepare_db "$LGDB"
"$PSQL" -d "$LGDB" -v ON_ERROR_STOP=1 -q -f "$SCRIPT_DIR/00_fixtures.sql" -f "$SCRIPT_DIR/00b_set_test_secret.sql" \
  -f "$SUPABASE_DIR/schema.sql" -f "$SUPABASE_DIR/002_nfc_security.sql" -f "$SUPABASE_DIR/005_volunteer_accounts.sql" \
  || fail_setup "no se pudo preparar el esquema previo a 006 en $LGDB"
"$PSQL" -d "$LGDB" -v ON_ERROR_STOP=1 -q -c "
  insert into volunteers (id, full_name, community) values ('e6000000-0000-0000-0000-000000000001', 'Legacy', 'x');
  insert into rewards (id, name, points_cost, stock) values ('e6000000-0000-0000-0000-0000000000a1', 'Legacy R', 50, 3);
  insert into reward_redemptions (id, volunteer_id, reward_id, points_spent, redeemed_at) values
    ('e6000000-0000-0000-0000-0000000000f1', 'e6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-0000000000a1', 50, '2026-01-15');" \
  || fail_setup "no se pudo insertar el historial previo en $LGDB"
"$PSQL" -d "$LGDB" -v ON_ERROR_STOP=1 -q -f "$SUPABASE_DIR/006_redemptions.sql" >/dev/null 2>&1
LG_RC=$?
LG="$("$PSQL" -d "$LGDB" -At -c "
  select (select count(*) from reward_redemptions where request_id is null and points_spent = 50 and redeemed_at = '2026-01-15')
      || ',' || (select count(*) from redemption_requests) || ',' || (select count(*) from admin_notifications)")"
if [ "$LG_RC" -eq 0 ] && [ "$LG" = "1,0,0" ]; then
  echo "PASS - 006 sobre historial existente: el canje previo queda intacto, sin solicitud ni estado pendiente ni notificacion"
  LG_STATUS=0
else
  echo "FAIL - historial previo a 006: rc=$LG_RC resultado=$LG (esperado 1,0,0)"
  LG_STATUS=1
fi
"$PSQL" -d postgres -c "drop database if exists \"$LGDB\";" >/dev/null 2>&1

echo
echo "== [3/3] Resultado =="
if [ "$MAIN_STATUS" -eq 0 ] && [ "$GUARD_STATUS" -eq 0 ] && [ "${BF_STATUS:-0}" -eq 0 ] && [ "${CONC_STATUS:-0}" -eq 0 ] && [ "${LG_STATUS:-0}" -eq 0 ]; then
  echo "TODO PASS"
  exit 0
else
  echo "HAY FALLAS (ver arriba). main_status=$MAIN_STATUS guard_status=$GUARD_STATUS bf_status=${BF_STATUS:-0} conc_status=${CONC_STATUS:-0} legacy_status=${LG_STATUS:-0}"
  exit 1
fi
