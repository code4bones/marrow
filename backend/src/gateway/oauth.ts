import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Knex } from "knex";
import { hashToken } from "./auth.js";

export type OAuthAuthResult =
  | { ok: true; clientId: string; scopes: string[]; subject: string }
  | { ok: false; reason: string };

export type OAuthTokenResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400; body: Record<string, unknown> }
  | { status: 401; body: Record<string, unknown> };

export type OAuthAuthorizeRedirectResult =
  | { ok: true; location: string }
  | { ok: false; error: string };

export type OAuthAuthorizeSessionResult =
  | { ok: true; redirectUri: string }
  | { ok: false; error: string };

// SSO real-login authorize flow (replaces the old shared magic-token gate):
// `ownerUserId` is the Marrow user who was actually logged in (via
// pmem_session) when the authorization code was minted -- frozen here so
// the token exchange can stamp it as the JWT's `sub`. Deliberately NOT
// freezing a role/scope claim alongside it: the granted tier is resolved
// fresh from `users` on every subsequent request (http-server.ts's
// resolveScopeTier), so a role change or account disable takes effect
// immediately instead of only at the next OAuth login.
type OAuthCodeRecord = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scopes: string[];
  ownerUserId: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
};

export type OAuthFacade = ReturnType<typeof createOAuthFacade>;

type OAuthConfig = {
  publicUrl: string;
  issuer: string;
  audience: string;
  resourceUrls: string[];
  authCodeTtlSeconds: number;
  allowedRedirectUris: string[];
  scopes: string[];
  privateKey: KeyObject;
  publicKey: KeyObject;
  keyId: string;
};

const defaultScopes = ["memory:read", "memory:write"];
const authorizeRequiredParams = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method"
];

export function createOAuthFacadeFromEnv(env: NodeJS.ProcessEnv, db: Knex): OAuthFacade | undefined {
  // The magic-token gate (PROJECT_MEMORY_MAGIC_TOKEN/_HASH) that used to
  // both enable this facade AND gate /oauth/authorize is gone -- OAuth
  // connectors now authenticate through Marrow's own login (see
  // authorizeWithSession below). PROJECT_MEMORY_PUBLIC_URL is the
  // OAuth-facade-specific setting (issuer/audience/JWKS base, and now also
  // the frontend redirect target's origin), so its presence is the new
  // explicit opt-in -- deliberately NOT falling back to GW_ENDPOINT here,
  // so a deployment that only sets GW_ENDPOINT for client mode doesn't
  // silently turn OAuth on.
  if (!env.PROJECT_MEMORY_PUBLIC_URL) {
    return undefined;
  }

  const publicUrl = trimTrailingSlash(env.PROJECT_MEMORY_PUBLIC_URL);
  const privateKey = privateKeyFromEnv(env.PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM);
  const audience = trimTrailingSlash(env.PROJECT_MEMORY_OAUTH_AUDIENCE ?? publicUrl);
  return createOAuthFacade(
    {
      publicUrl,
      issuer: trimTrailingSlash(env.PROJECT_MEMORY_OAUTH_ISSUER ?? publicUrl),
      audience,
      resourceUrls: uniqueStrings([audience, joinUrlPath(publicUrl, "mcp"), ...listEnv(env.PROJECT_MEMORY_OAUTH_RESOURCES)]),
      authCodeTtlSeconds: positiveInteger(env.PROJECT_MEMORY_AUTH_CODE_TTL_SECONDS, 300),
      allowedRedirectUris: listEnv(env.PROJECT_MEMORY_ALLOWED_REDIRECT_URIS),
      scopes: listEnv(env.PROJECT_MEMORY_OAUTH_SCOPES, defaultScopes),
      privateKey,
      publicKey: createPublicKey(privateKey),
      keyId: env.PROJECT_MEMORY_OAUTH_KEY_ID ?? "pmem-oauth"
    },
    db
  );
}

