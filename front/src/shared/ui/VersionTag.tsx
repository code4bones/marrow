import { Tag, Tooltip } from 'antd';

// Compact, truncating badge for last_version/projectVersion -- these are
// free-text, agent-supplied strings that can run long (e.g. a monorepo's
// "back vX / front vY"), so this always clips to maxWidth with an ellipsis
// and relies on the tooltip for the full value rather than growing the row.
export function VersionTag({ value, maxWidth = 90 }: { value: string; maxWidth?: number }) {
  return (
    <Tooltip title={value}>
      <Tag style={{
        margin: 0, fontFamily: 'monospace', fontSize: 10, lineHeight: '14px',
        padding: '0 4px', maxWidth, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </Tag>
    </Tooltip>
  );
}
