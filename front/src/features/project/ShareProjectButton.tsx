import { ShareAltOutlined } from '@ant-design/icons';
import { Button, Modal } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectInviteLink } from './ProjectInviteLink';

/**
 * Top-of-page entry point for project sharing -- the invite link previously
 * only lived under Settings (buried the same way Approvals used to be
 * buried in Profile). This puts it one click away from the Overview page
 * itself instead of requiring a detour through the project's Settings nav
 * item first.
 */
export function ShareProjectButton({ slug }: { slug: string }) {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button icon={<ShareAltOutlined />} onClick={() => setOpen(true)}>
        {t('share')}
      </Button>
      <Modal title={t('shareThisProject')} open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
        <ProjectInviteLink slug={slug} />
      </Modal>
    </>
  );
}
