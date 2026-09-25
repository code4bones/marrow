// OAuth redirect_uri sanity check. The consent page and authorizeWithSession
// both end in a browser navigation to this value, so a `javascript:`/`data:`
// URI registered as a connector's redirect_uri (or smuggled into the consent
// page's query string) would run script on the Marrow origin. Only http(s)
// is ever a legitimate connector callback here, and plain http only for a
// loopback host (local dev connectors).

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Returns a human-readable reason when the value must be rejected, or null
// when it is acceptable.
export function redirectUriProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "redirect_uri must be an absolute URL.";
  }
  if (url.protocol === "https:") {
    // ok
  } else if (url.protocol === "http:") {
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      return "redirect_uri must use https (http is only allowed for localhost).";
    }
  } else {
    return "redirect_uri must use https.";
  }
  if (url.username || url.password) {
    return "redirect_uri must not contain credentials.";
  }
  if (url.hash) {
    return "redirect_uri must not contain a fragment.";
  }
  return null;
}
