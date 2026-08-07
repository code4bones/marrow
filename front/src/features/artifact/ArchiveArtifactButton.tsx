import { useMutation } from '@apollo/client/react';
import { InboxOutlined } from '@ant-design/icons';
import { Button, Input, Popconfirm, message } from 'antd';
import { useState } from 'react';
import { ARCHIVE_ARTIFACT } from '../../shared/api/queries';

interface Props {
  id: string;
  onDone?: () => void;
}

export function ArchiveArtifactButton({ id, onDone }: Props) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [mutate, { loading }] = useMutation(ARCHIVE_ARTIFACT, {
    onCompleted: () => { message.success(`Artifact archived`); setOpen(false); onDone?.(); },
    onError: (e) => message.error(e.message),
  });

  return (
    <Popconfirm
      open={open}
      onOpenChange={setOpen}
      title={`Archive ${id}?`}
      description={
        <Input
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          size="small"
          style={{ marginTop: 6, width: 220 }}
        />
      }
      okText="Archive"
      okButtonProps={{ loading }}
      onConfirm={() => mutate({ variables: { id, reason: reason || undefined } })}
    >
      <Button
        size="small"
        type="text"
        icon={<InboxOutlined />}
        onClick={(e) => e.stopPropagation()}
        title="Archive"
      />
    </Popconfirm>
  );
}
