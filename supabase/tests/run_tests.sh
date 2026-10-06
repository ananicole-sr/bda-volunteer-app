#!/usr/bin/env bash
# ============================================================================
# Corre las pruebas de supabase/002_nfc_security.sql contra un Postgres
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
  -f "$SCRIPT_DIR/10_test_cases.sql"
MAIN_STATUS=$?

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
echo "== [3/3] Resultado =="
if [ "$MAIN_STATUS" -eq 0 ] && [ "$GUARD_STATUS" -eq 0 ]; then
  echo "TODO PASS"
  exit 0
else
  echo "HAY FALLAS (ver arriba). main_status=$MAIN_STATUS guard_status=$GUARD_STATUS"
  exit 1
fi
