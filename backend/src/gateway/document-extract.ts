import type { IncomingMessage } from "node:http";
import busboy from "busboy";
import mammoth from "mammoth";
import { AppError } from "../shared/errors.js";

// Comfortably above any real task/memory/decision description file --
// guards against someone pointing this at a large binary by mistake, not a
// real-world size limit for prose.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface UploadedFile {
  filename: string;
  buffer: Buffer;
}

// busboy decodes a plain (non RFC-5987-extended) `filename="..."` header
// value as latin1, the historical RFC 2388 assumption -- but browsers send
// raw UTF-8 bytes there for non-ASCII names, with no extended-notation
// fallback. Every UTF-8 byte lands as its own latin1 codepoint, and
// re-encoding that string to UTF-8 downstream (JSON responses, this
// filename becoming an artifact's storage path) doubles the corruption
// into exactly the "Ð¸Ð¼Ñ" mojibake pattern reported live on a Cyrillic
// filename. Re-interpreting the string's code units as latin1 bytes and
// decoding *those* as UTF-8 recovers the original text; a no-op for
// pure-ASCII filenames, since ASCII is identical in both encodings.
function fixMultipartFilenameEncoding(filename: string): string {
  return Buffer.from(filename, "latin1").toString("utf8");
}

// Streams the first (only) file field off a multipart/form-data request via
// busboy. Buffered in memory rather than written to disk -- nothing this
// endpoint reads is ever persisted; the buffer is discarded the moment
// extractDocumentText below has read it (see POST /extract-text in
// http-server.ts). Deliberately doesn't try to also read non-file fields --
// the frontend only ever sends the one file, no accompanying metadata.
export function readMultipartFile(request: IncomingMessage): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({ headers: request.headers, limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
    } catch {
      settleReject(new AppError("VALIDATION_ERROR", "Expected multipart/form-data with a file field."));
      return;
    }

    let sawFile = false;
    parser.on("file", (_name, stream, info) => {
      sawFile = true;
      const chunks: Buffer[] = [];
      let tooLarge = false;
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => {
        tooLarge = true;
        stream.resume();
      });
      stream.on("close", () => {
        if (settled) return;
        if (tooLarge) {
          settleReject(new AppError("VALIDATION_ERROR", "File exceeds the 10MB limit."));
          return;
        }
        settled = true;
        resolve({ filename: fixMultipartFilenameEncoding(info.filename), buffer: Buffer.concat(chunks) });
      });
    });

    parser.on("error", settleReject);
    parser.on("finish", () => {
      if (!settled && !sawFile) {
        settleReject(new AppError("VALIDATION_ERROR", "No file field found in the upload."));
      }
    });

    request.pipe(parser);
  });
}

const DOCX_EXTENSION = /\.docx$/i;

/**
 * Deliberately narrow: .docx is Office Open XML (a zip of XML parts), not
 * text, so it needs a real parser. Everything else (.md, .txt,
 * extensionless, unrecognized) is treated as plain UTF-8 text, which is
 * exactly what .md/.txt already are -- no separate branch needed for them.
 */
export async function extractDocumentText(filename: string, buffer: Buffer): Promise<string> {
  if (DOCX_EXTENSION.test(filename)) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return buffer.toString("utf8");
}
