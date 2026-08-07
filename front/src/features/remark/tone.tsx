import { FrownOutlined, MessageOutlined, SmileOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

// Remarks (I-PMEM idea, owner: "дополнить ноду своим комментарием... отметить
// как 'я ошибся' или 'это гениально — имей в виду'") are ordinary memory
// items (type: "remark") linked to their target via relation "annotates" —
// no backend change needed, reusing memory.create/memory.update/links
// (T-MEMORY-032) end to end. Both strong tones get tagged read-first;
// surfacing read-first ahead of everything else in search/preflight is a
// separate backend follow-up, not done here.
//
// Split out of RemarkPanel.tsx (D-MEMORY-015) into its own module so
// T-MEMORY-045's timeline bottom remark indicator can import the exact same
// tone→color/icon/label mapping instead of forking a second copy that could
// drift — and so RemarkPanel.tsx keeps exporting only its component
// (react-refresh/only-export-components requires that for fast refresh).
export type Tone = 'mistake' | 'praise' | 'note';

export const TONE_META: Record<Tone, { label: string; icon: ReactNode; color: string; placeholder: string; title: string }> = {
  mistake: {
    label: 'I was wrong',
    icon: <FrownOutlined />,
    color: '#a61d24',
    placeholder: 'What did I get wrong, and why?',
    title: 'Remark: I was wrong',
  },
  praise: {
    label: 'Genius — keep in mind',
    icon: <SmileOutlined />,
    color: '#389e0d',
    placeholder: 'What was right, and why keep it in mind?',
    title: 'Remark: keep in mind',
  },
  note: {
    label: 'Note',
    icon: <MessageOutlined />,
    color: '#8c8c8c',
    placeholder: 'Add a remark…',
    title: 'Remark',
  },
};

export function toneOf(tags: string[]): Tone {
  if (tags.includes('tone:mistake')) return 'mistake';
  if (tags.includes('tone:praise')) return 'praise';
  return 'note';
}
