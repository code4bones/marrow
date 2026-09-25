import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// T-MEMORY-175 (SSRF, DNS rebinding): the address that is validated must be the
// address that is connected to. The resolver lives in git-host-safety.ts and is
// exercised here both with a faked DNS (the rebinding scenario) and against a
// real local server.
const answers = new Map<string, string[]>();
vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  return {
    ...real,
    lookup: (hostname: string, options: unknown, callback: (e: Error | null, r: unknown) => void) => {
      const fake = answers.get(hostname);
      if (!fake) {
        return (real.lookup as (...args: unknown[]) => void)(hostname, options, callback);
      }
      return callback(null, fake.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
    }
  };
});

import { guardedLookup, pinnedFetch } from "../src/gateway/git-host-safety.js";

const lookup = (host: string, all = false) =>
  new Promise<{ error: NodeJS.ErrnoException | null; result: unknown }>((resolve) => {
    guardedLookup(host, { all }, (error, result) => resolve({ error, result }));
  });

describe("guardedLookup (the resolver the git socket uses)", () => {
  it("refuses a name that resolves to a private/loopback/metadata address", async () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.10", "::1", "fd00::1"]) {
      answers.set("rebind.test", [address]);
      const { error } = await lookup("rebind.test");
      expect(error?.code, address).toBe("ECONNREFUSED");
      expect(error?.message).toMatch(/non-public/);
    }
  });

  it("refuses a mixed answer if ANY address is non-public (no picking the safe one)", async () => {
    answers.set("mixed.test", ["93.184.216.34", "127.0.0.1"]);
    expect((await lookup("mixed.test")).error?.code).toBe("ECONNREFUSED");
    expect((await lookup("mixed.test", true)).error?.code).toBe("ECONNREFUSED");
  });

  it("re-validates on EVERY resolution (public first, private second = rebinding)", async () => {
    answers.set("flip.test", ["93.184.216.34"]);
    expect((await lookup("flip.test")).error).toBeNull();
    answers.set("flip.test", ["127.0.0.1"]);
    expect((await lookup("flip.test")).error?.code).toBe("ECONNREFUSED");
  });

  it("hands back exactly the validated address, in both callback shapes", async () => {
    answers.set("ok.test", ["93.184.216.34"]);
    const single = await lookup("ok.test");
    expect(single.error).toBeNull();
    expect(single.result).toBe("93.184.216.34");
    const all = await lookup("ok.test", true);
    expect(all.result).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("GIT_ALLOW_PRIVATE_HOSTS=1 lets a private-network GitLab through", async () => {
    answers.set("intranet.test", ["10.1.2.3"]);
    process.env.GIT_ALLOW_PRIVATE_HOSTS = "1";
    try {
      expect((await lookup("intranet.test")).error).toBeNull();
    } finally {
      delete process.env.GIT_ALLOW_PRIVATE_HOSTS;
    }
  });
});

describe("pinnedFetch against a real local server", () => {
  const server = createServer((_request, response) => response.end("reached"));
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("cannot reach a loopback server through a hostname (connect-time guard)", async () => {
    answers.set("loop.test", ["127.0.0.1"]);
    await expect(pinnedFetch(`http://loop.test:${port}/`)).rejects.toThrow();
  });

  it("refuses IP literals (no resolver involved) incl. obfuscated forms, before any connection", async () => {
    for (const target of [
      `http://127.0.0.1:${port}/`, "http://[::1]/", "http://169.254.169.254/latest/meta-data/",
      "http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://[::ffff:127.0.0.1]/", "http://10.0.0.5/"
    ]) {
      await expect(pinnedFetch(target), target).rejects.toThrow(/non-public/);
    }
  });

  it("does reach it when private hosts are explicitly allowed", async () => {
    answers.set("loop.test", ["127.0.0.1"]);
    process.env.GIT_ALLOW_PRIVATE_HOSTS = "1";
    try {
      const response = await pinnedFetch(`http://loop.test:${port}/`);
      expect(await response.text()).toBe("reached");
    } finally {
      delete process.env.GIT_ALLOW_PRIVATE_HOSTS;
    }
  });
});
