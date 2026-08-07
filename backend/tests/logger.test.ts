import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayLogger } from "../src/shared/logging/logger.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("gateway logger", () => {
  it("writes structured logs to a file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "project-memory-logger-"));
    const logPath = join(tempDir, "gateway.log");
    const logger = createGatewayLogger({
      console: false,
      filePath: logPath,
      level: "info"
    });

    logger.info({ requestId: "test-request" }, "logger smoke");
    logger.flush();
    await waitForFile(logPath);

    const line = readFileSync(logPath, "utf8").trim();
    expect(line).toContain("logger smoke");
    expect(JSON.parse(line)).toMatchObject({
      level: 30,
      requestId: "test-request",
      service: "project-memory-gateway"
    });
  });
});

async function waitForFile(path: string): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (existsSync(path) && readFileSync(path, "utf8").trim().length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
