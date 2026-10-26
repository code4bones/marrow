import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Table, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ADD_PROJECT_TELEGRAM_BOT, CONNECT_PROJECT_TELEGRAM_BOT, DISCONNECT_PROJECT_TELEGRAM_BOT,
  GET_PROJECT_TELEGRAM_BOTS, PROJECT_TELEGRAM_LINK_CODE, REMOVE_PROJECT_TELEGRAM_BOT,
  RETRY_PROJECT_TELEGRAM_BOT, UNLINK_PROJECT_TELEGRAM_CHAT,
  SET_PROJECT_TELEGRAM_BOT_TAGS,
  type ProjectTelegramBot, type TelegramChatLinkCode,
} from '../../shared/api/project-telegram';

export function ProjectBotsSection({ project, canManage }: { project: string; canManage: boolean }) {
  const { t } = useTranslation('projects');
  const { data, loading, error, refetch } = useQuery<{ projectTelegramBots: { bots: ProjectTelegramBot[]; deepseekReady: boolean } }>(
    GET_PROJECT_TELEGRAM_BOTS, { variables: { project }, skip: !canManage, pollInterval: 2000, fetchPolicy: 'network-only' },
  );
  const [addingOpen, setAddingOpen] = useState(false);
  const [linkCode, setLinkCode] = useState<(TelegramChatLinkCode & { username: string }) | null>(null);
  const [editingTags, setEditingTags] = useState<ProjectTelegramBot | null>(null);
  const [togglingBotId, setTogglingBotId] = useState<string | null>(null);
  const [form] = Form.useForm<{ token: string; tags: string[] }>();
  const [tagsForm] = Form.useForm<{ tags: string[] }>();
  const refresh = () => { void refetch().catch(() => {}); };
  const onError = (e: Error) => { message.error(e.message); refresh(); };
  const [add, { loading: adding }] = useMutation(ADD_PROJECT_TELEGRAM_BOT, {
    onCompleted: () => { setAddingOpen(false); form.resetFields(); refresh(); }, onError,
  });
  const options = { onCompleted: refresh, onError };
  const [connect, { loading: connecting }] = useMutation(CONNECT_PROJECT_TELEGRAM_BOT, { onError });
  const [disconnect, { loading: disconnecting }] = useMutation(DISCONNECT_PROJECT_TELEGRAM_BOT, { onError });
  const [remove, { loading: removing }] = useMutation(REMOVE_PROJECT_TELEGRAM_BOT, options);
  const [unlink, { loading: unlinking }] = useMutation(UNLINK_PROJECT_TELEGRAM_CHAT, options);
  const [retry, { loading: retrying }] = useMutation(RETRY_PROJECT_TELEGRAM_BOT, options);
  const [setTags, { loading: savingTags }] = useMutation(SET_PROJECT_TELEGRAM_BOT_TAGS, {
    onCompleted: () => { setEditingTags(null); refresh(); }, onError,
  });
  const [generate, { loading: generating }] = useMutation<{ projectTelegramBotLinkCode: TelegramChatLinkCode }>(PROJECT_TELEGRAM_LINK_CODE, { onError, fetchPolicy: 'no-cache' });
  const busy = connecting || disconnecting || removing || generating || unlinking || retrying || savingTags;
  const toggleBot = async (bot: ProjectTelegramBot, active: boolean) => {
    setTogglingBotId(bot.id);
    try {
      await (active ? connect : disconnect)({ variables: { project, id: bot.id } });
      await refetch();
    } catch { /* mutation onError displays the error and refreshes server state */ }
    finally { setTogglingBotId(null); }
  };
  const statusColors = { inactive: 'default', starting: 'processing', active: 'green', error: 'red' };
  const tagRules = [{ required: true, type: 'array' as const, min: 1, max: 20, message: t('botTagsRequired') }, {
    validator: (_: unknown, values: string[] | undefined) => values?.every((value) => /^#?[\p{L}\p{N}_]{1,64}$/u.test(value))
      ? Promise.resolve() : Promise.reject(new Error(t('botTagsRequired'))),
  }];

  if (!canManage) return <Alert type="info" showIcon title={t('botsOwnerOnly')} />;
  const bots = data?.projectTelegramBots.bots ?? [];
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Alert type="info" showIcon title={t('botsHowItWorks')} description={t('botsSetupHelp')} />
      {data && !data.projectTelegramBots.deepseekReady && <Alert type="warning" showIcon title={t('botsDeepseekRequired')} />}
      {error && <Alert type="error" showIcon title={error.message} />}
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddingOpen(true)}>{t('addBot')}</Button>
      {loading && !data && <Spin />}
      {!loading && !error && !bots.length && <Empty description={t('noBots')} />}
      {bots.map((bot) => (
        <Card key={bot.id} size="small" title={<Space wrap><span>@{bot.username}</span>
          <Switch checked={bot.enabled} loading={togglingBotId === bot.id} disabled={busy || togglingBotId !== null}
            checkedChildren={t('botActive')} unCheckedChildren={t('botInactive')}
            aria-label={t('botActivityLabel', { username: bot.username })}
            onChange={(active) => { void toggleBot(bot, active); }} />
          <Tag color={statusColors[bot.pollingStatus]}>{t(`botPolling_${bot.pollingStatus}`)}</Tag>
        </Space>}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Space wrap>
              <Button size="small" disabled={busy || !bot.enabled} onClick={() => {
                void generate({ variables: { project, id: bot.id } }).then((result) => {
                  if (result.data) setLinkCode({ ...result.data.projectTelegramBotLinkCode, username: bot.username });
                }).catch(() => {});
              }}>{t('linkBotChat')}</Button>
              <Popconfirm title={t('removeBotConfirm')} onConfirm={() => remove({ variables: { project, id: bot.id } })}>
                <Button danger size="small" disabled={busy}>{t('remove')}</Button>
              </Popconfirm>
            </Space>
            <Space wrap>
              <Typography.Text>{t('botTags')}:</Typography.Text>
              {bot.tags.map((tag) => <Tag key={tag}>#{tag}</Tag>)}
              <Button size="small" disabled={busy} onClick={() => { tagsForm.setFieldsValue({ tags: bot.tags }); setEditingTags(bot); }}>{t('editBotTags')}</Button>
            </Space>
            {bot.lastError && <Alert type="warning" showIcon title={t('botProcessingError')} description={t(`botError_${bot.lastError}`, { defaultValue: bot.lastError })} />}
            {bot.lastPolledAt && <Typography.Text type="secondary">{t('botLastPoll', { time: new Date(bot.lastPolledAt).toLocaleString() })}</Typography.Text>}
            <Typography.Text type="secondary">{t('botQueueStatus', { pending: bot.pendingCount, failed: bot.failedCount })}</Typography.Text>
            {bot.failedCount > 0 && <Button size="small" disabled={busy} onClick={() => { void retry({ variables: { project, id: bot.id } }).catch(() => {}); }}>{t('retryBotMessages')}</Button>}
            {bot.lastReceivedAt && <Typography.Text type="secondary">{t('botLastMessage', { chat: bot.lastChatTitle, time: new Date(bot.lastReceivedAt).toLocaleString() })}</Typography.Text>}
            <Table size="small" rowKey="chatId" pagination={false} dataSource={bot.chats}
              locale={{ emptyText: t('noBotChats') }} scroll={{ x: 450 }} columns={[
                { title: t('botChatTitle'), dataIndex: 'title' },
                { title: 'Telegram ID', dataIndex: 'chatId' },
                { title: t('memberActions'), key: 'actions', render: (_, chat) => <Popconfirm title={t('unlinkBotChatConfirm')}
                  onConfirm={() => unlink({ variables: { project, id: bot.id, chatId: chat.chatId } })}>
                  <Button size="small" disabled={busy}>{t('unlinkBotChat')}</Button>
                </Popconfirm> },
              ]} />
          </Space>
        </Card>
      ))}
      <Modal title={t('addBot')} open={addingOpen} destroyOnHidden onCancel={() => { if (!adding) { setAddingOpen(false); form.resetFields(); } }}
        onOk={() => form.submit()} confirmLoading={adding} okText={t('addBot')}>
        <Typography.Paragraph>{t('botTokenHelp')}</Typography.Paragraph>
        <Form form={form} layout="vertical" initialValues={{ tags: ['ошибка', 'проверка'] }} onFinish={({ token, tags }) => { void add({ variables: { project, token: token.trim(), tags } }).catch(() => {}); }}>
          <Form.Item name="token" label={t('botToken')} rules={[{ required: true }]}>
            <Input.Password autoComplete="new-password" disabled={adding} />
          </Form.Item>
          <Form.Item name="tags" label={t('botTags')} rules={tagRules} extra={t('botTagsHelp')}>
            <Select mode="tags" tokenSeparators={[',', ' ', ';']} maxCount={20} placeholder="#ошибка, #проверка" disabled={adding} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={t('editBotTags')} open={Boolean(editingTags)} onCancel={() => { if (!savingTags) setEditingTags(null); }}
        onOk={() => tagsForm.submit()} confirmLoading={savingTags} okText={t('save')}>
        <Form form={tagsForm} layout="vertical" onFinish={({ tags }) => {
          if (editingTags) void setTags({ variables: { project, id: editingTags.id, tags } }).catch(() => {});
        }}>
          <Form.Item name="tags" label={t('botTags')} rules={tagRules} extra={t('botTagsHelp')}>
            <Select mode="tags" tokenSeparators={[',', ' ', ';']} maxCount={20} placeholder="#ошибка, #проверка" disabled={savingTags} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={t('linkBotChat')} open={Boolean(linkCode)} onCancel={() => setLinkCode(null)} footer={<Button onClick={() => setLinkCode(null)}>{t('botClose')}</Button>}>
        <Typography.Paragraph>{t('botLinkInstructions', { username: linkCode?.username })}</Typography.Paragraph>
        {linkCode && <>
          <Typography.Paragraph copyable={{ text: linkCode.command }} code style={{ overflowWrap: 'anywhere' }}>{linkCode.command}</Typography.Paragraph>
          <Typography.Paragraph type="secondary">{t('botLinkExpires', { time: new Date(linkCode.expiresAt).toLocaleTimeString() })}</Typography.Paragraph>
        </>}
      </Modal>
    </Space>
  );
}
