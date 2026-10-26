import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { get } from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectTelegramApi } from "../src/gateway/telegram-project-bots/remote.js";
import { downloadTelegramFile } from "../src/gateway/telegram-project-bots/media-download.js";

vi.mock("node:https", async (original) => ({ ...await original<typeof import("node:https")>(), get: vi.fn() }));
vi.mock("../src/gateway/telegram-project-bots/remote.js", () => ({ projectTelegramApi: vi.fn() }));
const getFile = vi.fn();
const httpGet = vi.mocked(get);
let status: number;
let headers: Record<string, string>;
let chunks: Buffer[];
beforeEach(() => {
  status = 200; headers = {}; chunks = [Buffer.from("file")];
  getFile.mockReset().mockResolvedValue({ file_path: "documents/file.pdf", file_size: 4 });
  vi.mocked(projectTelegramApi).mockReturnValue({ getFile } as unknown as ReturnType<typeof projectTelegramApi>);
  httpGet.mockReset().mockImplementation(((_url: unknown, _options: unknown, callback: (r: Readable) => void) => {
    const request = new EventEmitter();
    queueMicrotask(() => callback(Object.assign(Readable.from(chunks), { statusCode: status, headers })));
    return request;
  }) as unknown as typeof get);
  vi.stubEnv("TELEGRAM_BOT_PROXY", "http://127.0.0.1:8888");
});
afterEach(() => vi.unstubAllEnvs());
describe("Telegram attachment transport", () => {
  it("uses grammY getFile and the configured classic HTTPS proxy for binary bytes", async () => {
    expect(await downloadTelegramFile("123:fake", "file-id", 10, new AbortController().signal)).toEqual(Buffer.from("file"));
    expect(getFile).toHaveBeenCalledWith("file-id", expect.anything());
    const args = httpGet.mock.calls[0];
    expect(args[0]).toBe("https://api.telegram.org/file/bot123:fake/documents/file.pdf");
    expect((args[1] as { agent: object }).agent.constructor.name).toBe("HttpsProxyAgent");
  });
  it("rejects oversized metadata before downloading and bounds an unannounced response", async () => {
    await expect(downloadTelegramFile("123:fake", "file-id", 3, new AbortController().signal)).rejects.toThrow("TELEGRAM_FILE_TOO_LARGE");
    expect(httpGet).not.toHaveBeenCalled();
    getFile.mockResolvedValue({ file_path: "documents/file.pdf" }); chunks = [Buffer.alloc(6), Buffer.alloc(6)];
    await expect(downloadTelegramFile("123:fake", "file-id", 10, new AbortController().signal)).rejects.toThrow("TELEGRAM_FILE_TOO_LARGE");
  });
  it("rejects API file path traversal and redirects without sending credentials elsewhere", async () => {
    getFile.mockResolvedValue({ file_path: "../secret" });
    await expect(downloadTelegramFile("123:fake", "file-id", 10, new AbortController().signal)).rejects.toThrow("TELEGRAM_FILE_PATH_INVALID");
    expect(httpGet).not.toHaveBeenCalled();
    getFile.mockResolvedValue({ file_path: "documents/file.pdf" }); status = 302; headers = { location: "https://other.test/" };
    await expect(downloadTelegramFile("123:fake", "file-id", 10, new AbortController().signal)).rejects.toThrow("TELEGRAM_FILE_DOWNLOAD_FAILED");
    expect(httpGet).toHaveBeenCalledOnce();
  });
  it("redacts native HTTP errors which may contain the bot credential", async () => {
    httpGet.mockImplementation((() => {
      const request = new EventEmitter(); queueMicrotask(() => request.emit("error", new Error("https://api.telegram.org/file/bot123:fake/documents/file.pdf"))); return request;
    }) as unknown as typeof get);
    await expect(downloadTelegramFile("123:fake", "file-id", 10, new AbortController().signal)).rejects.toThrow(/^TELEGRAM_FILE_DOWNLOAD_FAILED$/);
  });
});
