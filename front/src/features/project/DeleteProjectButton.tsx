import { useApolloClient, useMutation } from '@apollo/client/react';
import { DeleteOutlined } from '@ant-design/icons';
import { Button, Checkbox, Input, Modal, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DELETE_PROJECT } from '../../shared/api/queries';

interface Props {
  slug: string;
  onDone?: () => void;
}

export function DeleteProjectButton({ slug, onDone }: Props) {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [cascade, setCascade] = useState(false);
  const [reason, setReason] = useState('');
  const client = useApolloClient();

  const [mutate, { loading }] = useMutation(DELETE_PROJECT, {
    onCompleted: (result) => {
      message.success(t('projectDeleted', { slug }));
      setOpen(false);
      setTyped('');
      // Now called from the project settings page (a different route than
      // the project list), so unlike the old inline placement, the list's
      // own GET_PROJECTS query isn't necessarily mounted right now to just
      // refetch() -- evict the deleted Project from the normalized cache so
      // it's already gone by the time the caller navigates back to
      // /projects (Apollo automatically drops the now-dangling reference
      // from any cached `projects` array field, no manual cache.modify
      // needed -- see the Apollo Client cache.evict docs).
      const deletedId = (result as { deleteProject?: { deletedProject?: { id?: string } } } | null | undefined)
        ?.deleteProject?.deletedProject?.id;
      if (deletedId) {
        client.cache.evict({ id: client.cache.identify({ __typename: 'Project', id: deletedId }) });
        client.cache.gc();
      }
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
        {t('deleteProject')}
      </Button>
      <Modal
        open={open}
        onCancel={() => { setOpen(false); setTyped(''); }}
        onOk={() => mutate({ variables: { slug, cascade, reason: reason || undefined } })}
        okButtonProps={{ danger: true, disabled: !confirmed, loading }}
        okText={t('delete')}
        title={t('deleteProjectConfirmTitle', { slug })}
        width={440}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <Typography.Text type="secondary">
            {t('typeSlugToConfirm')}
          </Typography.Text>
          <Input
            placeholder={slug}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            status={typed && !confirmed ? 'error' : undefined}
          />
          <Input
            placeholder={t('reasonOptional')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Checkbox checked={cascade} onChange={(e) => setCascade(e.target.checked)}>
            <Typography.Text type="danger">{t('cascadeDeleteWarning')}</Typography.Text>
          </Checkbox>
        </div>
      </Modal>
    </>
  );
}
