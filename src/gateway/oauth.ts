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

export type OAuthAuthResult =
  | { ok: true; clientId: string; scopes: string[]; subject: string }
  | { ok: false; reason: string };

export type OAuthTokenResponse =
  | { status: 200; body: Record<string, unknown> }
  | { status: 400; body: Record<string, unknown> }
  | { status: 401; body: Record<string, unknown> };

export type OAuthAuthorizeResult =
  | { status: 302; location: string }
  | { status: 400; html: string };

type OAuthCodeRecord = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scopes: string[];
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
};

type OAuthRateLimitRecord = {
  count: number;
  resetAt: number;
};

export type OAuthFacade = ReturnType<typeof createOAuthFacade>;

type OAuthConfig = {
  publicUrl: string;
  issuer: string;
  audience: string;
  clientId?: string;
  clientSecret?: string;
  magicToken?: string;
  magicTokenHash?: string;
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

export function createOAuthFacadeFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthFacade | undefined {
  if (!env.PROJECT_MEMORY_MAGIC_TOKEN && !env.PROJECT_MEMORY_MAGIC_TOKEN_HASH) {
    return undefined;
  }

  const publicUrl = trimTrailingSlash(env.PROJECT_MEMORY_PUBLIC_URL ?? env.GW_ENDPOINT ?? "");
  if (!publicUrl) {
    throw new Error("PROJECT_MEMORY_PUBLIC_URL is required when OAuth facade is enabled.");
  }

  const privateKey = privateKeyFromEnv(env.PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM);
  return createOAuthFacade({
    publicUrl,
    issuer: trimTrailingSlash(env.PROJECT_MEMORY_OAUTH_ISSUER ?? publicUrl),
    audience: trimTrailingSlash(env.PROJECT_MEMORY_OAUTH_AUDIENCE ?? publicUrl),
    clientId: optionalEnv(env.PROJECT_MEMORY_OAUTH_CLIENT_ID),
    clientSecret: optionalEnv(env.PROJECT_MEMORY_OAUTH_CLIENT_SECRET),
    magicToken: env.PROJECT_MEMORY_MAGIC_TOKEN,
    magicTokenHash: env.PROJECT_MEMORY_MAGIC_TOKEN_HASH,
    authCodeTtlSeconds: positiveInteger(env.PROJECT_MEMORY_AUTH_CODE_TTL_SECONDS, 300),
    allowedRedirectUris: listEnv(env.PROJECT_MEMORY_ALLOWED_REDIRECT_URIS),
    scopes: listEnv(env.PROJECT_MEMORY_OAUTH_SCOPES, defaultScopes),
    privateKey,
    publicKey: createPublicKey(privateKey),
    keyId: env.PROJECT_MEMORY_OAUTH_KEY_ID ?? "pmem-oauth"
  });
}

export function createOAuthFacade(config: OAuthConfig) {
  const codes = new Map<string, OAuthCodeRecord>();
  const failedAttempts = new Map<string, OAuthRateLimitRecord>();

  return {
    metadata: {
      protectedResource() {
        return {
          resource: config.audience,
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
          token_endpoint_auth_methods_supported: tokenEndpointAuthMethods(config),
          scopes_supported: config.scopes
        };
      },
      jwks() {
        return {
          keys: [publicJwk(config.publicKey, config.keyId)]
        };
      }
    },
    challengeHeader(requiredScopes: string[] = ["memory:read"]) {
      return `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource", scope="${requiredScopes.join(" ")}"`;
    },
    authorizeForm(url: URL) {
      const validation = validateAuthorizeParams(url.searchParams, config);
      if (!validation.ok) {
        return {
          status: 400,
          html: htmlPage("OAuth Error", `<p>${escapeHtml(validation.error)}</p>`)
        };
      }

      return {
        status: 200,
        html: htmlPage(
          "Authorize Project Memory",
          `<form method="post" action="">
  ${hiddenInputs(url.searchParams)}
  <label>Magic token <input name="magic_token" type="password" autocomplete="current-password" autofocus /></label>
  <button type="submit">Authorize</button>
</form>`
        )
      };
    },
    authorize(form: URLSearchParams, clientIp: string): OAuthAuthorizeResult {
      const validation = validateAuthorizeParams(form, config);
      if (!validation.ok) {
        return { status: 400, html: htmlPage("OAuth Error", `<p>${escapeHtml(validation.error)}</p>`) };
      }
      if (isRateLimited(failedAttempts, clientIp)) {
        return { status: 400, html: htmlPage("OAuth Error", "<p>Invalid token</p>") };
      }
      if (!verifyMagicToken(form.get("magic_token") ?? "", config)) {
        recordFailedAttempt(failedAttempts, clientIp);
        return { status: 400, html: htmlPage("OAuth Error", "<p>Invalid token</p>") };
      }

      const code = randomToken(32);
      codes.set(code, {
        clientId: validation.params.clientId,
        redirectUri: validation.params.redirectUri,
        codeChallenge: validation.params.codeChallenge,
        codeChallengeMethod: "S256",
        resource: validation.params.resource,
        scopes: validation.params.scopes,
        expiresAt: Date.now() + config.authCodeTtlSeconds * 1000,
        usedAt: null,
        createdAt: Date.now()
      });
      pruneCodes(codes);

      const redirect = new URL(validation.params.redirectUri);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", validation.params.state);
      return { status: 302, location: redirect.toString() };
    },
    token(form: URLSearchParams, request?: IncomingMessage): OAuthTokenResponse {
      if (form.get("grant_type") !== "authorization_code") {
        return oauthTokenError("unsupported_grant_type", "Only authorization_code is supported.");
      }

      const clientAuth = authenticateOAuthClient(form, request, config);
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

function validateAuthorizeParams(
  params: URLSearchParams,
  config: OAuthConfig
):
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
  | { ok: false; error: string } {
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
  if (config.clientId && clientId !== config.clientId) {
    return { ok: false, error: "client_id is not allowed." };
  }

  const redirectUri = params.get("redirect_uri") ?? "";
  if (!isAllowedRedirectUri(redirectUri, config.allowedRedirectUris)) {
    return { ok: false, error: "redirect_uri is not allowed." };
  }

  const resource = params.get("resource") ?? config.audience;
  if (resource !== config.audience) {
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
      scopes: requestedScopes(params.get("scope"), config.scopes)
    }
  };
}

function tokenEndpointAuthMethods(config: OAuthConfig): string[] {
  return config.clientSecret ? ["client_secret_post", "client_secret_basic"] : ["none"];
}

function authenticateOAuthClient(
  form: URLSearchParams,
  request: IncomingMessage | undefined,
  config: OAuthConfig
): { ok: true; clientId: string } | { ok: false; error: string } {
  const basic = basicClientCredentials(request);
  const formClientId = form.get("client_id") ?? "";
  const clientId = basic?.clientId ?? formClientId;

  if (!clientId) {
    return { ok: false, error: "Missing client_id." };
  }
  if (basic && formClientId && formClientId !== basic.clientId) {
    return { ok: false, error: "Conflicting client_id values." };
  }
  if (config.clientId && clientId !== config.clientId) {
    return { ok: false, error: "Unknown client." };
  }

  if (!config.clientSecret) {
    return { ok: true, clientId };
  }

  const clientSecret = basic?.clientSecret ?? form.get("client_secret") ?? "";
  if (!clientSecret || !safeEqual(clientSecret, config.clientSecret)) {
    return { ok: false, error: "Invalid client credentials." };
  }

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

function issueJwt(config: OAuthConfig, record: OAuthCodeRecord): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "RS256", typ: "JWT", kid: config.keyId });
  const payload = base64urlJson({
    iss: config.issuer,
    aud: record.resource,
    sub: "project-memory-user",
    client_id: record.clientId,
    scope: record.scopes.join(" "),
    iat: now,
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
  if (payload.iss !== config.issuer || payload.aud !== config.audience) {
    return { ok: false, reason: "claims" };
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    return { ok: false, reason: "not_before" };
  }

  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
  if (!requiredScopes.every((scope) => scopes.includes(scope))) {
    return { ok: false, reason: "scope" };
  }

  return {
    ok: true,
    clientId: typeof payload.client_id === "string" ? payload.client_id : "oauth",
    scopes,
    subject: typeof payload.sub === "string" ? payload.sub : "project-memory-user"
  };
}

function requestedScopes(scope: string | null, supportedScopes: string[]): string[] {
  if (!scope) {
    return supportedScopes;
  }
  const requested = scope.split(/\s+/).filter(Boolean);
  const allowed = requested.filter((item) => supportedScopes.includes(item));
  return allowed.length > 0 ? allowed : supportedScopes;
}

function verifyPkceS256(verifier: string, expectedChallenge: string): boolean {
  if (!verifier || !expectedChallenge) {
    return false;
  }
  const actual = base64url(createHash("sha256").update(verifier).digest());
  return safeEqual(actual, expectedChallenge);
}

function verifyMagicToken(input: string, config: OAuthConfig): boolean {
  if (!input) {
    return false;
  }
  if (config.magicToken && safeEqual(input, config.magicToken)) {
    return true;
  }
  if (config.magicTokenHash) {
    const expectedHash = config.magicTokenHash.replace(/^sha256:/, "");
    const actualHash = createHash("sha256").update(input).digest("hex");
    return safeEqual(actualHash, expectedHash);
  }
  return false;
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

function isRateLimited(records: Map<string, OAuthRateLimitRecord>, key: string): boolean {
  const record = records.get(key);
  if (!record || record.resetAt <= Date.now()) {
    return false;
  }
  return record.count >= 10;
}

function recordFailedAttempt(records: Map<string, OAuthRateLimitRecord>, key: string): void {
  const current = records.get(key);
  if (!current || current.resetAt <= Date.now()) {
    records.set(key, { count: 1, resetAt: Date.now() + 10 * 60 * 1000 });
    return;
  }
  records.set(key, { ...current, count: current.count + 1 });
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

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; }
    form { display: grid; gap: 1rem; }
    label { display: grid; gap: .5rem; }
    input { font: inherit; padding: .6rem .7rem; }
    button { font: inherit; padding: .6rem .9rem; width: fit-content; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;
}

function hiddenInputs(params: URLSearchParams): string {
  const names = [...authorizeRequiredParams, "scope", "resource"];
  return names
    .map((name) => {
      const value = params.get(name);
      return value === null ? "" : `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
    })
    .join("\n  ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function optionalEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function listEnv(value: string | undefined, fallback: string[] = []): string[] {
  const parsed = value
    ?.split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed && parsed.length > 0 ? parsed : fallback;
}
