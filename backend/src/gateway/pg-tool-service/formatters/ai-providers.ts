import { decryptProviderKey, providerKeyHint } from "../../ai-provider-credentials.js";
import { dateStringOrNull } from "./common.js";
import type { Row } from "../types.js";

// The api_key_enc column never appears here, under any key -- same
// "never even read the ciphertext out of row" discipline as
// gitCredentialOut. includeHint mirrors that formatter's own option.
export function aiProviderCredentialOut(row: Row, options: { includeHint?: boolean } = {}) {
  const out: Row = {
    id: String(row.id),
    provider: String(row.provider),
    label: String(row.label),
    model: row.model ? String(row.model) : null,
    isDefault: Boolean(row.is_default),
    createdAt: dateStringOrNull(row.created_at),
    updatedAt: dateStringOrNull(row.updated_at)
  };
  if (options.includeHint && row.api_key_enc) {
    try {
      out.keyHint = providerKeyHint(decryptProviderKey(String(row.api_key_enc)));
    } catch {
      // Display-only hint -- degrade to omitting it (e.g. key rotated out
      // from under an old row) rather than failing the whole list call.
    }
  }
  return out;
}
