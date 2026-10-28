import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import knex, { type Knex } from "knex";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { downloadHash } from "../src/gateway/record-downloads.js";
import type { GatewayRequestContext, Row } from "../src/gateway/pg-tool-service/types.js";
const migration = createRequire(import.meta.url)("../migrations/pg/142_download_grants.cjs");
const owner: GatewayRequestContext = { clientId: "user:a", sessionUserId: "a", sessionRole: "member", sessionSource: "oauth" };
let db: Knex, service: PgToolService, root: string, server: Awaited<ReturnType<typeof startGatewayServer>>;
const logs: unknown[] = [];
class TestService extends PgToolService { protected override async touchClient(): Promise<void> {} }
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "marrow-url-")); vi.stubEnv("ARTIFACT_DIR", root);
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await migration.up(db);
  await db.schema.createTable("users", (t) => { t.text("id"); t.text("role"); t.text("status"); });
  await db("users").insert({ id: "a", role: "member", status: "active" });
  await db.schema.createTable("project_members", (t) => { t.text("project_id"); t.text("user_id"); t.text("status"); });
  await db("project_members").insert({ project_id: "P-TEST", user_id: "a", status: "active" });
  for (const table of ["projects", "items", "tasks", "decisions", "artifacts", "events", "links", "skills"]) {
    await db.schema.createTable(table, (t) => {
      for (const key of ["id", "project_id", "slug", "title", "name", "body", "type", "status", "path", "content_type", "sha256", "storage_path", "from_id", "to_id", "relation", "created_by", "tags", "created_at", "updated_at"]) t.text(key);
      t.integer("size_bytes");
    });
  }
  for (const table of ["task_assignees", "task_performers"]) await db.schema.createTable(table, (t) => { t.text("task_id"); t.text("user_id"); t.integer("position"); });
  await db("projects").insert({ id: "P-TEST", slug: "test", title: "Project" });
  await db("tasks").insert({ id: "T-TEST", project_id: "P-TEST", title: "Task", status: "todo" });
  await db("items").insert({ id: "I-TEST", project_id: "P-TEST", title: "Markdown", body: "# Текст\nПривет\n", type: "knowledge" });
  await db("skills").insert({ id: "SK-TEST", project_id: "P-TEST", name: "Review", body: "# Skill\nInstructions\n", status: "active" });
  await db("decisions").insert({ id: "D-TEST", project_id: "P-TEST", title: "Decision" });
  await db("events").insert({ id: "E-TEST", project_id: "P-TEST", type: "task.created", title: "Event" });
  await db("links").insert({ id: "L-TEST", project_id: "P-TEST", from_id: "T-TEST", to_id: "I-TEST", relation: "relates_to" });
  await artifact("A-TEST");
  service = new TestService(db); logs.length = 0;
  const capture = (fields: unknown) => { logs.push(fields); };
  server = await startGatewayServer(service, { host: "127.0.0.1", port: 0, token: "test-token", logger: { info: capture, warn: capture, error: capture, debug: capture } as never });
  vi.stubEnv("PROJECT_MEMORY_PUBLIC_URL", server.url);
});
afterEach(async () => { vi.restoreAllMocks(); await server.stop(); await db.destroy(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
async function artifact(id: string, projectId = "P-TEST") {
  const bytes = Buffer.from([0, 255, 128, 7]);
  await db("artifacts").insert({ id, project_id: projectId, path: "files/исходник.bin", title: "File", content_type: "application/octet-stream", size_bytes: bytes.length, sha256: downloadHash(bytes), storage_path: id, status: "current" });
  await writeFile(path.join(root, id), bytes);
}
async function issue(id = "A-TEST", input: Row = {}, context = owner) {
  const result = await service.call("record.download_url", { id, ...input }, context);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.data as { download: Row; attachments: Row[]; unavailableAttachments: Row[]; instructions: string };
}
describe("temporary URLs for all record kinds", () => {
  it("returns original filename/MIME/size/hash/expiry and permits anonymous GET/HEAD/Range without consuming the URL", async () => {
    const { download: d } = await issue();
    expect(d).toMatchObject({ id: "A-TEST", filename: "исходник.bin", contentType: "application/octet-stream", sizeBytes: 4, expiresInSeconds: 300 });
    expect(new Date(String(d.expiresAt)).getTime() - Date.now()).toBeGreaterThan(299000);
    const head = await fetch(String(d.url), { method: "HEAD" }); expect(head.status).toBe(200); expect(head.headers.get("content-length")).toBe("4");
    for (let i = 0; i < 2; i++) {
      const response = await fetch(String(d.url)); expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(downloadHash(Buffer.from(await response.arrayBuffer()))).toBe(d.sha256);
    }
    const range = await fetch(String(d.url), { headers: { Range: "bytes=1-2" } }); expect(range.status).toBe(206); expect(Buffer.from(await range.arrayBuffer())).toEqual(Buffer.from([255, 128]));
    const token = new URL(String(d.url)).pathname.split("/")[3];
    expect((await new TestService(db).resolveDownloadUrl(token)).sizeBytes).toBe(4);
    expect(JSON.stringify(await db("download_grants"))).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain(token);
    expect((await fetch(`${server.url}/artifacts/A-TEST/download`)).status).toBe(401);
  });
  it.each(["P-TEST", "T-TEST", "D-TEST", "I-TEST", "SK-TEST", "E-TEST", "L-TEST"])("exports %s as Markdown and JSON", async (id) => {
    for (const format of ["markdown", "json"]) {
      const { download: d } = await issue(id, { format }); const r = await fetch(String(d.url)); expect(r.status).toBe(200);
      const bytes = Buffer.from(await r.arrayBuffer()); expect(bytes.length).toBe(d.sizeBytes); expect(downloadHash(bytes)).toBe(d.sha256);
      if (format === "json") expect(JSON.parse(bytes.toString()).id).toBe(id);
      else if (id === "SK-TEST") { expect(d.filename).toBe("Review.md"); expect(bytes.toString()).toBe("# Skill\nInstructions\n"); }
      else if (id === "I-TEST") expect(bytes.toString()).toBe("# Текст\nПривет\n");
    }
  });
  it("includes accessible attachments in either link direction and omits foreign-project files", async () => {
    await artifact("A-SECOND"); await artifact("A-FOREIGN", "P-FOREIGN");
    await db("links").insert([
      { id: "L-1", from_id: "A-TEST", to_id: "T-TEST", relation: "attached_to" },
      { id: "L-2", from_id: "T-TEST", to_id: "A-SECOND", relation: "documents" },
      { id: "L-3", from_id: "A-FOREIGN", to_id: "T-TEST", relation: "attached_to" }
    ]);
    const result = await issue("T-TEST"); expect(result.attachments.map((a) => a.id).sort()).toEqual(["A-SECOND", "A-TEST"]);
    expect((await fetch(String(result.attachments[0].url))).status).toBe(200);
    expect((await issue("T-TEST", { includeAttachments: false })).attachments).toEqual([]);
  });
  it("expires at exactly five minutes and supports issuing a fresh URL", async () => {
    const { download: d } = await issue();
    const clock = vi.spyOn(Date, "now").mockReturnValue(new Date(String(d.expiresAt)).getTime());
    expect((await fetch(String(d.url))).status).toBe(404); clock.mockRestore();
    const fresh = (await issue()).download; expect(fresh.url).not.toBe(d.url); expect((await fetch(String(fresh.url))).status).toBe(200);
  });
  it("keeps the record export available when an authorized attachment's stored bytes are missing", async () => {
    await db("links").insert({ id: "L-MISSING", from_id: "A-TEST", to_id: "I-TEST", relation: "attached_to" });
    await rm(path.join(root, "A-TEST"));
    const result = await issue("I-TEST");
    expect(result.attachments).toEqual([]); expect(result.unavailableAttachments).toEqual([{ id: "A-TEST", code: "ARTIFACT_BYTES_MISSING" }]);
    expect((await fetch(String(result.download.url))).status).toBe(200);
  });
  it.each(["membership", "disabled", "deleted", "role"])("revalidates principal access after %s changes", async (change) => {
    if (change === "role") await db("users").update({ role: "admin" });
    const { download: d } = await issue("A-TEST", {}, change === "role" ? { ...owner, sessionRole: "admin" } : owner);
    if (change === "membership") await db("project_members").del();
    if (change === "disabled") await db("users").update({ status: "disabled" });
    if (change === "deleted") await db("users").del();
    if (change === "role") { await db("project_members").del(); await db("users").update({ role: "member" }); }
    expect((await fetch(String(d.url))).status).toBe(404);
  });
  it("rejects altered tokens, filename substitution, absent records and changed bytes/exports", async () => {
    const { download: d } = await issue();
    const url = new URL(String(d.url)); const parts = url.pathname.split("/"); parts[3] = "a".repeat(43); url.pathname = parts.join("/");
    expect((await fetch(url)).status).toBe(404);
    expect((await fetch(String(d.url).replace(encodeURIComponent("исходник.bin"), "other.bin"))).status).toBe(404);
    await db("artifacts").where({ id: "A-TEST" }).update({ sha256: "changed" }); expect((await fetch(String(d.url))).status).toBe(404);
    const md = (await issue("I-TEST")).download; await db("items").where({ id: "I-TEST" }).update({ body: "changed" }); expect((await fetch(String(md.url))).status).toBe(404);
    const skill = (await issue("SK-TEST")).download; await db("skills").del(); expect((await fetch(String(skill.url))).status).toBe(404);
    expect(await service.call("record.download_url", { id: "A-TEST" }, { ...owner, sessionUserId: "outsider" })).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_FOUND" } });
    expect((await fetch(String(d.url), { method: "POST" })).status).toBe(405);
  });
  it("honors common-scope private event visibility", async () => {
    await db("events").insert({ id: "E-PRIVATE", type: "user.updated", created_by: "user:other" });
    expect(await service.call("record.download_url", { id: "E-PRIVATE" }, owner)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await db("events").where({ id: "E-PRIVATE" }).update({ created_by: "user:a" }); expect((await issue("E-PRIVATE")).download.kind).toBe("EVENT");
  });
  it("documents and executes the two-step workflow through the actual public MCP transport", async () => {
    const client = new Client({ name: "url-test", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { Authorization: "Bearer test-token" } } }));
      const list = await client.listTools(); const tool = list.tools.find((t) => t.name === "record.download_url");
      expect(tool?.description).toContain("WITHOUT Authorization"); expect(tool?.description).toContain("sizeBytes");
      const result = CallToolResultSchema.parse(await client.callTool({ name: "record.download_url", arguments: { id: "A-TEST" } }));
      expect(result.structuredContent).toMatchObject({ ok: true });
      const data = result.structuredContent!.data as Row; const file = data.download as Row;
      expect((await fetch(String(file.url))).status).toBe(200);
    } finally { await client.close(); }
  });
});
