import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Popconfirm, Spin, Typography, message } from 'antd';
import { useState } from 'react';
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
  const { data, loading, error, refetch } = useQuery<{ projectInviteLink: { code: string; url: string } }>(
    PROJECT_INVITE_LINK,
    { variables: { slug }, fetchPolicy: 'network-only' },
  );
  const [regenerate, { loading: regenerating }] = useMutation(REGENERATE_PROJECT_INVITE_LINK, {
    onCompleted: () => {
      message.success('Invite link regenerated -- the old link no longer works');
      void refetch();
    },
    onError: (e) => message.error(e.message),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Anyone who opens this link and signs in (or already has a Marrow account) joins this project. Any current
        project member can share it. Regenerating invalidates the old link immediately.
      </Paragraph>
      {loading && <Spin size="small" />}
      {error && <Alert type="error" message={error.message} showIcon />}
      {data?.projectInviteLink && <CodeBlock code={data.projectInviteLink.url} />}
      <Popconfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Regenerate invite link?"
        description="The current link stops working immediately. Anyone who hasn't joined yet will need the new one."
        okText="Regenerate"
        okButtonProps={{ danger: true, loading: regenerating }}
        onConfirm={() => {
          setConfirmOpen(false);
          void regenerate({ variables: { slug } });
        }}
      >
        <Button size="small" loading={regenerating} style={{ marginTop: 8 }}>
          Regenerate
        </Button>
      </Popconfirm>
    </>
  );
}
