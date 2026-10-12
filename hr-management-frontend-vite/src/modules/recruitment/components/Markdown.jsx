import React from 'react';

/**
 * Tiny, safe Markdown subset for job descriptions (no HTML injection —
 * everything renders as React text nodes):
 *   # / ## / ### headings, - or * bullets, 1. numbered lists, blank-line
 *   paragraphs, **bold**, _italic_ and [links](https://…).
 */

const INLINE = /(\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;

function renderInline(text, keyPrefix) {
  const parts = String(text).split(INLINE).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer nofollow" className="text-slate-900 underline underline-offset-2">{link[1]}</a>;
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export default function Markdown({ text, className = '' }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let list = null;
  let para = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join(' ') });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) { flushPara(); flushList(); continue; }
    if (heading) { flushPara(); flushList(); blocks.push({ type: `h${heading[1].length}`, text: heading[2] }); continue; }
    if (bullet || numbered) {
      flushPara();
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();

  if (!blocks.length) return null;
  return (
    <div className={`space-y-3 text-sm sm:text-[15px] leading-relaxed text-slate-700 ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'h1') return <h3 key={i} className="text-lg font-bold text-slate-900 pt-2">{renderInline(b.text, i)}</h3>;
        if (b.type === 'h2') return <h4 key={i} className="text-base font-bold text-slate-900 pt-2">{renderInline(b.text, i)}</h4>;
        if (b.type === 'h3') return <h5 key={i} className="text-sm font-semibold text-slate-900 pt-1">{renderInline(b.text, i)}</h5>;
        if (b.type === 'ul' || b.type === 'ol') {
          const Tag = b.type;
          return (
            <Tag key={i} className={`${b.type === 'ul' ? 'list-disc' : 'list-decimal'} pl-5 space-y-1`}>
              {b.items.map((item, j) => <li key={j}>{renderInline(item, `${i}-${j}`)}</li>)}
            </Tag>
          );
        }
        return <p key={i}>{renderInline(b.text, i)}</p>;
      })}
    </div>
  );
}
