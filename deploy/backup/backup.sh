#!/bin/sh
# Runs inside the `backup` container. Every day at BACKUP_HOUR_UTC it writes
# /backups/dualyne-YYYY-MM-DD.dump (pg_dump custom format) and deletes dumps older
# than BACKUP_RETENTION_DAYS days. Run once immediately with: backup.sh --now
set -eu
RETENTION="${BACKUP_RETENTION_DAYS:-7}"
HOUR="${BACKUP_HOUR_UTC:-3}"

dump() {
  day="$(date -u +%F)"
  tmp="/backups/.dualyne-$day.dump.tmp"
  out="/backups/dualyne-$day.dump"
  echo "[backup] $(date -u +%FT%TZ) dumping to $out"
  if pg_dump --format=custom --no-owner --file="$tmp"; then
    mv "$tmp" "$out"
    # Keep the newest $RETENTION dumps.
    # shellcheck disable=SC2012 # our own file names, no spaces
    ls -1t /backups/dualyne-*.dump 2>/dev/null | tail -n +"$((RETENTION + 1))" | xargs -r rm -f
    echo "[backup] done: $(du -h "$out" | cut -f1)"
  else
    rm -f "$tmp"
    echo "[backup] FAILED" >&2
  fi
}

if [ "${1:-}" = "--now" ]; then
  dump
  exit 0
fi

while true; do
  now=$(date -u +%s)
  target=$(date -u -d "$(date -u +%F) ${HOUR}:00:00" +%s 2>/dev/null || echo 0)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  dump
done
