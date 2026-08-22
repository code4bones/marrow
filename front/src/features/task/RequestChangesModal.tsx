import { Input, Modal } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}

// T-MEMORY-115: shared between the Kanban board (drag into Changes
// Requested) and TaskStatusSelect (picking it from the dropdown) -- moving a
// task into changes_requested requires a reason (it becomes the
// auto-created follow-up task's scope), so both entry points intercept the
// plain status change and collect it here first instead of firing the
// mutation with no note (which the backend would reject anyway).
export function RequestChangesModal({ open, loading, onCancel, onSubmit }: Props) {
  const { t } = useTranslation('tasks');
  const [note, setNote] = useState('');

  const submit = () => {
    const trimmed = note.trim();
    if (!trimmed) {
      return;
    }
    onSubmit(trimmed);
    setNote('');
  };

  return (
    <Modal
      open={open}
      title={t('requestChangesTitle')}
      okText={t('requestChanges')}
      onOk={submit}
      onCancel={() => { setNote(''); onCancel(); }}
      confirmLoading={loading}
      okButtonProps={{ disabled: !note.trim() }}
    >
      <Input.TextArea
        rows={4}
        autoFocus
        placeholder={t('requestChangesPlaceholder')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Modal>
  );
}
