import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ArtifactDownload } from "./pg-tool-service/formatters/artifacts.js";

// Only browser-native, passive file viewers. HTML and SVG remain downloads or
// escaped text, never an active same-origin document.
export function canPreviewArtifactInline(contentType: string): boolean {
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  return ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon", "application/pdf"].includes(mime)
    || /^(?:audio|video)\/[a-z0-9.+-]+$/.test(mime);
}

export function disposition(filename: string, inline: boolean): string {
  const clean = [...filename].map((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '"' || c === "\\" ? "_" : c).join("");
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function byteRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}

// Caller must resolve artifactDownload first: both HEAD and GET retain normal
// authentication and project membership checks. Native viewers reuse cookies.
export async function sendArtifactFile(request: IncomingMessage, response: ServerResponse,
  download: ArtifactDownload, requestId: string, onFinish?: () => void, temporary = false): Promise<void> {
  const fileStat = await stat(download.absolutePath);
  if (onFinish) response.once("finish", onFinish);
  const inline = new URL(request.url ?? "/", "http://gateway").searchParams.get("inline") === "1"
    && canPreviewArtifactInline(download.artifact.contentType);
  const headers: Record<string, string | number> = {
    "content-type": download.artifact.contentType,
    "content-length": fileStat.size,
    "content-disposition": disposition(path.posix.basename(download.artifact.path), inline),
    "cache-control": temporary ? "private, no-store" : "private, no-cache",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
    "x-request-id": requestId,
    "x-artifact-id": download.artifact.id,
    "x-artifact-sha256": download.artifact.sha256
  };
  const rangeHeader = request.method === "GET" && typeof request.headers.range === "string" ? request.headers.range : null;
  const range = rangeHeader ? byteRange(rangeHeader, fileStat.size) : undefined;
  if (range === null) {
    response.writeHead(416, { ...headers, "content-range": `bytes */${fileStat.size}`, "content-length": 0 }); response.end(); return;
  }
  if (range) {
    headers["content-range"] = `bytes ${range.start}-${range.end}/${fileStat.size}`;
    headers["content-length"] = range.end - range.start + 1;
  }
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD" || fileStat.size === 0) { response.end(); return; }
  const stream = createReadStream(download.absolutePath, range);
  stream.once("error", () => response.destroy());
  response.once("close", () => stream.destroy());
  stream.pipe(response);
}
