# Auth Layering Rule

Audience: anyone adding a network/edge auth layer (reverse proxy Basic Auth,
forward-auth, VPN gateway) in front of a marrow gateway or Marrow web UI deployment,
including self-host operators.

## The rule

An HTTP request carries a small, fixed set of independent auth *channels*:

- the `Authorization` header
- the `Cookie` header
- network identity (source IP, mTLS client cert)

**Two different auth mechanisms must never both claim the same channel on the
same URL path.** A request can only carry one `Authorization` header value. If
an edge layer (reverse proxy Basic Auth, an API gateway's own bearer check)
and an application layer both try to own `Authorization` for the same path,
the application's value always wins on the wire — the edge layer never sees
what it expects, fails auth, and (for the resource types below) re-prompts.

This is not a marrow-specific bug pattern; it is the generic failure mode of
stacking HTTP Basic Auth in front of any app that manages its own bearer
token. It surfaces almost every time someone does it, so treat "wrap the app
in Basic Auth" as fine only when the app has no `Authorization` header of its
own to protect, or when the Basic-Auth layer is explicitly scoped to exclude
the paths the app uses for its own auth.

## Worked incident (2026-08-06/07, Marrow web UI first public deploy)

An NPM ("Nginx Proxy Manager") Access List (Basic Auth) was added in front of
`marrow.example.com` as a same-day stopgap after the first public CI/CD deploy.
Symptom: the Basic-Auth password prompt reappeared immediately after a
correct login, on every attempt.

Two independent causes stacked:

1. **Vite hardcodes `crossorigin` on built `<script type=module>` and
   `modulepreload`/`stylesheet` `<link>` tags** (no config toggle). Per the
   fetch/CORS spec, `crossorigin` with no `use-credentials` value puts the
   request in anonymous CORS mode, which omits cached credentials — cookies
   *and* cached HTTP Basic-Auth — even for same-origin requests. The
   top-level document load sent the cached password fine; the JS/CSS asset
   requests right after did not, got 401, and the browser re-prompted for
   those subresource loads. Fixed in `front/vite.config.ts` with a
   `transformIndexHtml` plugin that strips `crossorigin` from the build
   output (safe here — all assets are same-origin).

2. **The channel collision described above.** The web UI's Apollo client sets
   `Authorization: Bearer <token>` on every GraphQL request to `/api/graphql`
   (documented, correct gateway behavior — see `GRAPHQL_API.md`). NPM's
   Access List applied `auth_basic` to a single catch-all `location /` that
   covered `/api/*` too. The app's Bearer header overwrote whatever cached
   Basic credential the browser would have sent, NPM saw a non-Basic
   `Authorization` value, returned 401 with `WWW-Authenticate: Basic`, and
   the browser re-prompted — this time for the API calls themselves, right
   after the app rendered its own login screen.

   Fix: moved Basic Auth off NPM entirely and onto the internal nginx
   (`project-memory-mcp/deploy/nginx/marrow.example.conf`), scoped only to
   `location /` (the SPA shell). `/api/*` keeps its existing locations
   untouched, still protected only by the gateway's own `Authorization:
   Bearer` check. NPM's Access List was then set to "None" on that proxy
   host so the two layers stop double-covering the same paths.

Why a different app on the same NPM Access List (code-server, several hops
downstream) never hit this: it authenticates via a session **cookie**, not an
`Authorization` header the frontend sets itself. Cookie and Basic Auth are
different channels — they compose fine. The failure is specific to apps that
manage their own `Authorization` header, which the web UI does by design (it's
the gateway's documented auth contract).

## Rule of thumb for adding an edge layer

- Prefer a channel the app doesn't use: **IP allowlist, mTLS, or a
  network/VPN boundary** — none of these touch `Authorization` or `Cookie`,
  so they never collide with anything downstream.
- If you must use HTTP Basic Auth (or any other `Authorization`-based
  edge check) in front of an app with its own bearer-token API, **scope it
  explicitly to the paths that don't carry the app's own `Authorization`
  header** (here: SPA shell paths, not `/api/*`). Never apply it as a single
  catch-all covering both.
- Once the web UI has real per-user login (tracked as the next step after the
  shared `MCP_TOKEN`-in-a-text-box model — see `DECISIONS.md` /
  `D-PMEM-003` and the pmem-ui project decisions), prefer a **cookie-backed
  session** for the browser-facing side specifically because it doesn't
  compete with any `Authorization`-based layer underneath or in front of it.

## Current state (as of Marrow web UI v0.1.2)

| Path            | Edge layer (NPM)        | App/internal nginx layer                          |
|------------------|--------------------------|-----------------------------------------------------|
| `/` (SPA shell)  | none (Access List unset) | `auth_basic` (htpasswd), same credential NPM had     |
| `/api/*`         | none                      | gateway's own `Authorization: Bearer` (MCP_TOKEN/OAuth), unchanged |

This is still a stopgap, not the target end state — see the pmem-ui project
decisions for the staged plan toward per-user login and eventually
project-scoped permissions.
