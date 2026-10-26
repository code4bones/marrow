import { useMutation } from '@apollo/client/react';
import { Button, Card, Input, Select, Space, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATE_TASK_FROM_TELEGRAM_MESSAGE, type TelegramBotMessage } from '../../shared/api/project-telegram';

export function ManualTelegramTask({ project, botId, source, onQueued }: { project: string; botId: string; source: TelegramBotMessage; onQueued: () => void }) {
  const { t } = useTranslation('projects');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [title, setTitle] = useState(() => source.text?.replace(/#[\p{L}\p{N}_]+/gu, '').trim().split('\n').find((s) => s.trim())?.trim().slice(0, 300) ?? '');
  const [create, { loading }] = useMutation(CREATE_TASK_FROM_TELEGRAM_MESSAGE, {
    onCompleted: () => { message.success(t('botManualTaskQueued')); onQueued(); },
    onError: (e) => message.error(e.message),
  });
  return <Card size="small" title={t('botManualTaskTitle')}>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Input value={title} maxLength={300} placeholder={t('botManualTaskName')} onChange={(e) => setTitle(e.target.value)} />
      <Select mode="multiple" style={{ width: '100%' }} value={assignees} onChange={setAssignees} optionFilterProp="label"
        placeholder={t('botManualTaskAssignees')} options={source.assignableMembers?.map((m) => ({ value: m.id, label: m.email }))} />
      <Button type="primary" loading={loading} disabled={!assignees.length || !title.trim()}
        onClick={() => create({ variables: { project, id: botId, messageId: source.id, assignees, title: title.trim() } })}>{t('botManualTaskCreate')}</Button>
    </Space>
  </Card>;
}
