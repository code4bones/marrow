import type { IncomingMessage, ServerResponse } from "node:http";
import { byteRange, disposition, sendArtifactFile } from "./artifact-file-response.js";
import type { ArtifactDownload } from "./pg-tool-service/formatters/artifacts.js";
import type { DownloadFile } from "./record-downloads.js";

export async function sendRecordDownload(request: IncomingMessage, response: ServerResponse, file: DownloadFile, requestId: string, onFinish: () => void) {
  response.setHeader("referrer-policy", "no-referrer");
  if (file.absolutePath && file.artifact) {
    return sendArtifactFile(request, response, { absolutePath: file.absolutePath, artifact: file.artifact as ArtifactDownload["artifact"] }, requestId, onFinish, true);
  }
  const bytes = file.bytes!;
  const headers: Record<string, string | number> = {
    "content-type": file.contentType, "content-disposition": disposition(file.filename, false),
    "content-length": bytes.length, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    "x-content-sha256": file.sha256, "x-request-id": requestId, "accept-ranges": "bytes"
  };
  response.once("finish", onFinish);
  const range = request.method === "GET" && typeof request.headers.range === "string" ? byteRange(request.headers.range, bytes.length) : undefined;
  if (range === null) { response.writeHead(416, { ...headers, "content-range": `bytes */${bytes.length}`, "content-length": 0 }); response.end(); return; }
  if (range) { headers["content-range"] = `bytes ${range.start}-${range.end}/${bytes.length}`; headers["content-length"] = range.end - range.start + 1; }
  response.writeHead(range ? 206 : 200, headers);
  response.end(request.method === "HEAD" ? undefined : range ? bytes.subarray(range.start, range.end + 1) : bytes);
}
