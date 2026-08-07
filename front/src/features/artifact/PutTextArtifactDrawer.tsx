import { useMutation } from '@apollo/client/react';
import { InboxOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Checkbox, Drawer, Form, Input, message, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { useState } from 'react';
import { PUT_TEXT_ARTIFACT } from '../../shared/api/queries';

// Templates/docs are text — no binary artifact.put mutation is wired up over
// GraphQL yet (only artifact.put_text). A basic extension->contentType guess
// covers what people actually drop in here; unknown extensions fall back to
// text/plain, same default the manual-path field already had.
const EXT_CONTENT_TYPE: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown',
  json: 'application/json',
  yml: 'text/yaml', yaml: 'text/yaml',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  xml: 'application/xml',
};

function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_CONTENT_TYPE[ext] ?? 'text/plain';
}

interface Props {
  /** Omit for the Common page — uploads a project-independent (common:
   * true) artifact instead of a project-scoped one. Same mutation, same
   * backend rule (storeArtifact: `common = input.common === true ||
   * input.project === null`). */
  projectSlug?: string;
  onDone?: () => void;
}

export function PutTextArtifactDrawer({ projectSlug, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const [mutate, { loading }] = useMutation(PUT_TEXT_ARTIFACT, {
    onCompleted: () => {
      message.success('Artifact saved');
      form.resetFields();
      setOpen(false);
      onDone?.();
    },
    onError: (e) => message.error(e.message),
  });

  const submit = () =>
    form.validateFields().then((values) => {
      const tagsRaw: string = values.tags ?? '';
      const tags = tagsRaw.split(',').map((t: string) => t.trim()).filter(Boolean);
      mutate({
        variables: {
          input: {
            project: projectSlug,
            common: projectSlug ? undefined : true,
            path: values.path,
            title: values.title || undefined,
            description: values.description || undefined,
            contentType: values.contentType || 'text/plain',
            text: values.text,
            tags: tags.length ? tags : undefined,
            overwrite: values.overwrite ?? false,
          },
        },
      });
    });

  // Reads the dropped/picked file as text and fills the form instead of
  // making the user copy-paste content in by hand. Returns false from
  // beforeUpload so antd never tries to actually POST the file anywhere —
  // this drawer's own Save button (via PUT_TEXT_ARTIFACT) is what persists
  // it. Doesn't touch path/title if the user already typed something, so
  // dropping a second file to replace content doesn't clobber an
  // intentional custom path.
  const handleFile: UploadProps['beforeUpload'] = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const current = form.getFieldsValue();
      form.setFieldsValue({
        text,
        path: current.path || file.name,
        title: current.title || file.name,
        contentType: guessContentType(file.name),
      });
    };
    reader.onerror = () => message.error(`Could not read ${file.name}.`);
    reader.readAsText(file);
    return false;
  };

  return (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        New Artifact
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Put Text Artifact"
        width={540}
        extra={
          <Button type="primary" size="small" loading={loading} onClick={submit}>
            Save
          </Button>
        }
      >
        <Form form={form} layout="vertical" size="small" initialValues={{ contentType: 'text/plain', overwrite: false }}>
          <Upload.Dragger
            beforeUpload={handleFile}
            showUploadList={false}
            multiple={false}
            style={{ marginBottom: 16 }}
          >
            <p style={{ margin: '8px 0 0' }}><InboxOutlined style={{ fontSize: 24 }} /></p>
            <p style={{ margin: '4px 0 12px', fontSize: 12.5 }}>
              Drop a file here or click to browse — fills in path/title/content below (text files only)
            </p>
          </Upload.Dragger>
          <Form.Item name="path" label="Path" rules={[{ required: true }]}>
            <Input placeholder="docs/my-file.md" />
          </Form.Item>
          <Form.Item name="title" label="Title">
            <Input />
          </Form.Item>
          <Form.Item name="contentType" label="Content Type">
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="tags" label="Tags (comma-separated)">
            <Input placeholder="docs, api, draft" />
          </Form.Item>
          <Form.Item name="text" label="Content" rules={[{ required: true }]}>
            <Input.TextArea
              rows={16}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
          <Form.Item name="overwrite" valuePropName="checked">
            <Checkbox>Overwrite if exists</Checkbox>
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
