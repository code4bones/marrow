import { decryptGitToken, tokenHint } from "../../git-credentials.js";
import type { Row } from "../types.js";

// T-MEMORY-044: the token_enc column never appears here, under any key --
// `token_enc` isn't even read out of `row`. `includeHint` is a caller-chosen
// last-4-characters hint (git.credential_list only; git.credential_create
// deliberately omits it since the caller just typed the token themselves).
export function gitCredentialOut(row: Row, options: { includeHint?: boolean } = {}) {
  const out: Row = {
    id: String(row.id),
    host: String(row.host),
    label: String(row.label),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null
  };
  if (options.includeHint && row.token_enc) {
    try {
      out.tokenHint = tokenHint(decryptGitToken(String(row.token_enc)));
    } catch {
      // If decryption fails (e.g. key rotated out from under an old row)
      // this is a display-only hint -- degrade to omitting it rather than
      // failing the whole list call.
    }
  }
  return out;
}

