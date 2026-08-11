import { useMutation } from '@apollo/client/react';
import { PlusOutlined } from '@ant-design/icons';
import { AutoComplete, Button, Drawer, Form, Input, InputNumber, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATE_TASK } from '../../shared/api/queries';
import { ImportTextFromFileButton } from '../../shared/ui/ImportTextFromFileButton';

interface Props {
  projectSlug: string;
  onDone?: () => void;
  /** Distinct milestone values already in use on this project, offered as autocomplete suggestions to avoid near-duplicate group names. */
  milestoneSuggestions?: string[];
}

export function CreateTaskDrawer({ projectSlug, onDone, milestoneSuggestions }: Props) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const [mutate, { loading }] = useMutation(CREATE_TASK, {
    onCompleted: () => {
      message.success(t('taskCreated'));
      form.resetFields();
      setOpen(false);
      onDone?.();
    },
    onError: (e) => message.error(e.message),
  });

  const submit = () =>
    form.validateFields().then((values) =>
      mutate({
        variables: {
          input: {
            project: projectSlug,
            title: values.title,
            milestone: values.milestone || undefined,
            priority: values.priority ?? undefined,
            scope: values.scope || undefined,
            acceptance: values.acceptance || undefined,
            notes: values.notes || undefined,
          },
        },
      }),
    );

  return (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        {t('newTask')}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t('createTask')}
        width={480}
        extra={
          <Button type="primary" size="small" loading={loading} onClick={submit}>
            {t('create')}
          </Button>
        }
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item name="title" label={t('title')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="milestone" label={t('milestone')}>
            <AutoComplete options={milestoneSuggestions?.map((m) => ({ value: m }))} filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}>
              <Input />
            </AutoComplete>
          </Form.Item>
          <Form.Item name="priority" label={t('priority')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="scope"
            label={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span>{t('scope')}</span>
                <ImportTextFromFileButton
                  label={t('importFromFile')}
                  hint={t('importFromFileHint')}
                  errorMessage={(name) => t('couldNotReadFile', { name })}
                  onText={(text) => form.setFieldsValue({ scope: text })}
                />
              </div>
            }
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="acceptance" label={t('acceptanceCriteria')}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="notes" label={t('notes')}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
