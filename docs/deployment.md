# Deployment

One server running `docker-compose.prod.yml`: Postgres, the API, the dashboard (static), the storefront, Caddy (automatic HTTPS) and a nightly database backup.

## First deploy
1. Point three DNS A records (dashboard, booking pages, API) at the server. Open ports 80 and 443.
2. `cp deploy/.env.production.example deploy/.env.production` and fill it in. The API refuses to start with a missing or placeholder secret, a localhost URL, or `TEST_RESET_TOKEN` set.
3. `docker compose -f docker-compose.prod.yml --env-file deploy/.env.production up -d --build`
4. The API applies Alembic migrations on startup. Check `https://<API_DOMAIN>/api/v1/health/ready`.
5. Create the first business from the dashboard's "Create business" page using `PLATFORM_ADMIN_TOKEN` as the invite code.

The demo business and demo logins are never created when `APP_ENV=production`.

## Schema changes
Production schema changes come only from Alembic. After changing a model:
`docker compose run --rm --no-deps backend alembic revision --autogenerate -m "describe change"`, review the generated file, commit it. `tests/test_migrations.py` fails if models and migrations disagree. Take a backup before deploying a migration.

An existing database that was created by the development auto-create path (not Alembic) must be stamped once before its first production start: `alembic stamp 0001` (only valid if it already matches the baseline).

## Backups
The `backup` service writes a gzipped `pg_dump` to the `db_backups` volume every 24h and keeps 14 days. That volume lives on the same server, so also copy it off the machine (a provider snapshot, or `docker run --rm -v <project>_db_backups:/b -v $PWD:/out alpine tar czf /out/backups.tgz /b`). Uploaded files live in the `media_data` volume and need the same treatment.

Restore: `gunzip -c booking-<stamp>.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U booking booking_platform` into an empty database. Rehearse this once before launch.

## Monitoring
- Uptime: point an external monitor at `https://<API_DOMAIN>/api/v1/health/ready` (returns 503 when the database is down).
- Errors: set `SENTRY_DSN`. No request bodies or cookies are sent.
- The container healthcheck restarts nothing by itself; add alerting on the monitor.

## Known gaps
- The storefront container still runs as root and builds at start-up (slow first boot).
- Rate limiting is per API process, which is fine for one server and must move to Redis before running several.
- One server is a single point of failure; restoring from backup is the recovery plan.
