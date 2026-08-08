import { useMutation } from '@apollo/client/react';
import { InboxOutlined } from '@ant-design/icons';
import { Button, Input, Popconfirm, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ARCHIVE_MEMORY } from '../../shared/api/queries';

interface Props {
  id: string;
  onDone?: () => void;
}

export function ArchiveMemoryButton({ id, onDone }: Props) {
  const { t } = useTranslation('memory');
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [mutate, { loading }] = useMutation(ARCHIVE_MEMORY, {
    onCompleted: () => { message.success(t('memoryArchived')); setOpen(false); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  return (
    <Popconfirm
      open={open}
      onOpenChange={setOpen}
      title={t('archiveConfirmTitle', { id })}
      description={
        <Input
          placeholder={t('reasonOptional')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          size="small"
          style={{ marginTop: 6, width: 220 }}
        />
      }
      okText={t('archive')}
      okButtonProps={{ loading }}
      onConfirm={() => mutate({ variables: { id, reason: reason || undefined } })}
    >
      <Button size="small" type="text" icon={<InboxOutlined />} onClick={(e) => e.stopPropagation()} title={t('archive')} />
    </Popconfirm>
  );
}
