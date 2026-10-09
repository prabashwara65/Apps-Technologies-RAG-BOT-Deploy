import type { ReactNode } from "react";

// React renders all source text as text nodes. No HTML is evaluated.
function inline(text: string, depth = 0): ReactNode {
  if (depth >= 8) return text;
  const tokens = /```([^`]+)```|`([^`\n]+)`|\*\*([^\n]+?)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~|~([^~\n]+)~/g;
  const result: ReactNode[] = [];
  let position = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index;
    result.push(text.slice(position, index));
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7] ?? "";
    // Underscores inside identifiers, such as user_name_id, stay literal.
    const identifier = match[5] !== undefined &&
      (/[\p{L}\p{N}]/u.test(text[index - 1] ?? "") ||
       /[\p{L}\p{N}]/u.test(text[index + match[0].length] ?? ""));
    if (!value.trim() || identifier) result.push(match[0]);
    else if (match[1] !== undefined || match[2] !== undefined) result.push(<code key={index}>{value}</code>);
    else if (match[3] !== undefined || match[4] !== undefined) result.push(<strong key={index}>{inline(value, depth + 1)}</strong>);
    else if (match[5] !== undefined) result.push(<em key={index}>{inline(value, depth + 1)}</em>);
    else result.push(<s key={index}>{inline(value, depth + 1)}</s>);
    position = index + match[0].length;
  }
  result.push(text.slice(position));
  return result;
}

const BULLET = /^\s*[-*•]\s+(.+)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.+)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.+)$/;
const FENCE = /^\s*```[^`]*$/;

/** WhatsApp-style text, plus common Markdown headings and bold markers. */
export function ReplyText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  function special(line: string) {
    return !line.trim() || FENCE.test(line) || BULLET.test(line) ||
      NUMBERED.test(line) || QUOTE.test(line) || HEADING.test(line);
  }

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const key = index;
    if (!line.trim()) { index += 1; continue; }

    if (FENCE.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? ""); index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
      continue;
    }

    const bullet = BULLET.exec(line);
    const number = NUMBERED.exec(line);
    if (bullet || number) {
      const items: ReactNode[] = [];
      const pattern = bullet ? BULLET : NUMBERED;
      while (index < lines.length) {
        const item = pattern.exec(lines[index] ?? "");
        if (!item) break;
        items.push(<li key={index}>{inline(item[bullet ? 1 : 2] ?? "")}</li>);
        index += 1;
      }
      blocks.push(bullet ? <ul key={key}>{items}</ul> :
        <ol key={key} start={Number(number?.[1] ?? 1)}>{items}</ol>);
      continue;
    }

    if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (index < lines.length) {
        const item = QUOTE.exec(lines[index] ?? "");
        if (!item) break;
        quote.push(item[1] ?? ""); index += 1;
      }
      blocks.push(<blockquote key={key}>{inline(quote.join("\n"))}</blockquote>);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push(<p className="reply-text__heading" key={key}><strong>{inline(heading[1] ?? "")}</strong></p>);
      index += 1;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && !special(lines[index] ?? "")) {
      paragraph.push(lines[index] ?? ""); index += 1;
    }
    blocks.push(<p key={key}>{inline(paragraph.join("\n"))}</p>);
  }

  return <div className="message__text reply-text">{blocks}</div>;
}
