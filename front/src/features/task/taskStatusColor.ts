// Split out of TaskStatusSelect.tsx (mirrors tone.tsx's split from
// RemarkPanel.tsx) purely so react-refresh/only-export-components stays
// happy — that rule requires a component file to export nothing but the
// component. TaskStatusSelect.tsx keeps exporting only its component;
// this constant lives here so other views that render a task's status
// (e.g. DecisionTimeline's generalized drill cards, T-MEMORY-049) can
// reuse the exact mapping the Tasks list page uses instead of forking a
// second copy that could drift from it.
export const TASK_STATUS_COLOR: Record<string, string> = {
  todo: '#595959', doing: '#177ddc', blocked: '#d89614',
  done: '#52c41a', cancelled: '#434343',
};
