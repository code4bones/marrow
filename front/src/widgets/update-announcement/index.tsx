import { Modal, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHANGELOG, type ChangelogEntry } from '../../shared/data/changelog';

// T-context (2026-08-25, owner's ask: "уведомление об обновлении... если
// пользователь рефрешнулся, или заново зашел, и версия сменилась, показываем
// диалог, что произошло"): shows once per browser when new CHANGELOG entries
// exist since this browser's own last-seen marker. A brand-new browser (no
// marker at all) gets silently baselined to the latest entry instead of being
// shown the entire historical changelog on first-ever visit -- there's
// nothing to announce relative to a version they've never used.
const LAST_SEEN_KEY = 'marrow_changelog_last_seen_id';

function readLastSeenId(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function writeLastSeenId(id: number): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(id));
  } catch {
    // localStorage can throw in a private/locked-down context -- worst case
    // the dialog reappears next visit, not worth surfacing an error for.
  }
}

// Computed once via a lazy useState initializer (not an effect + setState)
// so the very first render already knows what to show -- no cascading
// re-render, no flash of an empty modal before the check resolves.
function computeUnseenEntries(): ChangelogEntry[] {
  const latestId = CHANGELOG[0]?.id ?? 0;
  const lastSeen = readLastSeenId();
  if (lastSeen === null) {
    // First-ever visit on this browser -- nothing to announce relative to
    // a version this browser never used; just baseline silently.
    writeLastSeenId(latestId);
    return [];
  }
  return CHANGELOG.filter((entry) => entry.id > lastSeen);
}

export function UpdateAnnouncementModal() {
  const { t } = useTranslation('common');
  const [entries] = useState<ChangelogEntry[]>(computeUnseenEntries);
  const [open, setOpen] = useState(() => entries.length > 0);

  const close = () => {
    setOpen(false);
    writeLastSeenId(CHANGELOG[0]?.id ?? 0);
  };

  return (
    <Modal open={open} onCancel={close} onOk={close} title={t('whatsNewTitle')} okText={t('whatsNewGotIt')} cancelButtonProps={{ style: { display: 'none' } }}>
      {entries.map((entry) => (
        <div key={entry.id} style={{ marginBottom: 16 }}>
          <Typography.Text strong style={{ fontSize: 15 }}>
            {entry.title}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
            {entry.date}
          </Typography.Text>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {entry.items.map((item) => (
              <li key={item} style={{ marginBottom: 4, fontSize: 13.5 }}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Modal>
  );
}
