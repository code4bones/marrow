import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../shared/errors.js";
import { asMcpResult, type ToolResponse } from "../shared/mcp/tool-response.js";
import { artifactAbsolutePath, artifactBytesMissingError, artifactOut } from "./pg-tool-service/formatters/artifacts.js";
import type { Row } from "./pg-tool-service/types.js";

export const DEFAULT_ARTIFACT_DOWNLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ARTIFACT_DOWNLOAD_BYTES = 20 * 1024 * 1024;

function isSupportedImage(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  return mime === "image/webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

// The caller resolves the row through artifactRowById/Path first, retaining
// the same project membership checks as metadata and HTTP downloads.
export async function loadArtifactDownload(row: Row, input: Row) {
  const artifact = artifactOut(row);
  const maxBytes = Number(input.maxBytes ?? DEFAULT_ARTIFACT_DOWNLOAD_BYTES);
  const absolutePath = artifactAbsolutePath(String(row.storage_path));
  const tooLarge = () => new AppError("VALIDATION_ERROR", "Artifact exceeds maxBytes; increase it explicitly or use the authenticated HTTP download.", {
    id: artifact.id, maxBytes, sizeBytes: artifact.sizeBytes, downloadPath: artifact.downloadPath
  });
  if (artifact.sizeBytes > maxBytes) throw tooLarge();
  let bytes: Buffer;
  try {
    const file = await open(absolutePath, "r");
    try {
      const size = (await file.stat()).size;
      if (size > maxBytes) throw tooLarge();
      // Bound the actual read too, even if the file grows or metadata is stale.
      bytes = Buffer.alloc(size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, null);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > maxBytes) throw tooLarge();
      bytes = bytes.subarray(0, length);
    } finally { await file.close(); }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw artifactBytesMissingError(row, absolutePath);
    throw error;
  }
  if (bytes.length !== artifact.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
    throw new AppError("ARTIFACT_CONFLICT", "Artifact bytes do not match metadata; reload metadata or restore the stored file.", { id: artifact.id });
  }
  const mimeType = artifact.contentType.split(";", 1)[0].trim().toLowerCase();
  const filename = path.posix.basename(artifact.path);
  const format = input.format === "base64" ? "base64" : isSupportedImage(bytes, mimeType) ? "image" : "resource";
  return {
    artifact,
    download: {
      format, encoding: "base64" as const, mimeType, filename,
      uri: `marrow://artifacts/${encodeURIComponent(artifact.id)}/${encodeURIComponent(filename)}`,
      sizeBytes: bytes.length, contentBase64: bytes.toString("base64")
    }
  };
}

// Native MCP content carries bytes once, outside text/structured metadata.
// Explicit base64 mode supports clients that need to decode a file locally.
export function artifactDownloadMcpResult(response: ToolResponse<unknown>) {
  if (!response.ok) return asMcpResult(response);
  const data = response.data as Awaited<ReturnType<typeof loadArtifactDownload>>;
  if (data.download.format === "base64") return asMcpResult(response);
  const { contentBase64, ...download } = data.download;
  const metadata = asMcpResult({ ...response, data: { artifact: data.artifact, download } });
  const binary = download.format === "image"
    ? { type: "image" as const, mimeType: download.mimeType, data: contentBase64 }
    : { type: "resource" as const, resource: { uri: download.uri, mimeType: download.mimeType, blob: contentBase64 } };
  return { ...metadata, content: [...metadata.content, binary] };
}
