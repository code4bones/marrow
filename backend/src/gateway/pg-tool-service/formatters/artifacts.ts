import { existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../../shared/errors.js";
import { dateStringOrNull, stringArray, stringOrNull, tokenEfficiencyBase } from "./common.js";
import type { Row } from "../types.js";

export interface ArtifactDownload {
  artifact: ReturnType<typeof artifactOut>;
  absolutePath: string;
}

export function artifactOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    scope: row.project_id ? "project" : "common",
    path: String(row.path),
    title: String(row.title),
    description: stringOrNull(row.description),
    status: typeof row.status === "string" ? row.status : "active",
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    sha256: String(row.sha256),
    tags: stringArray(row.tags),
    downloadPath: `/artifacts/${encodeURIComponent(String(row.id))}/download`,
    archivedAt: dateStringOrNull(row.archived_at),
    archivedBy: stringOrNull(row.archived_by),
    archiveReason: stringOrNull(row.archive_reason),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}


export function artifactSearchOut(row: Row) {
  return {
    ...artifactOut(row),
    rank: Number(row.rank ?? 0)
  };
}


// T-MEMORY-063: none of sha256/downloadPath/preferredNextTool/contentType/
// sizeBytes help decide whether to open an artifact -- only id/path/title/
// tags do. Full metadata is still available via artifact.get/peek.
export function compactArtifactRecord(record: Row) {
  return {
    id: String(record.id),
    path: String(record.path),
    title: String(record.title),
    tags: stringArray(record.tags)
  };
}


export function compactArtifactSearchRecord(record: Row) {
  return {
    ...compactArtifactRecord(record),
    rank: Number(record.rank ?? 0)
  };
}


export function preferredArtifactReadTool(record: Row) {
  const contentType = String(record.contentType ?? record.content_type ?? "");
  const artifactPath = String(record.path ?? "");
  return isTextArtifact(contentType, artifactPath) ? "artifact.read_text" : "artifact.peek";
}


export function artifactWriteEfficiencyHints(tool: "artifact.put" | "artifact.put_text") {
  return tokenEfficiencyBase({
    strategy: tool === "artifact.put_text" ? "text-without-base64" : "exact-bytes-or-binary",
    base64Included: tool === "artifact.put",
    warnings:
      tool === "artifact.put_text"
        ? ["Text was stored without base64. Prefer artifact.read_text for future reads."]
        : ["Base64 upload was used. Prefer artifact.put_text for UTF-8 Markdown/text artifacts."],
    preferredNextTools: ["artifact.peek", "artifact.read_text", "artifact.search"]
  });
}


export function artifactGetEfficiencyHints(input: Row, artifact: Row) {
  const base64Included = typeof artifact.contentBase64 === "string";
  const estimatedChars = JSON.stringify(artifact).length;
  const warnings = base64Included
    ? [
        "Inline base64 content was returned. Use artifact.peek or artifact.read_text for Markdown/text unless exact bytes are required.",
        "Compact the chat after consuming base64 content."
      ]
    : ["Only artifact metadata was returned. Use artifact.peek or artifact.read_text before requesting includeContent=true."];
  return tokenEfficiencyBase({
    severity: base64Included || input.includeContent === true ? "warn" : "info",
    strategy: base64Included ? "base64-inline-content" : "metadata-only",
    fullBodiesIncluded: base64Included,
    base64Included,
    estimatedChars,
    warnings,
    preferredNextTools: ["artifact.peek", "artifact.read_text"],
    compactAfterThis: base64Included || estimatedChars > 12_000
  });
}


export function artifactPeekEfficiencyHints(artifact: Row) {
  const estimatedChars = JSON.stringify(artifact).length;
  const preview = (artifact.preview ?? {}) as Row;
  const truncated = preview.truncated === true;
  return tokenEfficiencyBase({
    strategy: "bounded-preview-no-base64",
    estimatedChars,
    warnings: truncated
      ? ["Preview was truncated. Read full text only if this selected artifact is necessary for the task."]
      : ["Preview stayed within bounded defaults. Prefer this before artifact.read_text."],
    preferredNextTools: truncated ? ["artifact.read_text", "context.pack"] : ["artifact.search", "context.pack"],
    compactAfterThis: estimatedChars > 12_000
  });
}


export function artifactReadTextEfficiencyHints(artifact: Row) {
  const estimatedChars = JSON.stringify(artifact).length;
  const textInfo = (artifact.textInfo ?? {}) as Row;
  const truncated = textInfo.truncated === true;
  const readBytes = Number(textInfo.readBytes ?? 0);
  const warnings = [
    "Full text was read without base64. Keep only task-relevant excerpts in working context.",
    ...(truncated ? ["Text was truncated. Increase maxChars/maxLines only after confirming this file is required."] : []),
    ...(estimatedChars > 12_000 || readBytes > 24_000 ? ["Large text read detected. Compact the chat before implementation."] : [])
  ];
  return tokenEfficiencyBase({
    severity: estimatedChars > 12_000 || readBytes > 24_000 ? "warn" : "info",
    strategy: "bounded-text-no-base64",
    fullBodiesIncluded: true,
    base64Included: false,
    estimatedChars,
    warnings,
    preferredNextTools: ["context.pack", "handoff.create"],
    compactAfterThis: estimatedChars > 12_000 || readBytes > 24_000
  });
}


