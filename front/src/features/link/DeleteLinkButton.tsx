import { useMutation } from '@apollo/client/react';
import { DeleteOutlined } from '@ant-design/icons';
import { Button, Input, Popconfirm, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DELETE_LINK } from '../../shared/api/queries';

interface Props {
  id: string;
  onDone?: () => void;
}

export function DeleteLinkButton({ id, onDone }: Props) {
  const { t } = useTranslation('links');
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [mutate, { loading }] = useMutation(DELETE_LINK, {
    onCompleted: () => { message.success(t('linkDeleted', { id })); setOpen(false); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  return (
    <Popconfirm
      open={open}
      onOpenChange={setOpen}
      title={t('deleteConfirmTitle', { id })}
      description={
        <Input
          placeholder={t('reasonOptional')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          size="small"
          style={{ marginTop: 6, width: 220 }}
        />
      }
      okText={t('delete')}
      okButtonProps={{ danger: true, loading }}
      onConfirm={() => mutate({ variables: { id, reason: reason || undefined } })}
    >
      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
    </Popconfirm>
  );
}
