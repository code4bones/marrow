import { lookup as lookupCallback, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { AppError } from "../shared/errors.js";

// The git `host` string is user-supplied (git.credential_create) and is put
// straight into an outbound `https://<host>/api/v4/...` request whose body is
// returned to the caller (job trace, artifacts). Unchecked, a member could
// point it at `10.0.0.5:8443/internal/x#` or at a public server that 302s to
// http://169.254.169.254/... (SEC-6). So: the host must be a plain
// hostname[:port], must not resolve to a private/loopback/link-local address,
// and redirects are never followed (see gitlabRequest).

const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const HOST_PATTERN = new RegExp(`^${LABEL}(?:\\.${LABEL})*(?::(\\d{1,5}))?$`);

export function gitHostProblem(host: string): string | null {
  const match = HOST_PATTERN.exec(host);
  if (!match || host.length > 253 + 6) {
    return "Git host must be a plain hostname (optionally :port) -- no scheme, path, query, fragment or credentials.";
  }
  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (port < 1 || port > 65535) {
      return "Git host has an invalid port.";
    }
  }
  return null;
}

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((total, part) => total * 256 + Number(part), 0);
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3] // multicast + reserved + broadcast
];

// True for loopback, private, link-local (incl. cloud metadata), CGNAT,
// documentation, multicast and unspecified addresses -- v4, v6 and v4-mapped v6.
export function isNonPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const value = ipv4ToNumber(address);
    return V4_BLOCKS.some(([base, bits]) => {
      const size = 2 ** (32 - bits);
      return value >= ipv4ToNumber(base) && value < ipv4ToNumber(base) + size;
    });
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) {
      return isNonPublicAddress(mapped[1]);
    }
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (mappedHex) {
      const high = parseInt(mappedHex[1], 16);
      const low = parseInt(mappedHex[2], 16);
      return isNonPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    if (lower === "::" || lower === "::1") {
      return true;
    }
    const firstGroup = parseInt(lower.split(":")[0] || "0", 16);
    return (
      (firstGroup & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (firstGroup & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (firstGroup & 0xff00) === 0xff00 || // ff00::/8 multicast
      lower.startsWith("2001:db8:") // documentation
    );
  }
  // Not an IP literal at all: treat as unusable rather than public.
  return true;
}

// Resolves the host and refuses it if ANY address it maps to is non-public.
// (Resolve-then-connect leaves a narrow DNS-rebinding window; redirects and
// the format check above close the practical routes.) An operator with a
// GitLab on a private network opts in with GIT_ALLOW_PRIVATE_HOSTS=1.
export async function assertPublicGitHost(host: string): Promise<void> {
  if (process.env.GIT_ALLOW_PRIVATE_HOSTS === "1") {
    return;
  }
  const hostname = host.replace(/:\d+$/, "");
  let addresses: string[];
  try {
    addresses = (await lookup(hostname, { all: true })).map((entry) => entry.address);
  } catch (error) {
    throw new AppError(
      "GATEWAY_ERROR",
      `Could not resolve git host ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
      { host }
    );
  }
  if (addresses.length === 0 || addresses.some(isNonPublicAddress)) {
    throw new AppError("VALIDATION_ERROR", `Git host ${hostname} resolves to a non-public address, which is not allowed.`, {
      host
    });
  }
}

// --- Connect-time pinning (DNS rebinding) ------------------------------------
//
// assertPublicGitHost above resolves the name and checks the answer, but the
// HTTP client then resolves it AGAIN to connect: an attacker who runs the DNS
// for their own domain can answer with a public address for the check and with
// 127.0.0.1 / 169.254.169.254 for the connection. This agent closes that gap
// by doing the check INSIDE the resolver the socket uses: the connection goes
// to exactly the addresses that were validated (TLS still verifies the
// certificate against the original hostname, since the URL is untouched).
// IP-literal hosts never reach a resolver, so assertPublicGitHost (which does
// handle literals) remains the first line of defence for those.

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

export function guardedLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  lookupCallback(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const list = addresses as LookupAddress[];
    if (process.env.GIT_ALLOW_PRIVATE_HOSTS !== "1" && (list.length === 0 || list.some((entry) => isNonPublicAddress(entry.address)))) {
      const refused: NodeJS.ErrnoException = new Error(`Git host ${hostname} resolves to a non-public address, which is not allowed.`);
      refused.code = "ECONNREFUSED";
      callback(refused, "", 0);
      return;
    }
    if (options.all) {
      callback(null, list);
      return;
    }
    callback(null, list[0].address, list[0].family);
  });
}

const pinnedAgent = new Agent({ connect: { lookup: guardedLookup } });

// fetch() with the guarded resolver. Uses undici's own fetch together with
// undici's own Agent (mixing Node's bundled fetch with a package Agent is not
// supported across versions).
export function pinnedFetch(input: string | URL, init: Record<string, unknown> = {}): Promise<Response> {
  // An IP literal never goes through a resolver, so refuse a non-public one
  // here (the URL parser has already normalised 0x7f.1 / 2130706433 / [::1]).
  const bareHost = new URL(String(input)).hostname.replace(/^\[|\]$/g, "");
  if (isIP(bareHost) && process.env.GIT_ALLOW_PRIVATE_HOSTS !== "1" && isNonPublicAddress(bareHost)) {
    return Promise.reject(new AppError("VALIDATION_ERROR", `Git host ${bareHost} is a non-public address, which is not allowed.`, { host: bareHost }));
  }
  return undiciFetch(input, { ...init, dispatcher: pinnedAgent } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}
