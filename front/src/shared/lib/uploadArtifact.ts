import { API_BASE_URL } from '../config/env';
import type { Artifact } from '../model/types';

/**
 * Sends a file to the gateway's POST /artifacts/upload (multipart/form-data,
 * session-auth only) -- the binary counterpart to extractFileText.ts, but
 * this one persists: the bytes are stored as a real artifact (reusing the
 * artifact.put tool server-side), not just read and discarded. The browser
 * never base64-encodes the file itself; that only happens once, in-process
 * on the server, to hand the buffer to the existing artifact.put tool.
 */
export async function uploadArtifact(
  file: File,
  projectSlug: string,
  options?: { path?: string; overwrite?: boolean; group?: string },
): Promise<Artifact> {
  const params = new URLSearchParams({ project: projectSlug });
  if (options?.path) params.set('path', options.path);
  if (options?.overwrite) params.set('overwrite', 'true');
  if (options?.group) params.set('group', options.group);

  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE_URL}/artifacts/upload?${params.toString()}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const json = (await response.json().catch(() => null)) as
    | { ok: true; data: { artifact: Artifact } }
    | { ok: false; error: { message?: string } }
    | null;
  if (!response.ok || !json) {
    throw new Error(`Could not upload ${file.name}.`);
  }
  if (!json.ok) {
    throw new Error(json.error?.message ?? `Could not upload ${file.name}.`);
  }
  return json.data.artifact;
}
