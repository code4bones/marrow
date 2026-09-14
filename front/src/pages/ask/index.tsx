import { useMutation, useQuery } from '@apollo/client/react';
import { SendOutlined, UserOutlined, RobotOutlined, DeleteOutlined } from '@ant-design/icons';
import { Alert, Avatar, Button, Empty, Input, Popconfirm, Spin, Typography, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ASK_MARROW, CLEAR_AI_CONVERSATION, GET_AI_CONVERSATION } from '../../shared/api/queries';
import type { AiChatMessage } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';

const { Text } = Typography;

function ChatBubble({ msg }: { msg: AiChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: 8, marginBottom: 14, alignItems: 'flex-start' }}>
      <Avatar size="small" icon={isUser ? <UserOutlined /> : <RobotOutlined />} style={{ flexShrink: 0, backgroundColor: isUser ? '#177ddc' : '#52c41a' }} />
      <div
        style={{
          maxWidth: '72%',
          padding: '8px 12px',
          borderRadius: 10,
          background: isUser ? '#177ddc' : 'rgba(255,255,255,0.06)',
          color: isUser ? '#fff' : undefined,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 13.5,
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

/**
 * "Ask Marrow" (owner's request, 2026-09-14) -- a chat page for talking to
 * Marrow's own embedded assistant directly, as opposed to Marrow's normal
 * mode of being called BY an already-connected agent. No token-level
 * streaming (see docs/AUTH.md's "Ask Marrow" section) -- the full answer
 * appears after the backend's tool-use loop finishes, with a loading
 * indicator meanwhile.
 */
export function AskMarrowPage() {
  const { t } = useTranslation('ask');
  const { data, loading: loadingHistory } = useQuery<{ aiConversation: AiChatMessage[] }>(GET_AI_CONVERSATION, {
    fetchPolicy: 'network-only',
  });
  // sentMessages holds only what this page visit itself added (optimistic
  // user turns + the assistant replies that came back) -- persisted
  // history from GET_AI_CONVERSATION is combined in via `messages` below
  // rather than copied into state (avoids a setState-in-effect just to
  // mirror query data). historyCleared hides the persisted history after
  // "Clear conversation" without needing to refetch.
  const [sentMessages, setSentMessages] = useState<AiChatMessage[]>([]);
  const [historyCleared, setHistoryCleared] = useState(false);
  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(
    () => (historyCleared ? sentMessages : [...(data?.aiConversation ?? []), ...sentMessages]),
    [data, sentMessages, historyCleared]
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const [ask, { loading: asking }] = useMutation<{ askMarrow: AiChatMessage }>(ASK_MARROW, {
    onCompleted: (result) => {
      setSentMessages((prev) => [...prev, result.askMarrow]);
    },
    onError: (err) => {
      setSendError(err.message);
      // Drop the optimistic user bubble on failure -- the backend never
      // persisted it either (askMarrow only appendChatTurn's on success).
      setSentMessages((prev) => prev.slice(0, -1));
    },
  });

  const [clearConversation, { loading: clearing }] = useMutation(CLEAR_AI_CONVERSATION, {
    onCompleted: () => {
      message.success(t('cleared'));
      setSentMessages([]);
      setHistoryCleared(true);
    },
    onError: (err) => message.error(err.message),
  });

  const send = () => {
    const text = input.trim();
    if (!text || asking) return;
    setSendError(null);
    setSentMessages((prev) => [...prev, { role: 'user', content: text, createdAt: null }]);
    setInput('');
    void ask({ variables: { message: text } });
  };

  const providerMissing = sendError?.toLowerCase().includes('provider');

  return (
    <PageLayout
      title={t('title')}
      subtitle={t('subtitle')}
      fill
      headerExtra={
        messages.length > 0 ? (
          <Popconfirm title={t('clearConfirmTitle')} okText={t('clear')} okButtonProps={{ danger: true, loading: clearing }} onConfirm={() => void clearConversation()}>
            <Button size="small" icon={<DeleteOutlined />}>
              {t('clear')}
            </Button>
          </Popconfirm>
        ) : undefined
      }
    >
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {loadingHistory ? (
          <Spin size="small" />
        ) : messages.length === 0 ? (
          <Empty description={t('emptyHint')} style={{ marginTop: 60 }} />
        ) : (
          messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)
        )}
        {asking && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <Avatar size="small" icon={<RobotOutlined />} style={{ backgroundColor: '#52c41a' }} />
            <Spin size="small" />
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {t('thinking')}
            </Text>
          </div>
        )}
        {sendError && (
          <Alert
            type="error"
            showIcon
            message={sendError}
            description={providerMissing ? <Link to="/profile">{t('goToProviderSettings')}</Link> : undefined}
            style={{ marginTop: 8 }}
          />
        )}
      </div>
      <div style={{ flexShrink: 0, borderTop: '1px solid #303030', padding: '12px 24px', display: 'flex', gap: 8 }}>
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={t('inputPlaceholder')}
          autoSize={{ minRows: 1, maxRows: 6 }}
          disabled={asking}
          style={{ flex: 1 }}
        />
        <Button type="primary" icon={<SendOutlined />} onClick={send} loading={asking} disabled={!input.trim()} />
      </div>
    </PageLayout>
  );
}
