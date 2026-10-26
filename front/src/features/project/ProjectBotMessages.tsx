import { formatBotDateTime as timestamp } from '../../shared/lib/botDateTime';
import { useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Space, Spin, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { GET_PROJECT_TELEGRAM_MESSAGE, GET_PROJECT_TELEGRAM_MESSAGES, type TelegramBotMessage } from '../../shared/api/project-telegram';

const PAGE_SIZE = 5;

export function ProjectBotMessages({ project, botId }: { project: string; botId: string }) {
  const { t } = useTranslation('projects');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, loading, error } = useQuery<{ projectTelegramBotMessages: { messages: TelegramBotMessage[]; total: number } }>(GET_PROJECT_TELEGRAM_MESSAGES,
    { variables: { project, id: botId, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, pollInterval: 3000, fetchPolicy: 'network-only' });
  const detail = useQuery<{ projectTelegramBotMessage: TelegramBotMessage }>(GET_PROJECT_TELEGRAM_MESSAGE,
    { variables: { project, id: botId, messageId: selectedId }, skip: !selectedId, pollInterval: selectedId ? 3000 : 0, fetchPolicy: 'network-only' });
  const msg = detail.data?.projectTelegramBotMessage;
  const reason = (value: string | null) => value ? t(`botMessageReason_${value}`, { defaultValue: value }) : '—';
  const status = (value: string) => <Tag color={value === 'failed' ? 'red' : value === 'done' || value === 'bound' ? 'green' : value === 'processing' ? 'processing' : 'default'}>
    {t(`botMessageStatus_${value}`, { defaultValue: value })}</Tag>;
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" title={error.message} showIcon />}
      <Table<TelegramBotMessage> size="small" rowKey="id" loading={loading && !data}
        dataSource={data?.projectTelegramBotMessages.messages ?? []} scroll={{ x: 850 }}
        locale={{ emptyText: t('botHistoryEmpty') }} pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.projectTelegramBotMessages.total ?? 0, showSizeChanger: false, onChange: setPage }}
        onRow={(row) => ({ onClick: () => setSelectedId(row.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: t('botMessageReceivedAt'), dataIndex: 'receivedAt', width: 160, render: timestamp },
          { title: t('botChatTitle'), dataIndex: 'chatTitle', width: 150 },
          { title: t('botMessageText'), key: 'text', render: (_, row) => <Button type="link" style={{ height: 'auto', padding: 0, whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setSelectedId(row.id)}>{row.excerpt || t(`botMessageKind_${row.messageKind}`, { defaultValue: row.messageKind })}</Button> },
          { title: t('botMessageStatus'), dataIndex: 'status', width: 130, render: status },
          { title: t('botMessageReason'), dataIndex: 'reason', width: 170, render: reason },
        ]} />
      <Drawer title={t('botMessageDetails')} open={Boolean(selectedId)} onClose={() => setSelectedId(null)} size={760} destroyOnHidden>
        {detail.loading && !msg && <Spin />}
        {detail.error && <Alert type="error" title={detail.error.message} showIcon />}
        {msg && <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions size="small" column={1} bordered items={[
            { key: 'chat', label: t('botChatTitle'), children: `${msg.chatTitle ?? '—'} (${msg.chatId ?? '—'})` },
            { key: 'received', label: t('botMessageReceivedAt'), children: timestamp(msg.receivedAt) },
            { key: 'classified', label: t('botMessageClassifiedAt'), children: timestamp(msg.classifiedAt) },
            { key: 'processed', label: t('botLastProcessedAt'), children: timestamp(msg.processedAt) },
            { key: 'status', label: t('botMessageStatus'), children: status(msg.status) },
            { key: 'reason', label: t('botMessageReason'), children: reason(msg.reason) },
            { key: 'tags', label: t('botTags'), children: msg.matchedTags?.map((tag) => `#${tag}`).join(', ') || '—' },
            { key: 'mentions', label: t('botMessageMentions'), children: msg.mentions?.join(', ') || '—' },
          ]} />
          {msg.lastError && <Alert type="warning" title={t(`botError_${msg.lastError}`, { defaultValue: msg.lastError })} showIcon />}
          {msg.messageUrl && <a href={msg.messageUrl} target="_blank" rel="noopener noreferrer">{t('botOpenTelegramMessage')}</a>}
          <Card size="small" title={t('botMessageText')}>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{msg.text || t(`botMessageKind_${msg.messageKind}`, { defaultValue: msg.messageKind })}</Typography.Paragraph>
          </Card>
          <Card size="small" title={t('botClassificationResult')}>
            {!msg.classification ? <Typography.Text type="secondary">{t('botNotClassified')}</Typography.Text>
              : !msg.classification.tasks.length ? <Typography.Text>{t('botNoTaskFound')}</Typography.Text>
                : msg.classification.tasks.map((task) => <div key={task.telegramUserId} style={{ marginBottom: 12 }}>
                  <Typography.Text strong>{task.title}</Typography.Text>
                  <Typography.Paragraph>{task.description}</Typography.Paragraph>
                  <Typography.Text type="secondary">{t('botClassificationEvidence', { evidence: task.evidence, confidence: Math.round(task.confidence * 100) })}</Typography.Text>
                </div>)}
          </Card>
          <Card size="small" title={t('botCreatedTasks')}>
            {msg.tasks?.length ? <Space orientation="vertical">{msg.tasks.map((task) => <Link key={task.id}
              to={`/projects/${encodeURIComponent(project)}/tasks?record=${encodeURIComponent(task.id)}`}>{task.id}: {task.title}</Link>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('botNoCreatedTasks')} />}
          </Card>
        </Space>}
      </Drawer>
    </Space>
  );
}
