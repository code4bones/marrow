import { Tooltip, Typography } from 'antd';
import { shortAuthor } from '../lib/shortAuthor';

function fmt(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * T-MEMORY-085: `author` is an already-resolved display label (email or
 * client label), not a raw clientId -- callers get it from useActorLabels
 * and pass it in, so this component stays a pure renderer with no query of
 * its own. Stacked on two lines (author above, date below) rather than one
 * "author · date" line -- a single line at a readable font size didn't fit
 * the existing table column widths.
 */
export function Timestamp({ value, author }: { value: string | null | undefined; author?: string | null }) {
  if (!value) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Tooltip title={author ? `${author} · ${value}` : value}>
      <div style={{ lineHeight: 1.35 }}>
        {author && (
          <Typography.Text
            type="secondary"
            style={{ fontSize: 10.5, whiteSpace: 'nowrap', display: 'block', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {shortAuthor(author)}
          </Typography.Text>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          {fmt(value)}
        </Typography.Text>
      </div>
    </Tooltip>
  );
}
