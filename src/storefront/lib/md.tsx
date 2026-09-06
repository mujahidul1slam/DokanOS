import type { ReactNode } from "react";

/**
 * Minimal zero-dependency markdown renderer for storefront editorial content
 * (about_md, policies). Supports the subset operators actually need:
 *
 *   # ## ###   headings
 *   **bold**   *italic*   [text](url) links
 *   - / *      unordered lists
 *   1. / 1)    ordered lists
 *   blank line paragraphs
 *
 * Renders React nodes — never raw HTML — so stored content cannot inject
 * markup into the page.
 */

function renderEmphasis(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${keyPrefix}-b${i}`}>{m[1]}</strong>);
    else out.push(<em key={`${keyPrefix}-i${i}`}>{m[2]}</em>);
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(text))) {
    if (m.index > last) nodes.push(...renderEmphasis(text.slice(last, m.index), `${keyPrefix}-t${i}`));
    nodes.push(
      <a
        key={`${keyPrefix}-l${i}`}
        href={m[2]}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:text-primary"
      >
        {renderEmphasis(m[1], `${keyPrefix}-li${i}`)}
      </a>,
    );
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) nodes.push(...renderEmphasis(text.slice(last), `${keyPrefix}-t${i}`));
  return nodes;
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      const content = para;
      blocks.push(
        <p key={`p${key++}`} className="mb-4 last:mb-0 leading-relaxed">
          {renderInline(content.join(" "), `p${key}`)}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    const l = list;
    if (!l) return;
    const items = l.items.map((it, idx) => <li key={idx}>{renderInline(it, `li${key}-${idx}`)}</li>);
    blocks.push(
      l.ordered ? (
        <ol key={`l${key++}`} className="list-decimal pl-6 mb-4 space-y-1">{items}</ol>
      ) : (
        <ul key={`l${key++}`} className="list-disc pl-6 mb-4 space-y-1">{items}</ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.+)$/.exec(line);
    const ol = /^\d+[.)]\s+(.+)$/.exec(line);

    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      const lvl = h[1].length;
      const cls = lvl === 1 ? "text-3xl sf-display mb-3" : lvl === 2 ? "text-2xl sf-display mb-2" : "text-lg font-semibold mb-2";
      blocks.push(<div key={`h${key++}`} className={cls}>{renderInline(h[2], `h${key}`)}</div>);
    } else if (ul) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
    } else if (ol) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();

  return <div className={className}>{blocks}</div>;
}