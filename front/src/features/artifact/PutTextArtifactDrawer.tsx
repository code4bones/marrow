import { useMutation } from '@apollo/client/react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Checkbox, Drawer, Form, Input, message } from 'antd';
import { useState } from 'react';
import { PUT_TEXT_ARTIFACT } from '../../shared/api/queries';

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
