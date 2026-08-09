# Marrow Gateway — Backup And Restore

This runbook is for the PostgreSQL-backed shared gateway.

Back up PostgreSQL and `ARTIFACT_DIR` together. PostgreSQL stores metadata,
tasks, decisions, events, client records, and artifact metadata. `ARTIFACT_DIR`
stores artifact bytes. Losing either side can break artifact retrieval.

## Scope

Back up:

- PostgreSQL database reported by `gateway.backup_manifest`
- artifact directory reported by `gateway.backup_manifest`
- deployment `.env`
- nginx/PM2 deployment files when they are not managed elsewhere

Do not put secrets into shared artifacts or logs. Keep `.env` and backup files
under the operator's normal secret-handling policy.

## Preflight

Ask marrow for the safe backup surface:

```text
gateway.backup_manifest
```

Confirm:

- `database.backupRequired=true`
- `artifacts.backupRequired=true`
- `migrations.pending=[]`
- `database.tables` includes `projects`, `items`, `tasks`, `decisions`,
  `links`, `events`, `artifacts`, `kv`, `gateway_clients`, and Knex migration
  tables
- `artifacts.dir` points at the artifact directory used by the running gateway

Also verify readiness:

```text
gateway.version
gateway.diagnostics
```

## Backup

Run commands from the gateway deployment directory that contains `.env`.

Load environment variables without printing secrets:

```bash
set -a
. ./.env
set +a
```

Create a timestamped backup directory:

```bash
backup_dir="./backups/pm3m-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
```

Dump PostgreSQL in custom format:

```bash
pg_dump \
  --host "${POSTGRES_HOST:-127.0.0.1}" \
  --port "${POSTGRES_PORT:-5432}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --format custom \
  --file "$backup_dir/postgres.dump"
```

Archive artifacts:

```bash
tar -C "$(dirname "${ARTIFACT_DIR:-./artifacts}")" \
  -czf "$backup_dir/artifacts.tgz" \
  "$(basename "${ARTIFACT_DIR:-./artifacts}")"
```

Store a backup manifest next to the backup. Do not include bearer tokens or
database passwords in this file:

```bash
pm3m status > "$backup_dir/pm3m-status.txt"
```

If MCP access is available, also save `gateway.backup_manifest` output through
the operator's normal secure channel.

## Restore

Restore into a stopped or isolated gateway. Do not restore into a live process
that is still accepting writes.

Stop PM2 process:

```bash
pm2 stop pm3m-gateway
```

Restore PostgreSQL. For a fresh database, create it first using your normal
PostgreSQL administration flow, then run:

```bash
pg_restore \
  --host "${POSTGRES_HOST:-127.0.0.1}" \
  --port "${POSTGRES_PORT:-5432}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --clean \
  --if-exists \
  "$backup_dir/postgres.dump"
```

Restore artifact bytes:

```bash
mkdir -p "$(dirname "${ARTIFACT_DIR:-./artifacts}")"
tar -C "$(dirname "${ARTIFACT_DIR:-./artifacts}")" \
  -xzf "$backup_dir/artifacts.tgz"
```

Run migrations. This is safe after restore and catches package/database drift:

```bash
pm3m migrate latest
```

Start gateway:

```bash
pm3m start
pm2 save
```

## Post-Restore Validation

Check process and database readiness:

```bash
pm3m status
```

Through MCP, call:

```text
gateway.version
gateway.diagnostics
gateway.backup_manifest
artifact.list
project.list
```

Confirm:

- `readiness.ok=true`
- `migrations.pending=[]`
- package version is the expected deployed version
- `artifact.list` returns expected metadata
- artifact downloads work for at least one known artifact
- project/task/decision counts look plausible against the backup manifest

## Failure Handling

If artifact metadata exists but bytes are missing, restore `ARTIFACT_DIR` from
the same backup generation as PostgreSQL.

If artifact bytes exist but metadata is missing, restore PostgreSQL from the
same backup generation as `ARTIFACT_DIR`.

If migrations are pending after restore, run `pm3m migrate latest` with the
package version intended for the restored deployment.

If the gateway starts but agents see the wrong project, have each stable client
call `project.set_current` again. Current project state is per client id and is
stored in `kv`.
