export type ArtifactPreviewKind = 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'download';

export function artifactPreviewKind(contentType: string | null, path: string): ArtifactPreviewKind {
  const mime = (contentType ?? '').split(';', 1)[0].trim().toLowerCase();
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon'].includes(mime)) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || ['json', 'xml', 'yaml', 'toml', 'markdown'].some((part) => mime.includes(part))
    || /\.(md|txt|json|jsonl|yaml|yml|toml|csv|tsv|xml)$/i.test(path)) return 'text';
  return 'download';
}
