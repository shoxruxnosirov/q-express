#!/usr/bin/env bash
# A copy of the whole database once a night, run by q-express-backup.timer
# (by hand: sudo /usr/local/lib/q-express/backup.sh). The last 14 are kept in
# /var/backups/q-express, readable by root only. To bring one back:
#   sudo systemctl stop q-express
#   sudo -u postgres dropdb --force qexpress && sudo -u postgres createdb -O qexpress qexpress
#   sudo -u postgres pg_restore --no-owner --role=qexpress -d qexpress < /var/backups/q-express/<file>
#   sudo systemctl start q-express
set -euo pipefail
umask 077

DB_NAME=qexpress
BACKUP_DIR=/var/backups/q-express
KEEP=14

install -d -m 700 $BACKUP_DIR
file=$BACKUP_DIR/daily-$(date +%F-%H%M%S).dump
# Written under a temporary name, so a half-written file never counts as a copy.
runuser -u postgres -- pg_dump -Fc "$DB_NAME" > "$file.part"
mv "$file.part" "$file"
echo "saved $file ($(du -h "$file" | cut -f1))"
ls -1t $BACKUP_DIR/daily-*.dump | tail -n +$(( KEEP + 1 )) | xargs -r rm --
