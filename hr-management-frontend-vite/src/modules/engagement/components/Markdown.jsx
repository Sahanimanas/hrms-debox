// Safe renderer for the small markdown subset used in announcements and
// policies: **bold**, *italic* / _italic_, [links](https://…), bullet lists
// ("- " or "* ") and paragraphs. Everything is rendered as React text nodes —
// raw HTML in the source is shown as text, never injected.
import React from 'react';

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

// Order matters: links first, then bold, then italics.
const INLINE = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g;

function renderInline(text, keyPrefix) {
  const out = [];
  let last = 0;
  let match;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${i++}`;
    if (match[1] !== undefined) {
      const href = match[2];
      out.push(SAFE_URL.test(href)
        ? <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-sky-700 underline underline-offset-2 hover:text-sky-900 break-words">{match[1]}</a>
        : <span key={key}>{match[1]}</span>);
    } else if (match[3] !== undefined) {
      out.push(<strong key={key} className="font-semibold">{match[3]}</strong>);
    } else {
      out.push(<em key={key}>{match[4] ?? match[5]}</em>);
    }
    last = INLINE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text, className = '', clamp = 0 }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', lines: para });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'ul', items: list });
    list = [];
  };

  for (const raw of lines) {
    const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else if (!raw.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(raw);
    }
  }
  flushPara();
  flushList();

  const shown = clamp ? blocks.slice(0, clamp) : blocks;

  return (
    <div className={`space-y-2 text-sm text-slate-700 leading-relaxed break-words ${className}`}>
      {shown.map((b, bi) => (b.type === 'ul' ? (
        <ul key={bi} className="list-disc pl-5 space-y-1">
          {b.items.map((item, ii) => <li key={ii}>{renderInline(item, `${bi}-${ii}`)}</li>)}
        </ul>
      ) : (
        <p key={bi}>
          {b.lines.map((line, li) => (
            <React.Fragment key={li}>
              {li > 0 && <br />}
              {renderInline(line, `${bi}-${li}`)}
            </React.Fragment>
          ))}
        </p>
      )))}
      {clamp > 0 && blocks.length > clamp && <p className="text-xs text-slate-400">…</p>}
    </div>
  );
}
