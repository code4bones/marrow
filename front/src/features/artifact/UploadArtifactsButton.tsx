import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { AutoComplete, Button, Drawer, Typography, Upload, message } from 'antd';
import type { UploadProps } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadArtifact } from '../../shared/lib/uploadArtifact';

interface Props {
  projectSlug: string;
  /** Tags already used by this project's artifacts (best-effort, from the
   * currently loaded page) -- offered as pick-or-create suggestions for
   * the group field below, same "type to filter, or just type a new one"
   * pattern as DecisionTimeline's RootSearch. */
  existingGroups: string[];
  onDone?: () => void;
}

// Binary counterpart to PutTextArtifactDrawer -- bulk file drop, no form,
// each file becomes its own artifact. Uses antd's own customRequest (not
// beforeUpload+false, unlike PutTextArtifactDrawer) specifically so
// Upload.Dragger's built-in file list shows real per-file progress/success/
// error state -- this drawer has no separate Save step, each dropped file
// uploads immediately.
export function UploadArtifactsButton({ projectSlug, existingGroups, onDone }: Props) {
  const { t } = useTranslation('artifacts');
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState('');

  const groupOptions = useMemo(() => existingGroups.map((g) => ({ value: g })), [existingGroups]);

  const customRequest: UploadProps['customRequest'] = (options) => {
    const file = options.file as File;
    uploadArtifact(file, projectSlug, { group: group.trim() || undefined })
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
        <Typography.Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {t('uploadGroupLabel')}
        </Typography.Text>
        <AutoComplete
          value={group}
          onChange={setGroup}
          options={groupOptions}
          filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
          placeholder={t('uploadGroupPlaceholder')}
          style={{ width: '100%', marginBottom: 4 }}
          allowClear
        />
        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 16 }}>
          {t('uploadGroupHint')}
        </Typography.Text>
        {/* antd's Dragger defaults to height: 100% -- fine when it shares a
            tall form with other fields (PutTextArtifactDrawer), but this
            drawer has nothing else below it, so with no other content
            fighting for height it stretched to fill the entire drawer
            body. Fixed height overrides that. */}
        <Upload.Dragger multiple customRequest={customRequest} style={{ height: 180 }}>
          <p style={{ margin: '8px 0 0' }}><InboxOutlined style={{ fontSize: 24 }} /></p>
          <p style={{ margin: '4px 0 12px', fontSize: 12.5 }}>{t('dropFilesHint')}</p>
        </Upload.Dragger>
      </Drawer>
    </>
  );
}