// Per-user OAuth connector credentials (replaces the old static, shared
// PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET pair): `db` is threaded through
// exactly like createAuthFacade(db) in auth.ts, so validateAuthorizeParams/
// authenticateOAuthClient below can look client_id/client_secret up in the
// oauth_clients table instead of comparing against a single static pair.
export function createOAuthFacade(config: OAuthConfig, db: Knex) {
  const codes = new Map<string, OAuthCodeRecord>();

  return {
    metadata: {
      protectedResource(resource?: string) {
        return {
          resource: resource && isAllowedResource(resource, config) ? resource : config.audience,
          authorization_servers: [config.issuer],
          scopes_supported: config.scopes,
          resource_documentation: `${config.publicUrl}/docs`
        };
      },
      authorizationServer() {
        return {
          issuer: config.issuer,
          authorization_endpoint: `${config.issuer}/oauth/authorize`,
          token_endpoint: `${config.issuer}/oauth/token`,
          jwks_uri: `${config.issuer}/.well-known/jwks.json`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: tokenEndpointAuthMethods(),
          scopes_supported: config.scopes
        };
      },
      jwks() {
        return {
          keys: [publicJwk(config.publicKey, config.keyId)]
        };
      }
    },
    challengeHeader(requiredScopes: string[] = ["memory:read"], resource?: string) {
      return `Bearer resource_metadata="${protectedResourceMetadataUrl(config, resource)}", scope="${requiredScopes.join(" ")}"`;
    },
    resourceForPath(pathname: string) {
      return joinUrlPath(config.publicUrl, trimSlashes(pathname));
    },
    resourceFromMetadataPath(suffix: string) {
      return resourceFromMetadataPath(config, suffix);
    },
    // GET /oauth/authorize (http-server.ts): validates the same way the old
    // magic-token form did, but on success 302s the user's browser to
    // Marrow's own frontend (same origin as `publicUrl`, root path instead
    // of the API prefix -- see frontendOrigin() below) with the original
    // query string intact, so the frontend's login/consent UI can run.
    // Real session-cookie authorization happens in authorizeWithSession
    // below, once the frontend has a pmem_session to present.
    async authorizeRedirectUrl(url: URL): Promise<OAuthAuthorizeRedirectResult> {
      const validation = await validateAuthorizeParams(url.searchParams, config, db);
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }
      const frontend = new URL("/oauth/authorize", frontendOrigin(config));
      frontend.search = url.searchParams.toString();
      return { ok: true, location: frontend.toString() };
    },
    // POST /oauth/authorize (http-server.ts): the new session-cookie-backed
    // replacement for the old magic-token POST. Called only after
    // http-server.ts has already confirmed a valid pmem_session and resolved
    // its owning user -- this never re-authenticates a human itself (no
    // password/TOTP here), it only mints the code and freezes ownerUserId.
    async authorizeWithSession(params: URLSearchParams, ownerUserId: string): Promise<OAuthAuthorizeSessionResult> {
      const validation = await validateAuthorizeParams(params, config, db);
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }

      const code = randomToken(32);
      codes.set(code, {
        clientId: validation.params.clientId,
        redirectUri: validation.params.redirectUri,
        codeChallenge: validation.params.codeChallenge,
        codeChallengeMethod: "S256",
        resource: validation.params.resource,
        scopes: validation.params.scopes,
        ownerUserId,
        expiresAt: Date.now() + config.authCodeTtlSeconds * 1000,
        usedAt: null,
        createdAt: Date.now()
      });
      pruneCodes(codes);

      const redirect = new URL(validation.params.redirectUri);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", validation.params.state);
      return { ok: true, redirectUri: redirect.toString() };
    },
    async token(form: URLSearchParams, request?: IncomingMessage): Promise<OAuthTokenResponse> {
      if (form.get("grant_type") !== "authorization_code") {
        return oauthTokenError("unsupported_grant_type", "Only authorization_code is supported.");
      }

      const clientAuth = await authenticateOAuthClient(form, request, config, db);
      if (!clientAuth.ok) {
        return oauthTokenError("invalid_client", clientAuth.error, 401);
      }

      const code = form.get("code") ?? "";
      const record = codes.get(code);
      if (!record || record.usedAt !== null || record.expiresAt <= Date.now()) {
        return oauthTokenError("invalid_grant", "Invalid authorization code.");
      }

      if (clientAuth.clientId !== record.clientId) {
        return oauthTokenError("invalid_grant", "Invalid authorization code.");
      }
      if (form.get("redirect_uri") !== record.redirectUri) {
        return oauthTokenError("invalid_grant", "Invalid authorization code.");
      }
      const resource = form.get("resource") ?? config.audience;
      if (resource !== record.resource) {
        return oauthTokenError("invalid_target", "Invalid resource.");
      }
      if (!verifyPkceS256(form.get("code_verifier") ?? "", record.codeChallenge)) {
        return oauthTokenError("invalid_grant", "Invalid authorization code.");
      }

      record.usedAt = Date.now();
      codes.set(code, record);

      const accessToken = issueJwt(config, record);
      return {
        status: 200,
        body: {
          access_token: accessToken,
          token_type: "Bearer",
          scope: record.scopes.join(" ")
        }
      };
    },
    authenticate(request: IncomingMessage, requiredScopes: string[] = ["memory:read"]): OAuthAuthResult {
      const token = bearerToken(request);
      if (!token) {
        return { ok: false, reason: "missing" };
      }
      return verifyJwt(config, token, requiredScopes);
    }
  };
}

