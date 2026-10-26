import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startGatewayServer } from "../src/gateway/http-server.js";
import type { PgToolService } from "../src/gateway/pg-tool-service.js";
import { AppError } from "../src/shared/errors.js";

let root: string;
let server: Awaited<ReturnType<typeof startGatewayServer>>;
const artifactDownload = vi.fn();
const headers = { Authorization: "Bearer artifact-test-token" };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "marrow-artifact-http-"));
  await writeFile(path.join(root, "file"), Buffer.from("0123456789"));
  artifactDownload.mockReset().mockImplementation(async (id: string) => {
    if (id === "denied") throw new AppError("UNAUTHORIZED", "Project is not accessible");
    return { artifact: { id, path: id === "pdf" ? "документ.pdf" : "file.jpg", contentType: id === "html" ? "text/html" : id === "svg" ? "image/svg+xml" : id === "pdf" ? "application/pdf" : "image/jpeg", sha256: "hash" }, absolutePath: path.join(root, "file") };
  });
  server = await startGatewayServer({ artifactDownload } as unknown as PgToolService, { host: "127.0.0.1", port: 0, token: "artifact-test-token" });
});
afterEach(async () => { await server?.stop(); await rm(root, { recursive: true, force: true }); });
const url = (id = "image", query = "") => `${server.url}/artifacts/${id}/download${query}`;

describe("authenticated artifact native previews", () => {
  it("keeps ordinary downloads as attachments and renders a requested image inline", async () => {
    const download = await fetch(url(), { headers });
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(await download.text()).toBe("0123456789");
    const preview = await fetch(url("image", "?inline=1"), { headers });
    expect(preview.status).toBe(200); expect(preview.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
    expect(preview.headers.get("cache-control")).toContain("private");
    expect(await preview.text()).toBe("0123456789");
  });
  it("authenticates HEAD and GET before revealing file metadata and retains per-project access checks", async () => {
    for (const method of ["GET", "HEAD"]) {
      const anonymous = await fetch(url(), { method }); expect(anonymous.status).toBe(401);
    }
    expect(artifactDownload).not.toHaveBeenCalled();
    const head = await fetch(url("image", "?inline=1"), { method: "HEAD", headers });
    expect(head.status).toBe(200); expect(head.headers.get("content-length")).toBe("10"); expect(await head.text()).toBe("");
    expect((await fetch(url("denied", "?inline=1"), { headers })).status).toBe(401);
    expect((await fetch(url("denied", "?inline=1"), { headers, method: "HEAD" })).status).toBe(401);
  });
  it.each(["html", "svg"])("never renders active %s content inline", async (id) => {
    const r = await fetch(url(id, "?inline=1"), { headers }); expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment;/); await r.arrayBuffer();
  });
  it("supports PDF inline and encodes international filenames without invalid HTTP headers", async () => {
    const r = await fetch(url("pdf", "?inline=1"), { headers });
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent("документ.pdf")}`); await r.arrayBuffer();
  });
  it("serves byte ranges for native player seeking, including suffix ranges", async () => {
    for (const [range, expected, contentRange] of [["bytes=2-4", "234", "bytes 2-4/10"], ["bytes=-2", "89", "bytes 8-9/10"], ["bytes=8-", "89", "bytes 8-9/10"]]) {
      const r = await fetch(url(), { headers: { ...headers, Range: range } });
      expect(r.status).toBe(206); expect(r.headers.get("content-range")).toBe(contentRange); expect(await r.text()).toBe(expected);
    }
    const invalid = await fetch(url(), { headers: { ...headers, Range: "bytes=20-30" } });
    expect(invalid.status).toBe(416); expect(invalid.headers.get("content-range")).toBe("bytes */10"); expect(await invalid.text()).toBe("");
  });
});
