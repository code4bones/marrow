import { useMutation } from '@apollo/client/react';
import { InboxOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, Select, message, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RECORD_SKILL } from '../../shared/api/queries';
import { extractFileText } from '../../shared/lib/extractFileText';

interface Props {
  /** Omit for the Common page — records a common (project: null) skill
   * instead of a project-scoped one. Unlike artifacts' separate `common`
   * boolean flag, skill.record's schema takes `project` nullable directly. */
  projectSlug?: string;
  onDone?: () => void;
}

// D-MEMORY-041: structural copy of PutTextArtifactDrawer.tsx -- same
// drag-a-file-or-paste-text pattern, adapted to skills' simpler DB-only
// (no path/contentType/overwrite) shape.
export function RecordSkillDrawer({ projectSlug, onDone }: Props) {
  const { t } = useTranslation('skills');
  const [open, setOpen] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [form] = Form.useForm();

  const [mutate, { loading }] = useMutation(RECORD_SKILL, {
    onCompleted: () => {
      message.success(t('skillSaved'));
      form.resetFields();
      setOpen(false);
      onDone?.();
    },
    onError: (e) => message.error(e.message),
  });

  const submit = () =>
    form.validateFields().then((values) => {
      const tagsRaw: string = values.tags ?? '';
      const tags = tagsRaw.split(',').map((tag: string) => tag.trim()).filter(Boolean);
      mutate({
        variables: {
          input: {
            project: projectSlug ?? null,
            name: values.name,
            description: values.description || undefined,
            body: values.body,
            status: values.status,
            tags: tags.length ? tags : undefined,
          },
        },
      });
    });

  // Same server-side text extraction as artifacts' drawer (shared/lib/
  // extractFileText) -- doesn't touch `name` if already typed, so dropping a
  // second file to replace content doesn't clobber an intentional name.
  const handleFile: UploadProps['beforeUpload'] = (file) => {
    setFileLoading(true);
    extractFileText(file)
      .then((text) => {
        const current = form.getFieldsValue();
        form.setFieldsValue({
          body: text,
          name: current.name || file.name.replace(/\.[^.]+$/, ''),
        });
      })
      .catch(() => message.error(t('couldNotReadFile', { name: file.name })))
      .finally(() => setFileLoading(false));
    return false;
  };

  return (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        {t('newSkill')}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t('newSkill')}
        width={540}
        extra={
          <Button type="primary" size="small" loading={loading} onClick={submit}>
            {t('save')}
          </Button>
        }
      >
        <Form form={form} layout="vertical" size="small" initialValues={{ status: 'active' }}>
          <Upload.Dragger
            beforeUpload={handleFile}
            showUploadList={false}
            multiple={false}
            disabled={fileLoading}
            style={{ marginBottom: 16 }}
          >
            <p style={{ margin: '8px 0 0' }}><InboxOutlined style={{ fontSize: 24 }} spin={fileLoading} /></p>
            <p style={{ margin: '4px 0 12px', fontSize: 12.5 }}>
              {fileLoading ? t('readingFile') : t('dropFileHint')}
            </p>
          </Upload.Dragger>
          <Form.Item name="name" label={t('name')} rules={[{ required: true }]}>
            <Input placeholder="how-to-deploy" />
          </Form.Item>
          <Form.Item name="description" label={t('description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="status" label={t('status')}>
            <Select options={[{ value: 'draft' }, { value: 'active' }]} />
          </Form.Item>
          <Form.Item name="tags" label={t('tagsCommaSeparated')}>
            <Input placeholder="deploy, ci, backend" />
          </Form.Item>
          <Form.Item name="body" label={t('body')} rules={[{ required: true }]}>
            <Input.TextArea
              rows={16}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