// Existence-only check (no secret involved) -- matches the shape this had
// when it compared against a single static config.clientId: knowing a
// registered client_id alone was never the access boundary, only the login
// step at /oauth/authorize itself is (D-MEMORY-027, unchanged by this
// task). Now DB-backed instead of comparing against one static value, since
// every approved user has their own client_id in oauth_clients.
async function validateAuthorizeParams(
  params: URLSearchParams,
  config: OAuthConfig,
  db: Knex
): Promise<
  | {
      ok: true;
      params: {
        clientId: string;
        redirectUri: string;
        codeChallenge: string;
        resource: string;
        scopes: string[];
        state: string;
      };
    }
  | { ok: false; error: string }
> {
  for (const name of authorizeRequiredParams) {
    if (!params.get(name)) {
      return { ok: false, error: `Missing ${name}.` };
    }
  }
  if (params.get("response_type") !== "code") {
    return { ok: false, error: "response_type must be code." };
  }
  if (params.get("code_challenge_method") !== "S256") {
    return { ok: false, error: "code_challenge_method must be S256." };
  }
  const clientId = params.get("client_id") ?? "";
  const clientRow = await db("oauth_clients").where({ client_id: clientId }).first();
  if (!clientRow) {
    return { ok: false, error: "client_id is not allowed." };
  }

  const redirectUri = params.get("redirect_uri") ?? "";
  if (!isAllowedRedirectUri(redirectUri, config.allowedRedirectUris)) {
    return { ok: false, error: "redirect_uri is not allowed." };
  }

  const resource = params.get("resource") ?? config.audience;
  if (!isAllowedResource(resource, config)) {
    return { ok: false, error: "resource is not allowed." };
  }

  return {
    ok: true,
    params: {
      clientId,
      redirectUri,
      codeChallenge: params.get("code_challenge") ?? "",
      resource,
      state: params.get("state") ?? "",
      // PMem is an internal gateway: successful OAuth means access to
      // whatever this gateway supports (config.scopes), independent of what
      // the client actually requested via `scope=` -- not renegotiated or
      // frozen here. The real authorization decision now happens fresh on
      // every call (http-server.ts's role-derived resolveScopeTier), not
      // from this granted-at-authorize-time claim.
      scopes: config.scopes
    }
  };
}

// Unconditional now: every per-user oauth_clients row always has a secret
// (unlike the old static config.clientSecret, which was optional and could
// leave this deployment on ["none"]), so client_secret_post/basic are
// always the advertised methods.
function tokenEndpointAuthMethods(): string[] {
  return ["client_secret_post", "client_secret_basic"];
}

async function authenticateOAuthClient(
  form: URLSearchParams,
  request: IncomingMessage | undefined,
  config: OAuthConfig,
  db: Knex
): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  const basic = basicClientCredentials(request);
  const formClientId = form.get("client_id") ?? "";
  const clientId = basic?.clientId ?? formClientId;

  if (!clientId) {
    return { ok: false, error: "Missing client_id." };
  }
  if (basic && formClientId && formClientId !== basic.clientId) {
    return { ok: false, error: "Conflicting client_id values." };
  }

  // Every per-user OAuth client always has a secret (unlike the old
  // optional static config.clientSecret) -- fail closed on a missing one
  // rather than falling back to an unauthenticated "client_id alone is
  // enough" path.
  const clientSecret = basic?.clientSecret ?? form.get("client_secret") ?? "";
  if (!clientSecret) {
    return { ok: false, error: "Missing client_secret." };
  }

  // Same "put the hash directly in the WHERE clause" convention as
  // identifyPersonalToken (auth.ts) -- a straight hash-equality lookup, not
  // an application-level timing-safe compare, matching how every other
  // hash-only secret in this codebase (personal_tokens, sessions, tokens)
  // is verified.
  const row = await db("oauth_clients")
    .where({ client_id: clientId, client_secret_hash: hashToken(clientSecret) })
    .first();
  if (!row) {
    return { ok: false, error: "Invalid client credentials." };
  }

  // Best-effort activity timestamp, same fire-and-forget convention as
  // identifyPersonalToken's last_used_at stamp (auth.ts) -- a failed update
  // must not fail the token exchange itself.
  db("oauth_clients")
    .where({ id: row.id })
    .update({ last_used_at: new Date() })
    .catch(() => {
      // Best-effort; ignored.
    });

  return { ok: true, clientId };
}

