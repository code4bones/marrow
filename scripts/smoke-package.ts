import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), "project-memory-mcp-package-"));
const packDir = join(tempDir, "pack");
const extractDir = join(tempDir, "extract");

mkdirSync(packDir);
mkdirSync(extractDir);

try {
  execFileSync("npm", ["pack", "--pack-destination", packDir], {
    cwd: repoRoot,
    stdio: "pipe"
  });

  const tarball = readdirSync(packDir).find((file) => file.endsWith(".tgz"));
  assert(tarball, "npm pack did not produce a tarball.");
  const tarballPath = join(packDir, tarball);

  execFileSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
    stdio: "pipe"
  });

  const installedPackageRoot = join(extractDir, "package");
  symlinkSync(join(repoRoot, "node_modules"), join(installedPackageRoot, "node_modules"), "dir");

  assert(existsSync(join(installedPackageRoot, "docs", "AGENT_STATE_MACHINE.md")), "docs were not packaged.");
  assert(existsSync(join(installedPackageRoot, "migrations", "001_init.sql")), "migrations were not packaged.");
  assert(existsSync(join(installedPackageRoot, "dist", "src", "index.js")), "server entrypoint was not packaged.");

  await runInstalledServerSmoke(installedPackageRoot);

  console.log(`Package smoke test passed using ${tarballPath}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

async function runInstalledServerSmoke(installedPackageRoot: string): Promise<void> {
  const dbPath = join(tempDir, "package-smoke.sqlite");
  const serverPath = join(installedPackageRoot, "dist", "src", "index.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: extractDir,
    env: {
      ...process.env,
      PROJECT_MEMORY_DB: dbPath,
      PROJECT_MEMORY_LOG_LEVEL: "silent"
    },
    stderr: "pipe"
  });
  const client = new Client({
    name: "project-memory-mcp-package-smoke",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert(toolNames.includes("project.create"), "Installed server did not list project.create.");
    assert(toolNames.includes("preflight"), "Installed server did not list preflight.");

    const projectResult = await client.callTool({
      name: "project.create",
      arguments: {
        slug: "project-memory-mcp-package",
        title: "Project Memory MCP Package"
      }
    });
    assertOk(projectResult.structuredContent, "project.create failed on installed package.");

    const currentResult = await client.callTool({
      name: "project.set_current",
      arguments: {
        slug: "project-memory-mcp-package"
      }
    });
    assertOk(currentResult.structuredContent, "project.set_current failed on installed package.");

    const taskResult = await client.callTool({
      name: "task.create",
      arguments: {
        title: "Verify package install",
        scope: "Verify installed package can run migrations and tools.",
        acceptance: "Installed package responds over stdio."
      }
    });
    assertOk(taskResult.structuredContent, "task.create failed on installed package.");
    const taskId = readNestedString(taskResult.structuredContent, ["data", "task", "id"]);

    const preflightResult = await client.callTool({
      name: "preflight",
      arguments: {
        taskId
      }
    });
    assertOk(preflightResult.structuredContent, "preflight failed on installed package.");

    console.log(`ok - installed package listed ${toolNames.length} tools`);
    console.log(`ok - installed package workflow completed for ${taskId}`);
  } finally {
    await client.close();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertOk(value: unknown, message: string): void {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(`${message} Response: ${JSON.stringify(value)}`);
  }
}

function readNestedString(value: unknown, path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      throw new Error(`Expected object while reading ${path.join(".")}.`);
    }
    current = current[key];
  }

  if (typeof current !== "string") {
    throw new Error(`Expected string at ${path.join(".")}.`);
  }

  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
