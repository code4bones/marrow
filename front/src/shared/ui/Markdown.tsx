import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const CODE_BLOCK_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid #303030',
  borderRadius: 4,
  padding: 12,
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowX: 'auto',
  margin: '8px 0',
};

// Fields like decision.rationale / task.scope are free-text markdown written
// by agents (lists, bold, inline code, links to other record ids) -- render
// it instead of dumping raw asterisks/dashes as plain text.
export function Markdown({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: c }) => <p style={{ margin: '0 0 8px' }}>{c}</p>,
          ul: ({ children: c }) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{c}</ul>,
          ol: ({ children: c }) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{c}</ol>,
          li: ({ children: c }) => <li style={{ marginBottom: 2 }}>{c}</li>,
          a: ({ children: c, href }) => (
            <a href={href} target="_blank" rel="noreferrer">{c}</a>
          ),
          code: ({ className, children: c }) => (
            className ? <code className={className}>{c}</code>
              : <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>{c}</code>
          ),
          pre: ({ children: c }) => <pre style={CODE_BLOCK_STYLE}>{c}</pre>,
          blockquote: ({ children: c }) => (
            <blockquote style={{ margin: '0 0 8px', paddingLeft: 12, borderLeft: '2px solid #434343', opacity: 0.85 }}>
              {c}
            </blockquote>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
