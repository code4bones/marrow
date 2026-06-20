import { createHash } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createOAuthFacadeFromEnv } from "../src/gateway/oauth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

const db = createPgKnex();
const service = new PgToolService(db);
const unique = Date.now();
const staticToken = `oauth-smoke-static-${unique}`;
const magicToken = `oauth-smoke-magic-${unique}`;
const publicUrl = "https://pmem-smoke.example/api";
const redirectUri = "https://chatgpt.com/connector/oauth/pmem-smoke";
const clientId = `chatgpt-smoke-${unique}`;
const clientSecret = `chatgpt-smoke-secret-${unique}`;
const pmemClientId = `oauth-smoke-client-${unique}`;
const oauth = createOAuthFacadeFromEnv({
  ...process.env,
  PROJECT_MEMORY_PUBLIC_URL: publicUrl,
  PROJECT_MEMORY_OAUTH_ISSUER: publicUrl,
  PROJECT_MEMORY_OAUTH_AUDIENCE: publicUrl,
  PROJECT_MEMORY_MAGIC_TOKEN: magicToken,
  PROJECT_MEMORY_OAUTH_CLIENT_ID: clientId,
  PROJECT_MEMORY_OAUTH_CLIENT_SECRET: clientSecret,
  PROJECT_MEMORY_ALLOWED_REDIRECT_URIS: redirectUri,
  PROJECT_MEMORY_AUTH_CODE_TTL_SECONDS: "300"
});

assert(oauth, "OAuth facade was not created.");

const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken,
  oauth
});

try {
  const protectedResource = await getJson(`${started.url}/.well-known/oauth-protected-resource`);
  assert(
    readNestedString(protectedResource, ["resource"]) === publicUrl,
    "Protected resource metadata returned the wrong resource."
  );
  assert(
    readNestedArray(protectedResource, ["authorization_servers"]).includes(publicUrl),
    "Protected resource metadata did not list the issuer."
  );
  console.log("ok - oauth protected resource metadata");

  const authorizationServer = await getJson(`${started.url}/.well-known/oauth-authorization-server`);
  assert(
    readNestedString(authorizationServer, ["authorization_endpoint"]) === `${publicUrl}/oauth/authorize`,
    "Authorization metadata returned the wrong authorize endpoint."
  );
  assert(
    readNestedArray(authorizationServer, ["token_endpoint_auth_methods_supported"]).includes("client_secret_post"),
    "Authorization metadata did not advertise client_secret_post."
  );
  assert(
    readNestedArray(authorizationServer, ["token_endpoint_auth_methods_supported"]).includes("client_secret_basic"),
    "Authorization metadata did not advertise client_secret_basic."
  );
  console.log("ok - oauth authorization server metadata");

  const jwks = await getJson(`${started.url}/.well-known/jwks.json`);
  assert(readNestedArray(jwks, ["keys"]).length === 1, "JWKS did not return exactly one key.");
  console.log("ok - oauth jwks");

  const unauthorized = await postJson(`${started.url}/call?client_id=${pmemClientId}`, {
    tool: "gateway.status",
    input: {}
  });
  assert(unauthorized.status === 401, "Missing auth did not return HTTP 401.");
  assert(
    unauthorized.headers.get("www-authenticate")?.includes("/.well-known/oauth-protected-resource"),
    "Missing auth did not return OAuth resource metadata challenge."
  );
  console.log("ok - oauth auth challenge");

  const codeVerifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const authorizeUrl = new URL(`${started.url}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "memory:read memory:write");
  authorizeUrl.searchParams.set("state", "oauth-smoke-state");
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("resource", publicUrl);

  const authorizeForm = await fetch(authorizeUrl);
  assert(authorizeForm.ok, "Authorize form did not return HTTP 200.");
  assert((await authorizeForm.text()).includes("Magic token"), "Authorize form did not ask for magic token.");
  console.log("ok - oauth authorize form");

  const wrongClientAuthorizeUrl = new URL(authorizeUrl);
  wrongClientAuthorizeUrl.searchParams.set("client_id", "wrong-client");
  const wrongClientAuthorizeForm = await fetch(wrongClientAuthorizeUrl);
  assert(wrongClientAuthorizeForm.status === 400, "Unexpected client_id did not return HTTP 400.");
  console.log("ok - oauth client_id allowlist");

  const invalidAuthorize = await postForm(`${started.url}/oauth/authorize`, {
    ...Object.fromEntries(authorizeUrl.searchParams.entries()),
    magic_token: "wrong"
  });
  assert(invalidAuthorize.status === 400, "Invalid magic token did not return HTTP 400.");
  const invalidAuthorizeBody = await invalidAuthorize.text();
  assert(invalidAuthorizeBody.includes("Invalid token"), "Invalid magic token returned the wrong error.");
  assert(!invalidAuthorizeBody.includes(magicToken), "Invalid authorize response leaked the magic token.");
  console.log("ok - oauth magic token rejection");

  const codeMissingSecret = await requestAuthorizationCode(started.url, authorizeUrl, magicToken);
  console.log("ok - oauth authorization code");

  const missingSecret = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: codeMissingSecret,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(missingSecret.status === 401, "Missing OAuth client_secret did not fail.");
  console.log("ok - oauth client_secret required");

  const code = await requestAuthorizationCode(started.url, authorizeUrl, magicToken);
  const token = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(token.status === 200, `Token endpoint failed: ${JSON.stringify(token.body)}`);
  const accessToken = readNestedString(token.body, ["access_token"]);
  assert(readNestedString(token.body, ["token_type"]) === "Bearer", "Token endpoint did not return Bearer token.");
  assert(!("expires_in" in (token.body as Record<string, unknown>)), "Token endpoint returned finite expires_in.");
  assert(!("exp" in jwtPayload(accessToken)), "OAuth access token included an exp claim.");
  console.log("ok - oauth token exchange");

  const reusedCode = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(reusedCode.status === 400, "Reused authorization code did not fail.");
  console.log("ok - oauth authorization code one-time use");

  const basicCode = await requestAuthorizationCode(started.url, authorizeUrl, magicToken);
  const basicToken = await postFormJsonWithHeaders(
    `${started.url}/oauth/token`,
    {
      grant_type: "authorization_code",
      code: basicCode,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      resource: publicUrl
    },
    {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    }
  );
  assert(basicToken.status === 200, `Basic client auth token exchange failed: ${JSON.stringify(basicToken.body)}`);
  console.log("ok - oauth client_secret_basic token exchange");

  const oauthCall = await postJson(
    `${started.url}/call?client_id=${pmemClientId}`,
    {
      tool: "gateway.status",
      input: {}
    },
    accessToken
  );
  assert(oauthCall.status === 200, "OAuth bearer call did not return HTTP 200.");
  assert(readNestedBoolean(oauthCall.body, ["ok"]) === true, "OAuth bearer call did not execute the tool.");
  console.log("ok - oauth bearer authorizes gateway call");

  const staticCall = await postJson(
    `${started.url}/call?client_id=${pmemClientId}`,
    {
      tool: "gateway.status",
      input: {}
    },
    staticToken
  );
  assert(staticCall.status === 200, "Static bearer token no longer authorizes gateway calls.");
  console.log("ok - static bearer still works");

  console.log(`OAuth smoke test passed using ${started.url}`);
} finally {
  await db("gateway_clients").where({ id: pmemClientId }).del();
  await new Promise<void>((resolve) => started.server.close(() => resolve()));
  await service.close();
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert(response.ok, `GET ${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function postJson(url: string, body: unknown, bearer?: string): Promise<{ status: number; headers: Headers; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body)
  });
}