export function normalizeArtifactPath(value: string): string {
  const withoutLeadingSlash = value.replace(/^\/+/, "");
  if (withoutLeadingSlash.includes("\0") || withoutLeadingSlash.includes("\\")) {
    throw new AppError("VALIDATION_ERROR", "Artifact path contains invalid characters.", { path: value });
  }
  const normalized = path.posix.normalize(withoutLeadingSlash);
  if (
    normalized === "." ||
    normalized.length === 0 ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new AppError("VALIDATION_ERROR", "Artifact path must be a safe relative path.", { path: value });
  }
  return normalized;
}


export function artifactStoragePath(projectSlug: string | null, artifactPath: string): string {
  return path.posix.join(projectSlug ?? "common", artifactPath);
}


export function artifactAbsolutePath(storagePath: string): string {
  const root = path.resolve(process.env.ARTIFACT_DIR ?? "artifacts");
  const absolutePath = path.resolve(root, storagePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root) {
    throw new AppError("VALIDATION_ERROR", "Artifact storage path escaped artifact root.", { storagePath });
  }
  return absolutePath;
}


export function artifactBytesMissingError(row: Row, absolutePath: string): AppError {
  return new AppError("ARTIFACT_BYTES_MISSING", `Artifact ${String(row.id)} metadata exists, but bytes are not available on this gateway.`, {
    id: String(row.id),
    projectId: row.project_id ?? null,
    path: String(row.path),
    storagePath: String(row.storage_path),
    absolutePath,
    status: String(row.status),
    suggestedActions: [
      "send the read request to the gateway that owns this ARTIFACT_DIR",
      "restore or sync the missing file under this gateway ARTIFACT_DIR",
      "re-upload the artifact through this gateway with artifact.put or artifact.put_text using overwrite=true"
    ]
  });
}


export function ensureArtifactBytesExist(row: Row, absolutePath: string): void {
  if (!existsSync(absolutePath)) {
    throw artifactBytesMissingError(row, absolutePath);
  }
}


function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}


export async function readArtifactBytes(row: Row): Promise<Buffer> {
  const absolutePath = artifactAbsolutePath(String(row.storage_path));
  try {
    return await readFile(absolutePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw artifactBytesMissingError(row, absolutePath);
    }
    throw error;
  }
}


export async function readArtifactPrefixForRow(row: Row, maxBytes: number): Promise<Buffer> {
  const absolutePath = artifactAbsolutePath(String(row.storage_path));
  try {
    return await readArtifactPrefix(absolutePath, maxBytes);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw artifactBytesMissingError(row, absolutePath);
    }
    throw error;
  }
}


async function readArtifactPrefix(absolutePath: string, maxBytes: number): Promise<Buffer> {
  const file = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const result = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await file.close();
  }
}


export function isTextArtifact(contentType: string, artifactPath: string): boolean {
  const normalized = contentType.toLowerCase();
  if (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml") ||
    normalized.includes("toml") ||
    normalized.includes("markdown")
  ) {
    return true;
  }
  return [".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".xml"].includes(
    path.posix.extname(artifactPath).toLowerCase()
  );
}


export function isMarkdownArtifact(contentType: string, artifactPath: string): boolean {
  return contentType.toLowerCase().includes("markdown") || path.posix.extname(artifactPath).toLowerCase() === ".md";
}


export function limitText(text: string, maxChars: number, maxLines: number) {
  let output = text;
  let truncatedByChars = false;
  let truncatedByLines = false;

  if (output.length > maxChars) {
    output = output.slice(0, maxChars);
    truncatedByChars = true;
  }

  const lines = output.split(/\r?\n/);
  if (lines.length > maxLines) {
    output = lines.slice(0, maxLines).join("\n");
    truncatedByLines = true;
  }

  return {
    text: output,
    truncatedByChars,
    truncatedByLines
  };
}


export function redactSensitiveText(text: string) {
  let redactions = 0;
  const redact = () => {
    redactions += 1;
    return "[REDACTED]";
  };

  let output = text.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    () => redact()
  );
  output = output.replace(/(authorization\s*:\s*bearer\s+)[^\s"'`]+/gi, (_match, prefix: string) => `${prefix}${redact()}`);
  output = output.replace(
    /((?:"?(?:api[_-]?key|token|secret|password|private[_-]?key|client[_-]?secret)"?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s]+))/gi,
    (match: string) => {
      const separatorIndex = Math.max(match.indexOf(":"), match.indexOf("="));
      if (separatorIndex < 0) {
        return redact();
      }
      redactions += 1;
      return `${match.slice(0, separatorIndex + 1)} [REDACTED]`;
    }
  );

  return { text: output, redactions };
}


export function markdownOutline(text: string, limit: number): Array<{ level: number; title: string; line: number }> {
  const outline: Array<{ level: number; title: string; line: number }> = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      continue;
    }
    outline.push({
      level: match[1].length,
      title: match[2].trim(),
      line: index + 1
    });
    if (outline.length >= limit) {
      break;
    }
  }
  return outline;
}


export function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s/g, "");
  const decoded = Buffer.from(compact, "base64");
  if (decoded.length === 0 || decoded.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, "")) {
    throw new AppError("VALIDATION_ERROR", "contentBase64 must be valid base64.");
  }
  return decoded;
}


export function inferContentType(artifactPath: string): string {
  const extension = path.posix.extname(artifactPath).toLowerCase();
  switch (extension) {
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}


export function inferTextContentType(artifactPath: string): string {
  const inferred = inferContentType(artifactPath);
  return isTextArtifact(inferred, artifactPath) ? inferred : "text/plain; charset=utf-8";
}

