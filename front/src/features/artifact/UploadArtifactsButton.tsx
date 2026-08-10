import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Drawer, Upload, message } from 'antd';
import type { UploadProps } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadArtifact } from '../../shared/lib/uploadArtifact';

interface Props {
  projectSlug: string;
  onDone?: () => void;
}

// Binary counterpart to PutTextArtifactDrawer -- bulk file drop, no form,
// each file becomes its own artifact at uploads/<original filename>. Uses
// antd's own customRequest (not beforeUpload+false, unlike PutTextArtifactDrawer)
// specifically so Upload.Dragger's built-in file list shows real per-file
// progress/success/error state -- this drawer has no separate Save step,
// each dropped file uploads immediately.
export function UploadArtifactsButton({ projectSlug, onDone }: Props) {
  const { t } = useTranslation('artifacts');
  const [open, setOpen] = useState(false);

  const customRequest: UploadProps['customRequest'] = (options) => {
    const file = options.file as File;
    uploadArtifact(file, projectSlug, { path: `uploads/${file.name}` })
      .then((artifact) => {
        options.onSuccess?.(artifact);
        onDone?.();
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        options.onError?.(err);
        message.error(err.message);
      });
  };

  return (
    <>
      <Button size="small" icon={<UploadOutlined />} onClick={() => setOpen(true)}>
        {t('uploadFiles')}
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={t('uploadFiles')} width={480}>
        <Upload.Dragger multiple customRequest={customRequest}>
          <p style={{ margin: '8px 0 0' }}><InboxOutlined style={{ fontSize: 24 }} /></p>
          <p style={{ margin: '4px 0 12px', fontSize: 12.5 }}>{t('dropFilesHint')}</p>
        </Upload.Dragger>
      </Drawer>
    </>
  );
}
