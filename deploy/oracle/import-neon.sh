#!/usr/bin/env bash
# Copies the whole Q express database from Neon into this server's own
# PostgreSQL, REPLACING what is here, then compares every table's row count.
# Run it in an SSH session, after setup.sh:
#
#   sudo bash deploy/oracle/import-neon.sh
#
# It asks for Neon's connection string (Render > q-express > Environment >
# DATABASE_URL, or Neon > Connect) without showing it, and keeps it nowhere.
# Piped in instead, it is read from the first line of its input.
#
# Run it once to try the site out here, and again at the move, after Render is
# suspended, so the last orders come too. Anything done on this server in
# between (test orders, a changed price) is replaced by Neon's data. The app
# here is stopped while it runs and started again after.
set -euo pipefail
umask 077

APP_USER=qexpress
DB_NAME=qexpress
BACKUP_DIR=/var/backups/q-express
KEEP=5

[[ $EUID -eq 0 ]] || { echo "Run it with sudo: sudo bash $0" >&2; exit 1; }
command -v pg_dump >/dev/null || { echo "PostgreSQL is not here yet: run setup.sh first." >&2; exit 1; }
if [[ -t 0 ]]; then
  read -rsp 'Neon connection string (postgresql://...): ' url
  echo
else
  read -r url || true
fi
# Copied with its quotes from a settings file, it still works.
url=${url#\"}
url=${url%\"}
# Taken apart so the password goes to pg_dump in its environment, not on its
# command line where any process could read it.
re='^postgres(ql)?://([^:@/]+):([^@/]+)@([^/:?]+)(:([0-9]+))?/([^?]+)'
[[ $url =~ $re ]] || { echo "That is not a postgresql://user:password@host/database string." >&2; exit 1; }
user=${BASH_REMATCH[2]}
export PGPASSWORD=${BASH_REMATCH[3]}
host=${BASH_REMATCH[4]}
port=${BASH_REMATCH[6]:-5432}
db=${BASH_REMATCH[7]}
unset url
[[ $PGPASSWORD != *%* ]] || { echo "The password has %-escapes; reset it in Neon to a plain one." >&2; exit 1; }
# pg_dump wants a direct connection, not Neon's pooler.
host=${host/-pooler./.}
export PGSSLMODE=verify-full PGSSLROOTCERT=system
neon=(-h "$host" -p "$port" -U "$user" -d "$db")
as_pg() { runuser -u postgres -- env -u PGPASSWORD -u PGSSLMODE -u PGSSLROOTCERT "$@"; }

echo "== Neon"
remote=$(psql "${neon[@]}" -XtAc 'SHOW server_version_num')
local_major=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
echo "    PostgreSQL $(( remote / 10000 )) on Neon, $local_major here"
(( remote / 10000 <= local_major )) || { echo "pg_dump here is older than Neon's server; nothing changed." >&2; exit 1; }

install -d -m 700 $BACKUP_DIR
file=$BACKUP_DIR/neon-$(date +%F-%H%M%S).dump
echo "== Copying from Neon"
pg_dump "${neon[@]}" -Fc --no-owner --no-privileges -f "$file.part"
mv "$file.part" "$file"
echo "    $file ($(du -h "$file" | cut -f1))"

was_running=false
if systemctl is-active --quiet q-express; then
  was_running=true
  echo "== Stopping the app here"
  systemctl stop q-express
fi
# What was here goes to a file first, in case it is wanted after all.
if [[ $(as_pg psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'") == 1 ]]; then
  as_pg pg_dump -Fc "$DB_NAME" > $BACKUP_DIR/before-import-$(date +%F-%H%M%S).dump
fi

echo "== Loading it here"
as_pg dropdb --if-exists --force "$DB_NAME"
as_pg createdb -O $APP_USER "$DB_NAME"
as_pg pg_restore --no-owner --no-privileges --role=$APP_USER --exit-on-error -d "$DB_NAME" < "$file"
as_pg psql -XqAc 'ANALYZE' "$DB_NAME"

echo "== Rows per table (Neon / here)"
tables_sql="SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) FROM pg_tables
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1"
count_sql() { sed 's/^\(.*\)$/SELECT '"'"'\1'"'"', count(*) FROM \1;/'; }
there=$(psql "${neon[@]}" -XtAc "$tables_sql" | count_sql | psql "${neon[@]}" -XtA -F' ')
here=$(as_pg psql -XtAc "$tables_sql" "$DB_NAME" | count_sql | as_pg psql -XtA -F' ' "$DB_NAME")
unset PGPASSWORD
differ=0
while read -r name n; do
  m=$(awk -v t="$name" '$1 == t { print $2 }' <<<"$here")
  if [[ $n == "$m" ]]; then mark=ok; else mark=DIFFERENT; differ=1; fi
  printf '    %-40s %8s %8s  %s\n' "$name" "$n" "${m:-missing}" "$mark"
done <<<"$there"

ls -1t $BACKUP_DIR/neon-*.dump | tail -n +$(( KEEP + 1 )) | xargs -r rm --
if $was_running; then
  echo "== Starting the app here"
  systemctl start q-express
fi
if (( differ )); then
  cat >&2 <<EOF

Some counts differ. While Render still runs, that can be new activity on Neon
since the copy (an order, a chat message); after Render is suspended they must
all match, so run this again then.
EOF
  exit 1
fi
echo
echo "Every table matches Neon."
