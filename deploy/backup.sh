#!/bin/sh
# Nightly Postgres dump with simple retention. Runs inside the `backup` service.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"

while true; do
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  FILE="/backups/booking-${STAMP}.sql.gz"
  if pg_dump -h db -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "${FILE}.partial"; then
    mv "${FILE}.partial" "$FILE"
    echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"
    find /backups -name 'booking-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
  else
    rm -f "${FILE}.partial"
    echo "BACKUP FAILED at ${STAMP}" >&2
  fi
  sleep "$((INTERVAL_HOURS * 3600))"
done
