# Bundled Artifact Templates

These files are packaged with `@deadragdoll/pm3m` and seeded into the gateway
artifact store after `pm3m migrate latest`.

Seeded artifacts are common-scope files with paths under:

```text
templates/
```

Agents can find them with `artifact.search` or browse them with `artifact.list`.

Current bundled files:

- `templates/agents/generic/AGENTS.md`
- `templates/agents/frontend/AGENTS.md`
- `templates/agents/backend/AGENTS.md`
- `templates/agents/devops/AGENTS.md`
- `templates/review/REVIEW_CHECKLIST.md`
- `templates/deploy/DEPLOY_CHECKLIST.md`
- `templates/release/RELEASE_CHECKLIST.md`
- `templates/task/TASK_TEMPLATE.md`
- `templates/handoff/HANDOFF_TEMPLATE.md`
- `templates/fault/FAULT_TEMPLATE.md`

Example:

```json
{
  "common": true,
  "pathPrefix": "templates/agents",
  "tags": ["template", "agents"]
}
```