function basicClientCredentials(
  request: IncomingMessage | undefined
): { clientId: string; clientSecret: string } | undefined {
  const header = request?.headers.authorization?.trim();
  const match = header?.match(/^Basic\s+(.+)$/i);
  if (!match) {
    return undefined;
  }
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return undefined;
  }
  return {
    clientId: decoded.slice(0, separator),
    clientSecret: decoded.slice(separator + 1)
  };
}

// 30 days, matching the pmem_session cookie's own TTL (auth.ts's
// SESSION_TTL_MS) -- an OAuth connector's access token should not outlive
// the browser session that authorized it by much more than that.
const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function issueJwt(config: OAuthConfig, record: OAuthCodeRecord): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "RS256", typ: "JWT", kid: config.keyId });
  const payload = base64urlJson({
    iss: config.issuer,
    aud: record.resource,
    // Real identity (T-MEMORY-0xx SSO): the Marrow user who was logged in
    // via pmem_session when this code was minted (see authorizeWithSession
    // above), not the old hardcoded "project-memory-user" literal. Scope
    // tier is resolved fresh from this user's CURRENT role on every call,
    // never cached in the token.
    sub: record.ownerUserId,
    client_id: record.clientId,
    scope: record.scopes.join(" "),
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomUUID()
  });
  const signingInput = `${header}.${payload}`;
  const signature = base64url(sign("RSA-SHA256", Buffer.from(signingInput), config.privateKey));
  return `${signingInput}.${signature}`;
}

function verifyJwt(config: OAuthConfig, token: string, requiredScopes: string[]): OAuthAuthResult {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed" };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseBase64urlJson(encodedHeader);
  const payload = parseBase64urlJson(encodedPayload);
  if (!header || !payload || header.alg !== "RS256" || header.kid !== config.keyId) {
    return { ok: false, reason: "malformed" };
  }

  const validSignature = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    config.publicKey,
    fromBase64url(encodedSignature)
  );
  if (!validSignature) {
    return { ok: false, reason: "signature" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== config.issuer || typeof payload.aud !== "string" || !isAllowedResource(payload.aud, config)) {
    return { ok: false, reason: "claims" };
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    return { ok: false, reason: "not_before" };
  }
  // Every OAuth access token now carries a real exp claim (30-day TTL, see
  // issueJwt) -- a token minted before this task had none at all, so a
  // missing exp is treated as expired (fail closed) rather than eternal.
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    return { ok: false, reason: "expired" };
  }

  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
  if (!requiredScopes.every((scope) => scopes.includes(scope))) {
    return { ok: false, reason: "scope" };
  }

  return {
    ok: true,
    clientId: typeof payload.client_id === "string" ? payload.client_id : "oauth",
    scopes,
    subject: typeof payload.sub === "string" ? payload.sub : ""
  };
}

function verifyPkceS256(verifier: string, expectedChallenge: string): boolean {
  if (!verifier || !expectedChallenge) {
    return false;
  }
  const actual = base64url(createHash("sha256").update(verifier).digest());
  return safeEqual(actual, expectedChallenge);
}

function privateKeyFromEnv(value: string | undefined): KeyObject {
  if (value?.trim()) {
    return createPrivateKey(value.replace(/\\n/g, "\n"));
  }
  return generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
}

function publicJwk(publicKey: KeyObject, keyId: string): Record<string, unknown> {
  return {
    ...publicKey.export({ format: "jwk" }),
    kid: keyId,
    alg: "RS256",
    use: "sig"
  };
}

