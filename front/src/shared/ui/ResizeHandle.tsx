import { Separator } from 'react-resizable-panels';

// Thin visual line (matches the old static `borderRight: 1px solid #303030`
// these splitters replace) with a wider invisible hit area so it's easy to
// grab, and a highlight on hover/drag (`:hover`/`:active` in global.css via
// the library's own `[data-separator]` attribute) so it reads as interactive.
export function ResizeHandle() {
  return (
    <Separator
      style={{
        width: 5,
        marginLeft: -2,
        marginRight: -2,
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 1,
      }}
    >
      <div
        className="resize-handle-line"
        style={{ width: 1, height: '100%', background: '#303030' }}
      />
    </Separator>
  );
}
