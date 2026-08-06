import { useMutation } from '@apollo/client/react';
import { DeleteOutlined } from '@ant-design/icons';
import { Button, Input, Popconfirm, message } from 'antd';
import { useState } from 'react';
import { DELETE_LINK } from '../../shared/api/queries';

interface Props {
  id: string;
  onDone?: () => void;
}

export function DeleteLinkButton({ id, onDone }: Props) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [mutate, { loading }] = useMutation(DELETE_LINK, {
    onCompleted: () => { message.success(`Link ${id} deleted`); setOpen(false); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  return (
    <Popconfirm
      open={open}
      onOpenChange={setOpen}
      title={`Delete ${id}?`}
      description={
        <Input
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          size="small"
          style={{ marginTop: 6, width: 220 }}
        />
      }
      okText="Delete"
      okButtonProps={{ danger: true, loading }}
      onConfirm={() => mutate({ variables: { id, reason: reason || undefined } })}
    >
      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
    </Popconfirm>
  );
}