async function postFormJson(url: string, body: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const response = await postForm(url, body);
  return { status: response.status, body: await response.json() };
}

async function postFormJsonWithHeaders(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers
    },
    body: new URLSearchParams(body)
  });
  return { status: response.status, body: await response.json() };
}

async function requestAuthorizationCode(startedUrl: string, authorizeUrl: URL, token: string): Promise<string> {
  const authorize = await postForm(`${startedUrl}/oauth/authorize`, {
    ...Object.fromEntries(authorizeUrl.searchParams.entries()),
    magic_token: token
  });
  assert(authorize.status === 302, "Valid magic token did not redirect with an authorization code.");
  const location = authorize.headers.get("location");
  assert(location, "Authorize redirect did not include Location.");
  const redirect = new URL(location);
  const code = redirect.searchParams.get("code");
  assert(code, "Authorize redirect did not include code.");
  assert(redirect.searchParams.get("state") === "oauth-smoke-state", "Authorize redirect did not preserve state.");
  return code;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function jwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  assert(payload, "JWT did not include a payload.");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as Record<string, unknown>;
}

function readNestedString(value: unknown, path: string[]): string {
  const current = readNested(value, path);
  assert(typeof current === "string", `Expected string at ${path.join(".")}.`);
  return current;
}

function readNestedBoolean(value: unknown, path: string[]): boolean {
  const current = readNested(value, path);
  assert(typeof current === "boolean", `Expected boolean at ${path.join(".")}.`);
  return current;
}

function readNestedArray(value: unknown, path: string[]): unknown[] {
  const current = readNested(value, path);
  assert(Array.isArray(current), `Expected array at ${path.join(".")}.`);
  return current;
}

function readNested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    assert(isRecord(current), `Expected object while reading ${path.join(".")}.`);
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