function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization?.trim();
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function isAllowedRedirectUri(value: string, allowlist: string[]): boolean {
  if (allowlist.length > 0) {
    return allowlist.includes(value);
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

// The frontend is always served from the same origin as this gateway's own
// publicUrl, just at the root path instead of the API prefix (e.g.
// https://marrow.example.com/api -> https://marrow.example.com/ -- see
// front/deploy/nginx/marrow-ui.locations.conf and
// backend/deploy/nginx/marrow.example.conf, which proxy the two from the
// same nginx server{} block). No separate "frontend public URL" env var
// exists or is needed -- the origin is all this needs, and it's already
// derivable from the OAuth-facade-specific PROJECT_MEMORY_PUBLIC_URL.
function frontendOrigin(config: OAuthConfig): string {
  return new URL(config.publicUrl).origin;
}

function pruneCodes(codes: Map<string, OAuthCodeRecord>): void {
  const now = Date.now();
  for (const [code, record] of codes.entries()) {
    if (record.expiresAt <= now || record.usedAt !== null) {
      codes.delete(code);
    }
  }
}

function oauthTokenError(error: string, description: string, status: 400 | 401 = 400): OAuthTokenResponse {
  return {
    status,
    body: {
      error,
      error_description: description
    }
  };
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.byteLength !== bBuffer.byteLength) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

function base64urlJson(value: Record<string, unknown>): string {
  return base64url(Buffer.from(JSON.stringify(value)));
}

function parseBase64urlJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fromBase64url(value).toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function randomToken(bytes: number): string {
  return base64url(randomBytes(bytes));
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function positiveInteger(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function listEnv(value: string | undefined, fallback: string[] = []): string[] {
  const parsed = value
    ?.split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed && parsed.length > 0 ? parsed : fallback;
}

function isAllowedResource(resource: string, config: OAuthConfig): boolean {
  const normalized = trimTrailingSlash(resource);
  if (config.resourceUrls.includes(normalized)) {
    return true;
  }
  const parsed = safeUrl(normalized);
  if (!parsed || parsed.hash) {
    return false;
  }
  return config.resourceUrls.some((allowed) => {
    const allowedUrl = safeUrl(allowed);
    if (!allowedUrl) {
      return false;
    }
    return (
      parsed.origin === allowedUrl.origin &&
      trimTrailingSlash(parsed.pathname) === trimTrailingSlash(allowedUrl.pathname)
    );
  });
}

function protectedResourceMetadataUrl(config: OAuthConfig, resource: string | undefined): string {
  if (!resource || trimTrailingSlash(resource) === config.audience) {
    return `${config.publicUrl}/.well-known/oauth-protected-resource`;
  }
  const suffix = resourceMetadataSuffix(config, resource);
  return suffix
    ? `${config.publicUrl}/.well-known/oauth-protected-resource/${suffix}`
    : `${config.publicUrl}/.well-known/oauth-protected-resource`;
}

function resourceMetadataSuffix(config: OAuthConfig, resource: string): string | undefined {
  const normalizedResource = trimTrailingSlash(resource);
  if (!isAllowedResource(normalizedResource, config)) {
    return undefined;
  }
  const publicUrl = new URL(config.publicUrl);
  const resourceUrl = new URL(normalizedResource);
  if (resourceUrl.origin !== publicUrl.origin) {
    return undefined;
  }
  const publicPath = trimSlashes(publicUrl.pathname);
  const resourcePath = trimSlashes(resourceUrl.pathname);
  if (publicPath && resourcePath.startsWith(`${publicPath}/`)) {
    return resourcePath.slice(publicPath.length + 1);
  }
  return resourcePath || undefined;
}

function resourceFromMetadataPath(config: OAuthConfig, suffix: string): string {
  const cleanSuffix = trimSlashes(suffix);
  if (!cleanSuffix) {
    return config.audience;
  }
  const publicUrl = new URL(config.publicUrl);
  const publicPath = trimSlashes(publicUrl.pathname);
  if (publicPath && cleanSuffix.startsWith(`${publicPath}/`)) {
    return `${publicUrl.origin}/${cleanSuffix}`;
  }
  return joinUrlPath(config.publicUrl, cleanSuffix);
}

function joinUrlPath(base: string, suffix: string): string {
  const cleanBase = trimTrailingSlash(base);
  const cleanSuffix = trimSlashes(suffix);
  return cleanSuffix ? `${cleanBase}/${cleanSuffix}` : cleanBase;
}

function trimSlashes(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(trimTrailingSlash).filter(Boolean))];
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
