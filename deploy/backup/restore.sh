#!/bin/sh
# Restore a backup INTO THE RUNNING DATABASE. This replaces current data.
#   ./deploy/backup/restore.sh /var/backups/dualyne/dualyne-2026-09-23.dump
set -eu
file="${1:?usage: restore.sh <dump file>}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
cd "$(dirname "$0")/../.."
echo "This will overwrite the current database with $file."
printf "Type RESTORE to continue: "
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
docker compose -f docker-compose.prod.yml stop api web
docker compose -f docker-compose.prod.yml exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$file"
docker compose -f docker-compose.prod.yml start api web
echo "Restored."
