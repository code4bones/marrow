# Bundled Artifact Templates

These files are packaged with `@deadragdoll/pm3m` and seeded into the gateway
artifact store after `pm3m migrate latest`.

Seeded artifacts are common-scope files with paths under:

```text
templates/
```

Agents can find them with `artifact.search` or browse them with `artifact.list`.

Example:

```json
{
  "common": true,
  "pathPrefix": "templates/agents",
  "tags": ["template", "agents"]
}
```
