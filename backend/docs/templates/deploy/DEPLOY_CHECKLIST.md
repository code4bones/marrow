# Deploy Checklist

Use this checklist before and after deploying a service.

## Before Deploy

- Confirm the target environment and package version.
- Check pending migrations.
- Confirm backup requirements for database and artifact storage.
- Review config changes and required environment variables.
- Check current service health and recent error logs.

## Deploy

- Install or unpack the new package.
- Run migrations from the deployment directory.
- Start or reload the service with the deployment `.env`.
- Avoid changing unrelated services during the deploy.

## After Deploy

- Verify local health and readiness endpoints.
- Verify the public route through the proxy.
- Check logs for startup errors and repeated warnings.
- Confirm expected version and tool count if the service exposes diagnostics.
- Record the deploy event in pmem.

## Rollback Notes

- Keep the previous package available until validation passes.
- Restore database and artifact storage together when persistent data must be
  rolled back.
- Document any manual correction made during the deploy.
