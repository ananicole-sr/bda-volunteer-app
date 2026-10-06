-- Separado de 00_fixtures.sql para que run_tests.sh pueda correr la base de
-- pruebas del backfill SIN este archivo (esa base aparte si debe quedarse
-- sin el secreto, para comprobar que 002_nfc_security.sql aborta).
set app.card_hmac_secret = 'test-only-secret-do-not-use-in-prod';
