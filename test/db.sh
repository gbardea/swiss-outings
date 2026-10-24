#!/bin/sh
# Runs the database migrations + security/calendar test suites on a throwaway local Postgres 16.
# Usage: sh test/db.sh   (needs postgresql-16 binaries; run as root or a user that can su to postgres)
set -e
D=${PGTEST_DIR:-/var/tmp/sopg}; BIN=/usr/lib/postgresql/16/bin; PORT=55432
rm -rf "$D"; mkdir -p "$D"; chown postgres "$D" 2>/dev/null || true
su postgres -c "$BIN/initdb -D $D/data -A trust >/dev/null && $BIN/pg_ctl -D $D/data -o '-k $D -p $PORT -c listen_addresses=' -l $D/log start >/dev/null"
trap 'su postgres -c "$BIN/pg_ctl -D $D/data stop -m fast >/dev/null"' EXIT
sleep 2
P="psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database t" >/dev/null
for f in supabase/tests/local_stub.sql supabase/schema.sql supabase/tests/local_stub_live_extras.sql supabase/migrations/*.sql; do $P -d t -f "$f" >/dev/null 2>&1 || { echo "FAILED loading $f"; $P -d t -f "$f"; exit 1; }; done
fail=0
for t in supabase/tests/security_test.sql supabase/tests/calendar_test.sql; do
  out=$( { echo "begin;"; cat "$t"; echo "rollback;"; } | $P -d t -At -F'|' 2>&1 | grep '|[tf]|' )
  echo "$out" | awk -F'|' '{print ($2=="t"?"PASS ":"FAIL ")$1}'
  echo "$out" | grep -q '|f|' && fail=1
done
exit $fail
