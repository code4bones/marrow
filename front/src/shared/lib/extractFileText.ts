import { API_BASE_URL } from '../config/env';

/**
 * Sends a file to the gateway's POST /extract-text (multipart/form-data,
 * session-auth only) and returns the plain text it extracted -- .docx via
 * mammoth server-side, everything else (.md, .txt, ...) read as UTF-8. The
 * file itself is never persisted anywhere (no artifact, no DB row); this is
 * purely "read this file's content into a form field".
 */
export async function extractFileText(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE_URL}/extract-text`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const json = (await response.json().catch(() => null)) as { data?: { text?: string }; error?: { message?: string } } | null;
  if (!response.ok || typeof json?.data?.text !== 'string') {
    throw new Error(json?.error?.message ?? `Could not read ${file.name}.`);
  }
  return json.data.text;
}
