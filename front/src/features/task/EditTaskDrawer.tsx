import { useMutation } from '@apollo/client/react';
import { EditOutlined } from '@ant-design/icons';
import { Button, Drawer, Form, Input, Select, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UPDATE_TASK_DETAILS } from '../../shared/api/queries';
import { canPerform } from '../../shared/lib/taskPermissions';
import { priorityTierOf, priorityTierOptions, PRIORITY_TIER_VALUE, type PriorityTier } from '../../shared/lib/taskPriority';
import type { ProjectMemberRole, Task } from '../../shared/model/types';
import { ImportTextFromFileButton } from '../../shared/ui/ImportTextFromFileButton';

interface FormValues {
  title: string;
  milestone: string;
  priority: PriorityTier;
  scope: string;
  acceptance: string;
  notes: string;
}

// T-MEMORY-110: whoever can create a task (pm/developer) gets the same
// reach to fully describe it afterward -- task.create's own form has
// title/milestone/priority/scope/acceptance/notes, but until now there was
// no way back into those fields once the task existed (only title had its
// own dedicated inline editor, on the Kanban card). Backed by
// task.update_details, one call for every field here. priority is only
// included in that call when the user actually changed it, since it alone
// carries a stricter permission (reprioritize) than the rest of the form --
// submitting it unchanged would risk failing the whole save for a developer
// who only touched the other fields.
export function EditTaskDrawer({ task, role }: { task: Task; role?: ProjectMemberRole | null }) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const initialTier = priorityTierOf(task.priority);
  const canReprioritize = canPerform(role, 'reprioritize');

  const [mutate, { loading }] = useMutation(UPDATE_TASK_DETAILS, {
    onCompleted: () => { message.success(t('taskUpdated')); setOpen(false); },
    onError: (e) => message.error(e.message),
  });

  const openDrawer = () => {
    form.setFieldsValue({
      title: task.title,
      milestone: task.milestone ?? '',
      priority: initialTier,
      scope: task.scope ?? '',
      acceptance: task.acceptance ?? '',
      notes: task.notes ?? '',
    });
    setOpen(true);
  };

  const submit = () =>
    form.validateFields().then((values) => {
      const variables: Record<string, unknown> = {
        id: task.id,
        title: values.title,
        milestone: values.milestone || null,
        scope: values.scope || null,
        acceptance: values.acceptance || null,
        notes: values.notes || null,
      };
      if (values.priority !== initialTier) {
        variables.priority = PRIORITY_TIER_VALUE[values.priority];
      }
      return mutate({ variables });
    });

  return (
    <>
      <Button size="small" icon={<EditOutlined />} onClick={openDrawer}>
        {t('editTask')}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t('editTask')}
        width={480}
        extra={
          <Button type="primary" size="small" loading={loading} onClick={submit}>
            {t('save')}
          </Button>
        }
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item name="title" label={t('title')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="milestone" label={t('milestone')}>
            <Input />
          </Form.Item>
          <Form.Item name="priority" label={t('priority')}>
            <Select options={priorityTierOptions(t)} disabled={!canReprioritize} />
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
