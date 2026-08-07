import { useMutation } from '@apollo/client/react';
import { DeleteOutlined } from '@ant-design/icons';
import { Button, Checkbox, Input, Modal, Typography, message } from 'antd';
import { useState } from 'react';
import { DELETE_PROJECT } from '../../shared/api/queries';

interface Props {
  slug: string;
  onDone?: () => void;
}

export function DeleteProjectButton({ slug, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [cascade, setCascade] = useState(false);
  const [reason, setReason] = useState('');

  const [mutate, { loading }] = useMutation(DELETE_PROJECT, {
    onCompleted: () => {
      message.success(`Project "${slug}" deleted`);
      setOpen(false);
      setTyped('');
      onDone?.();
    },
    onError: (e) => message.error(e.message),
  });

  const confirmed = typed === slug;

  return (
    <>
      <Button
        size="small"
        danger
        icon={<DeleteOutlined />}
        onClick={() => setOpen(true)}
      >
        Delete Project
      </Button>
      <Modal
        open={open}
        onCancel={() => { setOpen(false); setTyped(''); }}
        onOk={() => mutate({ variables: { slug, cascade, reason: reason || undefined } })}
        okButtonProps={{ danger: true, disabled: !confirmed, loading }}
        okText="Delete"
        title={`Delete project "${slug}"`}
        width={440}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <Typography.Text type="secondary">
            Type the project slug to confirm deletion.
          </Typography.Text>
          <Input
            placeholder={slug}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            status={typed && !confirmed ? 'error' : undefined}
          />
          <Input
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Checkbox checked={cascade} onChange={(e) => setCascade(e.target.checked)}>
            <Typography.Text type="danger">Cascade delete all tasks, artifacts, decisions, events</Typography.Text>
          </Checkbox>
        </div>
      </Modal>
    </>
  );
}
