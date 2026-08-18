// Email local-part only ("code4bones", not "code4bones@gmail.com") -- the
// full value belongs in a tooltip wherever this is used. Non-email labels
// (a plain client label with no "@") pass through unchanged. A standalone
// file (not exported from shared/ui/Timestamp.tsx) so components other
// than Timestamp itself (e.g. GraphTree/DecisionTimeline's own author
// labels) can import it without tripping react-refresh's
// only-export-components rule on a UI component file.
export function shortAuthor(author: string): string {
  const at = author.indexOf('@');
  return at > 0 ? author.slice(0, at) : author;
}
