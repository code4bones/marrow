import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { GET_TELEGRAM_CHAT_MENTIONS, SET_TELEGRAM_CHAT_MENTION, type TelegramChatMentions } from '../../shared/api/project-telegram';

export function ProjectBotChatSettings({ project, botId, chatId }: { project: string; botId: string; chatId: string }) {
  const { t } = useTranslation('projects');
  const variables = { project, id: botId, chatId };
  const { data, loading, error, refetch } = useQuery<{ projectTelegramChatMentions: TelegramChatMentions }>(
    GET_TELEGRAM_CHAT_MENTIONS, { variables, pollInterval: 3000, fetchPolicy: 'network-only' },
  );
  const [save, { loading: saving }] = useMutation(SET_TELEGRAM_CHAT_MENTION, {
    onCompleted: () => { void refetch().catch(() => {}); }, onError: (e) => { message.error(e.message); },
  });
  const settings = data?.projectTelegramChatMentions;
  const members = settings?.members ?? [];
  const assign = (mentionKey: string, userId: string | null) => {
    void save({ variables: { ...variables, mentionKey, userId } }).catch(() => {});
  };
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Alert type="info" showIcon title={t('botChatMappingHelp')} />
    {error && <Alert type="error" showIcon title={error.message} />}
    <Table size="small" rowKey="key" loading={loading && !data} dataSource={settings?.mentions ?? []}
      scroll={{ x: 800 }} pagination={{ pageSize: 15, hideOnSinglePage: true }} locale={{ emptyText: t('botNoMentions') }} columns={[
        { title: t('botObservedMention'), dataIndex: 'label', width: 160 },
        { title: t('botManualRecipient'), key: 'mapping', width: 250, render: (_, row) => <Space>
          <Select showSearch optionFilterProp="label" style={{ width: 230 }} placeholder={t('botSelectMember')}
            aria-label={t('botMapMentionLabel', { mention: row.label })} disabled={saving}
            value={members.some((m) => m.id === row.userId) ? row.userId : undefined}
            options={members.map((m) => ({ value: m.id, label: m.email }))} onChange={(id) => assign(row.key, id)} />
          {row.userId && <Button size="small" disabled={saving} onClick={() => assign(row.key, null)}>{t('botClearMapping')}</Button>}
        </Space> },
        { title: t('botEffectiveRecipient'), key: 'effective', width: 240, render: (_, row) => <Space orientation="vertical" size={0}>
          <Typography.Text>{members.find((m) => m.id === row.effectiveUserId)?.email ?? '—'}</Typography.Text>
          <Tag color={row.resolution === 'owner' ? 'orange' : 'green'}>{t(`botMentionResolution_${row.resolution}`)}</Tag>
        </Space> },
        { title: t('botMentionLastSeen'), dataIndex: 'lastSeenAt', width: 160, render: (value: string | null) => value ? new Date(value).toLocaleString() : '—' },
      ]} />
  </Space>;
}
