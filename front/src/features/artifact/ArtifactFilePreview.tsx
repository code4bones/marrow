import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Image, Space, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE_URL } from '../../shared/config/env';
import { artifactPreviewKind } from '../../shared/lib/artifactPreview';
import type { Artifact } from '../../shared/model/types';

export function ArtifactFilePreview({ artifact }: { artifact: Artifact }) {
  const { t } = useTranslation('artifacts');
  const kind = artifactPreviewKind(artifact.contentType, artifact.path);
  const canPreview = !['text', 'download'].includes(kind);
  const downloadUrl = `${API_BASE_URL}/artifacts/${encodeURIComponent(artifact.id)}/download`;
  const previewUrl = `${downloadUrl}?inline=1&v=${encodeURIComponent(artifact.sha256 ?? artifact.updatedAt ?? '')}`;
  const [attempt, setAttempt] = useState(0);
  const key = `${previewUrl}:${kind}:${attempt}`;
  const [load, setLoad] = useState<{ key: string; failed: boolean } | null>(null);

  useEffect(() => {
    if (!canPreview) return;
    const controller = new AbortController();
    // Authenticate and check that bytes exist before mounting a native viewer.
    // URLs stay same-origin so the deployed CSP can keep its existing policy.
    void fetch(previewUrl, { method: 'HEAD', credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setLoad({ key, failed: !response.ok }); })
      .catch(() => { if (!controller.signal.aborted) setLoad({ key, failed: true }); });
    return () => controller.abort();
  }, [canPreview, previewUrl, key]);

  const failed = load?.key === key && load.failed;
  const ready = load?.key === key && !load.failed;
  const onError = () => setLoad({ key, failed: true });
  const title = artifact.title || artifact.path;
  return <Space orientation="vertical" size="middle" style={{ width: '100%', marginBottom: 14 }}>
    <Button href={downloadUrl} icon={<DownloadOutlined />}>{t('downloadOriginal')}</Button>
    {canPreview && !ready && !failed && <Spin tip={t('previewLoading')}><div style={{ height: 100 }} /></Spin>}
    {canPreview && failed && <Alert type="warning" title={t('previewUnavailable')} showIcon
      action={<Button size="small" icon={<ReloadOutlined />} onClick={() => setAttempt((n) => n + 1)}>{t('retryPreview')}</Button>} />}
    {canPreview && ready && <div key={key} style={{ width: '100%' }}>
      {kind === 'image' && <Image src={previewUrl} alt={title} width="100%" style={{ maxHeight: 560, objectFit: 'contain' }} onError={onError} />}
      {kind === 'video' && <video src={previewUrl} controls preload="metadata" style={{ width: '100%', maxHeight: 560 }} onError={onError} />}
      {kind === 'audio' && <audio src={previewUrl} controls preload="metadata" style={{ width: '100%' }} onError={onError} />}
      {kind === 'pdf' && <iframe src={previewUrl} title={title} style={{ width: '100%', height: 560, border: '1px solid #303030', borderRadius: 6 }} onError={onError} />}
    </div>}
  </Space>;
}
