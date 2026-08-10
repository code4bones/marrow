import { UploadOutlined } from '@ant-design/icons';
import { Button, message, Tooltip, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { useState } from 'react';
import { extractFileText } from '../lib/extractFileText';

interface Props {
  label: string;
  hint: string;
  errorMessage: (name: string) => string;
  onText: (text: string) => void;
}

/**
 * Small "fill this field from a file" control — reads a .docx/.md/.txt file
 * via the gateway's POST /extract-text (backend does the actual parsing;
 * see shared/lib/extractFileText) and hands the extracted plain text to
 * onText, which the caller uses to overwrite one form field. The file
 * itself is never attached anywhere — this is a content shortcut, not an
 * upload.
 */
export function ImportTextFromFileButton({ label, hint, errorMessage, onText }: Props) {
  const [loading, setLoading] = useState(false);

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    setLoading(true);
    extractFileText(file)
      .then((text) => onText(text))
      .catch(() => message.error(errorMessage(file.name)))
      .finally(() => setLoading(false));
    return false;
  };

  return (
    <Tooltip title={hint}>
      <Upload beforeUpload={beforeUpload} showUploadList={false} accept=".docx,.md,.txt" maxCount={1}>
        <Button size="small" type="text" icon={<UploadOutlined />} loading={loading}>
          {label}
        </Button>
      </Upload>
    </Tooltip>
  );
}
