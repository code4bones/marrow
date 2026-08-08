import { useMutation } from '@apollo/client/react';
import { EditOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, message } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UPDATE_ARTIFACT_METADATA } from '../../shared/api/queries';
import type { Artifact } from '../../shared/model/types';

interface Props {
  artifact: Pick<Artifact, 'id' | 'title' | 'description' | 'tags'>;
  onDone?: () => void;
}

export function UpdateArtifactMetaModal({ artifact, onDone }: Props) {
  const { t } = useTranslation('artifacts');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        title: artifact.title ?? '',
        description: artifact.description ?? '',
        tags: artifact.tags.join(', '),
      });
    }
  }, [open, artifact, form]);

  const [mutate, { loading }] = useMutation(UPDATE_ARTIFACT_METADATA, {
    onCompleted: () => { message.success(t('metadataUpdated')); setOpen(false); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  const submit = () =>
    form.validateFields().then((values) => {
      const tags = (values.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean);
      mutate({
        variables: {
          input: {
            id: artifact.id,
            title: values.title || undefined,
            description: values.description || undefined,
            tags: tags.length ? tags : undefined,
          },
        },
      });
    });

  return (
    <>
      <Button
        size="small"
        type="text"
        icon={<EditOutlined />}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={t('editMetadata')}
      />
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={loading}
        title={t('editArtifactMetadata')}
        okText={t('save')}
        width={480}
      >
        <Form form={form} layout="vertical" size="small" style={{ marginTop: 16 }}>
          <Form.Item name="title" label={t('title')}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('description')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="tags" label={t('tagsCommaSeparated')}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
