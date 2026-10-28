import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import knex, { type Knex } from "knex";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayMcpServer } from "../src/gateway/mcp-server.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import type { GatewayRequestContext, Row } from "../src/gateway/pg-tool-service/types.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=", "base64");
const owner: GatewayRequestContext = { clientId: "user:a", sessionUserId: "a", sessionRole: "member", sessionSource: "oauth" };
let root: string, db: Knex, service: PgToolService, client: Client, server: McpServer;
class TestService extends PgToolService { protected override async touchClient(): Promise<void> {} }

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "marrow-download-"));
  vi.stubEnv("ARTIFACT_DIR", root);
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("projects", (t) => { t.text("id").primary(); t.text("slug"); t.text("title"); t.text("owner_user_id"); });
  await db.schema.createTable("project_members", (t) => { t.text("project_id"); t.text("user_id"); t.text("status"); });
  await db.schema.createTable("artifacts", (t) => {
    t.text("id").primary();
    for (const key of ["project_id", "path", "title", "content_type", "sha256", "storage_path", "status", "created_at", "updated_at"]) t.text(key);
    t.integer("size_bytes");
  });
  await db("projects").insert({ id: "P-TEST", slug: "test", title: "Test", owner_user_id: "a" });
  await db("project_members").insert({ project_id: "P-TEST", user_id: "a", status: "active" });
  service = new TestService(db);
  server = await createGatewayMcpServer(service, owner);
  client = new Client({ name: "artifact-test", version: "1" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
});
afterEach(async () => { await client.close(); await server.close(); await db.destroy(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });

async function put(id = "A-TEST", bytes = png, mime = "image/png", projectId: string | null = "P-TEST", filename = "скрин.png") {
  const row = {
    id, project_id: projectId, path: filename, title: filename, content_type: mime,
    size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    storage_path: id, status: "current", created_at: "2026-10-28T00:00:00Z", updated_at: "2026-10-28T00:00:00Z"
  };
  await db("artifacts").insert(row); await writeFile(path.join(root, id), bytes);
  return row;
}
const download = async (args: Row = { id: "A-TEST" }) => CallToolResultSchema.parse(await client.callTool({ name: "artifact.download", arguments: args }));

describe("agent artifact download", () => {
  it("returns real image content through MCP, with compact metadata and no base64 in text or structuredContent", async () => {
    const row = await put();
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === "artifact.download")).toMatchObject({ _meta: { securitySchemes: [{ scopes: ["memory:read"] }] } });
    const result = await download();
    expect(result.isError).toBeFalsy();
    expect(result.content).toContainEqual({ type: "image", mimeType: "image/png", data: png.toString("base64") });
    expect(result.structuredContent).toMatchObject({ ok: true, data: { artifact: { sha256: row.sha256 }, download: { format: "image", sizeBytes: png.length, filename: "скрин.png" } } });
    expect(JSON.stringify(result.structuredContent)).not.toContain(png.toString("base64"));
    expect(JSON.stringify(result.content.filter((c) => c.type === "text"))).not.toContain(png.toString("base64"));
  });
  it("returns exact generic bytes as an embedded resource, including an empty file", async () => {
    for (const bytes of [Buffer.from([0, 255, 1, 128]), Buffer.alloc(0)]) {
      const id = `A-BIN-${bytes.length}`;
      await put(id, bytes, "application/octet-stream", "P-TEST", "данные.bin");
      const result = await download({ id });
      expect(result.content).toContainEqual({ type: "resource", resource: {
        uri: `marrow://artifacts/${id}/${encodeURIComponent("данные.bin")}`, mimeType: "application/octet-stream", blob: bytes.toString("base64")
      } });
    }
  });
  it("offers explicit base64 for local saving and project/path lookup", async () => {
    await put();
    const result = await download({ project: "test", path: "скрин.png", format: "base64", maxBytes: png.length });
    expect(result.content.every((c) => c.type === "text")).toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: true, data: { download: { format: "base64", contentBase64: png.toString("base64") } } });
  });
  it("allows common artifacts while retaining metadata-only get and bounded text reads", async () => {
    await put("A-COMMON", Buffer.from("hello"), "text/plain", null, "hello.txt");
    expect((await download({ project: null, path: "hello.txt" })).structuredContent).toMatchObject({ ok: true, data: { download: { format: "resource" } } });
    const result = await service.call("artifact.get", { id: "A-COMMON" }, owner);
    expect(JSON.stringify(result)).not.toContain("contentBase64");
    expect(await service.call("artifact.read_text", { id: "A-COMMON" }, owner)).toMatchObject({ ok: true, data: { artifact: { text: "hello" } } });
  });
  it.each(["cookie", "personal_token", "oauth"] as const)("denies a nonmember before reading bytes with %s authentication", async (sessionSource) => {
    await put(); await rm(path.join(root, "A-TEST"));
    const denied = await service.call("artifact.download", { id: "A-TEST" }, { ...owner, sessionUserId: "outsider", sessionSource });
    expect(denied).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_FOUND" } });
    expect(JSON.stringify(denied)).not.toContain("storagePath");
    const deniedPath = await service.call("artifact.download", { project: "test", path: "скрин.png" }, { ...owner, sessionUserId: "outsider", sessionSource });
    expect(deniedPath).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_FOUND" } });
  });
  it("rejects oversized downloads using both metadata and actual file size without partial output", async () => {
    await put();
    const result = await download({ id: "A-TEST", maxBytes: png.length - 1 });
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(result.content.every((c) => c.type === "text")).toBe(true);
    await db("artifacts").where({ id: "A-TEST" }).update({ size_bytes: 1 });
    expect(await service.call("artifact.download", { id: "A-TEST", maxBytes: 1 }, owner)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
  it("reports missing/corrupt bytes and missing IDs without emitting file content", async () => {
    await put(); await writeFile(path.join(root, "A-TEST"), Buffer.alloc(png.length));
    expect(await service.call("artifact.download", { id: "A-TEST" }, owner)).toMatchObject({ ok: false, error: { code: "ARTIFACT_CONFLICT" } });
    await rm(path.join(root, "A-TEST"));
    expect(await service.call("artifact.download", { id: "A-TEST" }, owner)).toMatchObject({ ok: false, error: { code: "ARTIFACT_BYTES_MISSING" } });
    expect(await service.call("artifact.download", { id: "A-MISSING" }, owner)).toMatchObject({ ok: false, error: { code: "ARTIFACT_NOT_FOUND" } });
  });
  it.each([{}, { id: "A-TEST", maxBytes: 0 }, { id: "A-TEST", maxBytes: 20 * 1024 * 1024 + 1 }, { id: "A-TEST", format: "unknown" }])("validates selector, format and byte limits: %j", async (input) => {
    expect(await service.call("artifact.download", input, owner)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
  it("uses a resource for SVG and for content pretending to be a raster image", async () => {
    for (const mime of ["image/svg+xml", "image/png"]) {
      const id = mime === "image/png" ? "A-FAKE" : "A-SVG";
      await put(id, Buffer.from("<svg></svg>"), mime);
      expect((await download({ id })).structuredContent).toMatchObject({ ok: true, data: { download: { format: "resource" } } });
    }
  });
  it("provides the same image through the Claude-safe tool alias", async () => {
    await put(); await client.close(); await server.close();
    server = await createGatewayMcpServer(service, { ...owner, metadata: { kind: "claude" } });
    client = new Client({ name: "claude-test", version: "1" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(s), client.connect(c)]);
    const result = await client.callTool({ name: "artifact_download", arguments: { id: "A-TEST" } });
    expect(result.content).toContainEqual({ type: "image", mimeType: "image/png", data: png.toString("base64") });
  });
});
