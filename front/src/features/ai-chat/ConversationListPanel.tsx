import { useMutation, useQuery } from '@apollo/client/react';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Empty, Input, List, Modal, Popconfirm, Spin, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CREATE_AI_CONVERSATION,
  DELETE_AI_CONVERSATION,
  GET_AI_CONVERSATIONS,
  RENAME_AI_CONVERSATION,
} from '../../shared/api/queries';
import { useIsMobile } from '../../shared/lib/useIsMobile';
import type { AiConversation } from '../../shared/model/types';

const { Text } = Typography;

/**
 * Left-hand "Chat List" panel on the Ask Marrow page (owner's explicit
 * follow-up ask: "New Chat & Chat List (+ delete chat), перед созданием
 * нового чата нужно ввести его название"). A titled-conversation title
 * modal is used for both create and rename (same form, different submit
 * handler) rather than two separate components.
 */
export function ConversationListPanel({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useTranslation('ask');
  const isMobile = useIsMobile();
  const { data, loading, refetch } = useQuery<{ aiConversations: AiConversation[] }>(GET_AI_CONVERSATIONS);
  const [titleModal, setTitleModal] = useState<{ mode: 'create' | 'rename'; id?: string; initial: string } | null>(null);
  const [titleInput, setTitleInput] = useState('');

  const [createConversation, { loading: creating }] = useMutation<{ createAiConversation: AiConversation }>(CREATE_AI_CONVERSATION, {
    onCompleted: (result) => {
      setTitleModal(null);
      void refetch();
      onSelect(result.createAiConversation.id);
    },
    onError: (err) => message.error(err.message),
  });
  const [renameConversation, { loading: renaming }] = useMutation(RENAME_AI_CONVERSATION, {
    onCompleted: () => {
      setTitleModal(null);
      void refetch();
    },
    onError: (err) => message.error(err.message),
  });
  const [deleteConversation] = useMutation(DELETE_AI_CONVERSATION, {
    onError: (err) => message.error(err.message),
  });
  const handleDelete = (id: string) => {
    void deleteConversation({ variables: { id } }).then(() => {
      void refetch();
      if (id === selectedId) {
        onSelect('');
      }
    });
  };

  const conversations = data?.aiConversations ?? [];

  const openCreate = () => {
    setTitleInput('');
    setTitleModal({ mode: 'create', initial: '' });
  };
  const openRename = (conv: AiConversation) => {
    setTitleInput(conv.title);
    setTitleModal({ mode: 'rename', id: conv.id, initial: conv.title });
  };
  const submitTitle = () => {
    const title = titleInput.trim();
    if (!title || !titleModal) return;
    if (titleModal.mode === 'create') {
      void createConversation({ variables: { title } });
    } else {
      void renameConversation({ variables: { id: titleModal.id, title } });
    }
  };

  return (
    <div style={isMobile
      ? { flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }
      : { width: 260, flexShrink: 0, borderRight: '1px solid #303030', display: 'flex', flexDirection: 'column', height: '100%' }
    }>
      <div style={{ padding: 12, borderBottom: '1px solid #303030' }}>
        <Button block type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t('newChat')}
        </Button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Spin size="small" style={{ margin: 16 }} />
        ) : conversations.length === 0 ? (
          <Empty description={t('noChatsYet')} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />
        ) : (
          <List
            size="small"
            dataSource={conversations}
            renderItem={(conv) => (
              <List.Item
                onClick={() => onSelect(conv.id)}
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  background: conv.id === selectedId ? 'rgba(255,255,255,0.06)' : undefined,
                  borderLeft: conv.id === selectedId ? '2px solid #177ddc' : '2px solid transparent',
                }}
                actions={[
                  <Button key="rename" size="small" type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); openRename(conv); }} />,
                  <Popconfirm
                    key="delete"
                    title={t('deleteChatConfirmTitle', { title: conv.title })}
                    okText={t('delete')}
                    okButtonProps={{ danger: true }}
                    onConfirm={(e) => { e?.stopPropagation(); handleDelete(conv.id); }}
                  >
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>,
                ]}
              >
                <Text ellipsis style={{ maxWidth: 140, fontSize: 13 }}>{conv.title}</Text>
              </List.Item>
            )}
          />
        )}
      </div>

      <Modal
        open={!!titleModal}
        title={titleModal?.mode === 'create' ? t('newChat') : t('renameChat')}
        onCancel={() => setTitleModal(null)}
        onOk={submitTitle}
        confirmLoading={creating || renaming}
        okButtonProps={{ disabled: !titleInput.trim() }}
      >
        <Input
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          onPressEnter={submitTitle}
          placeholder={t('chatTitlePlaceholder')}
          autoFocus
        />
      </Modal>
    </div>
  );
}
