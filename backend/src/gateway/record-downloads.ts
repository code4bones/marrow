import { createHash } from "node:crypto";
import type { Row } from "./pg-tool-service/types.js";

export const DOWNLOAD_URL_TTL_SECONDS = 300;
export const downloadHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function downloadBaseUrl(): string {
  const raw = process.env.PROJECT_MEMORY_PUBLIC_URL;
  if (!raw) throw new Error("PROJECT_MEMORY_PUBLIC_URL must be configured to issue absolute download URLs.");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("PROJECT_MEMORY_PUBLIC_URL must be an HTTP(S) base URL without credentials, query or fragment.");
  }
  return url.href.replace(/\/+$/, "");
}

export function exportRecordFile(lookup: Row, format: string) {
  const record = { ...(lookup.record as Row) };
  delete record.__typename;
  const json = format === "json";
  // Skills and memory carry the original instruction/document body.
  const text = json ? JSON.stringify(record, null, 2) + "\n"
    : ["SKILL", "MEMORY"].includes(String(lookup.kind)) && typeof record.body === "string" ? record.body
    : `# ${String(record.title ?? record.name ?? record.id)}\n\n` + Object.entries(record).map(([key, value]) =>
      `## ${key}\n\n${typeof value === "string" ? value : "```json\n" + JSON.stringify(value, null, 2) + "\n```"}\n`
    ).join("\n");
  const name = [...String(lookup.kind === "SKILL" ? record.name ?? record.id : record.id)]
    .map((c) => c === "/" || c === "\\" || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? "_" : c).join("");
  const filename = `${name.replace(/\.(?:md|json)$/i, "")}.${json ? "json" : "md"}`;
  const bytes = Buffer.from(text, "utf8");
  return { filename, contentType: json ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8", sizeBytes: bytes.length, sha256: downloadHash(bytes), bytes };
}

export interface DownloadFile {
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  bytes?: Buffer;
  absolutePath?: string;
  artifact?: Row;
}
