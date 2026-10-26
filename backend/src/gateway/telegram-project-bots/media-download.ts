import { get, type Agent } from "node:https";
import { AppError } from "../../shared/errors.js";
import { telegramClientOptions } from "../telegram.js";
import { projectTelegramApi } from "./remote.js";
import { telegramRequest } from "./request.js";

export async function downloadTelegramFile(token: string, fileId: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const file = await telegramRequest(deadline, (s) => projectTelegramApi(token).getFile(fileId, s));
  if (file.file_size && file.file_size > maxBytes) throw new AppError("VALIDATION_ERROR", "TELEGRAM_FILE_TOO_LARGE");
  if (!file.file_path || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(file.file_path) || file.file_path.split("/").includes(".."))
    throw new AppError("VALIDATION_ERROR", "TELEGRAM_FILE_PATH_INVALID");
  const agent = (telegramClientOptions().baseFetchConfig as { agent?: Agent } | undefined)?.agent;
  // The URL contains the credential. Never expose it through native HTTP errors.
  return new Promise((resolve, reject) => {
    const fail = (code: string) => reject(new AppError("GATEWAY_ERROR", code));
    const request = get(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { agent, signal: deadline }, (response) => {
      response.once("error", () => fail("TELEGRAM_FILE_DOWNLOAD_FAILED"));
      response.once("aborted", () => fail("TELEGRAM_FILE_DOWNLOAD_FAILED"));
      if (response.statusCode !== 200) { response.resume(); fail("TELEGRAM_FILE_DOWNLOAD_FAILED"); return; }
      if (Number(response.headers["content-length"] ?? 0) > maxBytes) { response.destroy(); fail("TELEGRAM_FILE_TOO_LARGE"); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); fail("TELEGRAM_FILE_TOO_LARGE"); } else chunks.push(chunk);
      });
      response.once("end", () => resolve(Buffer.concat(chunks)));
    });
    request.once("error", () => fail("TELEGRAM_FILE_DOWNLOAD_FAILED"));
  });
}
