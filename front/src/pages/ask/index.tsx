import { useMutation, useQuery } from '@apollo/client/react';
import { SendOutlined, UserOutlined, RobotOutlined, MessageOutlined } from '@ant-design/icons';
import { Alert, Avatar, Button, Empty, Input, Spin, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ASK_MARROW, GET_AI_CONVERSATIONS, GET_AI_CONVERSATION_MESSAGES } from '../../shared/api/queries';
import type { AiChatMessage, AiConversation } from '../../shared/model/types';
import { ConversationListPanel } from '../../features/ai-chat/ConversationListPanel';
import { Markdown } from '../../shared/ui/Markdown';
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
          wordBreak: 'break-word',
        }}
      >
        {isUser ? (
          <span style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{msg.content}</span>
        ) : (
          <Markdown>{msg.content}</Markdown>
        )}
      </div>
    </div>
  );
}

/**
 * The right-hand chat pane for one conversation. Mounted with
 * key={conversationId} by the parent (same remount-on-identity-change
 * pattern as ProjectOverview's own key={slug} elsewhere in this app) so
 * switching conversations resets all local state for free instead of a
 * setState-in-effect.
 */
function ChatPane({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('ask');
  const { data, loading: loadingHistory } = useQuery<{ aiConversationMessages: AiChatMessage[] }>(GET_AI_CONVERSATION_MESSAGES, {
    variables: { id: conversationId },
    fetchPolicy: 'network-only',
  });
  const [sentMessages, setSentMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(
    () => [...(data?.aiConversationMessages ?? []), ...sentMessages],
    [data, sentMessages]
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

  const send = () => {
    const text = input.trim();
    if (!text || asking) return;
    setSendError(null);
    setSentMessages((prev) => [...prev, { role: 'user', content: text, createdAt: null }]);
    setInput('');
    void ask({ variables: { conversationId, message: text } });
  };

  const providerMissing = sendError?.toLowerCase().includes('provider');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
    </div>
  );
}

/**
 * "Ask Marrow" (owner's request, 2026-09-14) -- a chat page for talking to
 * Marrow's own embedded assistant directly, as opposed to Marrow's normal
 * mode of being called BY an already-connected agent. Two-pane layout
 * (owner's same-day follow-up: "New Chat & Chat List (+ delete chat)") --
 * ConversationListPanel on the left, the selected conversation's chat on
 * the right, driven by the optional :conversationId route param. No
 * token-level streaming (see docs/AUTH.md's "Ask Marrow" section) -- the
 * full answer appears after the backend's tool-use loop finishes, with a
 * loading indicator meanwhile.
 */
export function AskMarrowPage() {
  const { t } = useTranslation('ask');
  const { conversationId = '' } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const onSelect = (id: string) => navigate(id ? `/ask/${id}` : '/ask');

  const { data: conversationsData } = useQuery<{ aiConversations: AiConversation[] }>(GET_AI_CONVERSATIONS);
  const activeConversation = conversationsData?.aiConversations.find((c) => c.id === conversationId);

  return (
    <PageLayout title={activeConversation?.title ?? t('title')} subtitle={conversationId ? undefined : t('subtitle')} fill>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <ConversationListPanel selectedId={conversationId || null} onSelect={onSelect} />

        {!conversationId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty image={<MessageOutlined style={{ fontSize: 40, opacity: 0.4 }} />} description={t('selectOrCreateChat')} />
          </div>
        ) : (
          <ChatPane key={conversationId} conversationId={conversationId} />
        )}
      </div>
    </PageLayout>
  );
}
