import { useMutation } from '@apollo/client/react';
import { EditOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, message } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UPDATE_SKILL } from '../../shared/api/queries';
import type { Skill } from '../../shared/model/types';

interface Props {
  skill: Pick<Skill, 'id' | 'name' | 'description' | 'body' | 'tags'>;
  onDone?: () => void;
}

// D-MEMORY-041: a Drawer (not UpdateArtifactMetaModal's Modal) -- editing
// `body` needs more room than a metadata-only modal.
export function UpdateSkillDrawer({ skill, onDone }: Props) {
  const { t } = useTranslation('skills');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: skill.name,
        description: skill.description ?? '',
        tags: skill.tags.join(', '),
        body: skill.body,
      });
    }
  }, [open, skill, form]);

  const [mutate, { loading }] = useMutation(UPDATE_SKILL, {
    onCompleted: () => { message.success(t('skillSaved')); setOpen(false); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  const submit = () =>
    form.validateFields().then((values) => {
      const tags = (values.tags as string).split(',').map((tag: string) => tag.trim()).filter(Boolean);
      mutate({
        variables: {
          input: {
            id: skill.id,
            name: values.name || undefined,
            description: values.description || undefined,
            body: values.body || undefined,
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
        title={t('editSkill')}
      />
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t('editSkill')}
        width={540}
        extra={
          <Button type="primary" size="small" loading={loading} onClick={submit}>
            {t('save')}
          </Button>
        }
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item name="name" label={t('name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="tags" label={t('tagsCommaSeparated')}>
            <Input />
          </Form.Item>
          <Form.Item name="body" label={t('body')} rules={[{ required: true }]}>
            <Input.TextArea rows={16} style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
