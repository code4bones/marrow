import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ProjectMemberRole } from '../model/types';

const ROLE_COLOR: Record<ProjectMemberRole, string> = {
  pm: 'gold',
  developer: 'blue',
  tester: 'purple',
};

/** T-context: shows the viewer's own resolved role on this project -- reuses the rolePm/roleDeveloper/roleTester labels already seeded for the Members section (T-MEMORY-110). */
export function RoleBadge({ role }: { role: ProjectMemberRole | null }) {
  const { t } = useTranslation('projects');
  if (!role) {
    return null;
  }
  const label = { pm: t('rolePm'), developer: t('roleDeveloper'), tester: t('roleTester') }[role];
  return <Tag color={ROLE_COLOR[role]} style={{ margin: 0 }}>{label}</Tag>;
}
