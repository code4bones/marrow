import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Popconfirm, Spin, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROJECT_INVITE_LINK, REGENERATE_PROJECT_INVITE_LINK } from '../../shared/api/queries';
import { CodeBlock } from '../../shared/ui/CodeBlock';

const { Paragraph } = Typography;

/**
 * Reusable per-project invite link body -- get-or-create on mount, "Copy
 * link" via the same copyable CodeBlock every token/secret display already
 * uses, "Regenerate" behind a Popconfirm. Shared by the Settings page's
 * Invite card and the Share button's modal (both project/settings/index.tsx
 * and features/project/ShareProjectButton.tsx) so the two entry points never
 * drift apart.
 */
export function ProjectInviteLink({ slug }: { slug: string }) {
  const { t } = useTranslation('projects');
  const { data, loading, error, refetch } = useQuery<{ projectInviteLink: { code: string; url: string } }>(
    PROJECT_INVITE_LINK,
    { variables: { slug }, fetchPolicy: 'network-only' },
  );
  const [regenerate, { loading: regenerating }] = useMutation(REGENERATE_PROJECT_INVITE_LINK, {
    onCompleted: () => {
      message.success(t('inviteLinkRegenerated'));
      void refetch();
    },
    onError: (e) => message.error(e.message),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        {t('inviteLinkDescription')}
      </Paragraph>
      {loading && <Spin size="small" />}
      {error && <Alert type="error" message={error.message} showIcon />}
      {data?.projectInviteLink && <CodeBlock code={data.projectInviteLink.url} />}
      <Popconfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('regenerateInviteLinkConfirmTitle')}
        description={t('regenerateInviteLinkDescription')}
        okText={t('regenerate')}
        okButtonProps={{ danger: true, loading: regenerating }}
        onConfirm={() => {
          setConfirmOpen(false);
          void regenerate({ variables: { slug } });
        }}
      >
        <Button size="small" loading={regenerating} style={{ marginTop: 8 }}>
          {t('regenerate')}
        </Button>
      </Popconfirm>
    </>
  );
}
