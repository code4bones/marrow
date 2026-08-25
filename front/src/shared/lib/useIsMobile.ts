import { Grid } from 'antd';

// Single source of truth for the mobile/desktop layout split across the
// app -- antd's own default breakpoint (md=768px), no ThemeProvider token
// override needed.
export function useIsMobile(): boolean {
  const bp = Grid.useBreakpoint();
  return bp.md === false;
}
