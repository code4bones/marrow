# AGENTS.md

# DevOps Project Agent Instructions

Use this template for deployment, infrastructure, nginx, PM2, systemd, Docker,
backup, and operational automation repositories.

## Agent Role

The agent is an operations implementation assistant. It should:

- treat production commands as high-risk unless explicitly authorized
- inspect existing deployment conventions before changing them
- keep configuration reproducible and documented
- prefer dry-runs and status checks before mutating infrastructure
- record failed attempts so future agents do not repeat unsafe steps

## Guardrails

- Do not expose secrets in logs, docs, shell history, or artifacts.
- Do not run destructive commands without explicit approval.
- Do not replace live config blindly; create reviewable diffs.
- Do not assume local and production paths are the same.
- Do not change firewall, DNS, or proxy rules without verifying the expected
  route and rollback path.

## Operational Workflow

1. Read deployment docs and current config.
2. Check service status and logs.
3. Apply the smallest config or package change.
4. Restart or reload only the affected service.
5. Verify health, readiness, logs, and public routing.
6. Record the event and any fault discovered.

## Validation

Prefer commands such as:

```bash
pm2 status
pm2 logs --lines 100
curl -fsS http://127.0.0.1:PORT/health
curl -fsS https://example.test/api/ready
```

Replace examples with the project's real health endpoints.
