import { decodeEntities } from "./policy-links.ts";

export type PageText = { title: string; text: string };

// Parts of a page that aren't its content: code, menus and footers.
const SKIPPED_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "template",
  "nav",
  "footer",
]);

/** The page's title and readable text, without menus, footers or code. */
export function readPageText(html: string): PageText {
  const title = /<title\b[^>]{0,200}>([^<]{0,300})/i.exec(html)?.[1] ?? "";
  return {
    title: cleanText(title),
    text: cleanText(walkTags(mainSection(html), false)),
  };
}

/**
 * The page's main content as HTML, without menus, footers or code. Used to
 * find links a policy mentions in its own text, rather than site navigation.
 */
export function mainContentHtml(html: string): string {
  return walkTags(mainSection(html), true);
}

/** Uses the page's <main> element when it has one, since that skips headers and sidebars. */
function mainSection(html: string): string {
  const start = html.search(/<main[\s>]/i);
  if (start === -1) return html;
  const closing = /<\/main\s*>/gi;
  closing.lastIndex = start;
  const end = closing.exec(html);
  return html.slice(start, end ? closing.lastIndex : html.length);
}

/**
 * Drops skipped elements entirely. Other tags are kept, or replaced with a
 * space when we only want the text. Like the link finder, it only moves
 * forward, so a hostile page can't make it slow.
 */
function walkTags(html: string, keepTags: boolean): string {
  const parts: string[] = [];
  const tagStart = /<!--|<\/?([a-z][a-z0-9-]*)/gi;
  let position = 0;
  let match: RegExpExecArray | null;

  while ((match = tagStart.exec(html))) {
    parts.push(html.slice(position, match.index));
    const end = endOfTag(html, match, tagStart.lastIndex);
    parts.push(keepTags && isKept(match) ? html.slice(match.index, end) : " ");
    position = end;
    tagStart.lastIndex = position;
  }
  parts.push(html.slice(position));
  return parts.join("");
}

function isKept(match: RegExpExecArray): boolean {
  if (match[0] === "<!--") return false;
  const isOpening = !match[0].startsWith("</");
  return !(isOpening && SKIPPED_ELEMENTS.has(match[1].toLowerCase()));
}

function endOfTag(html: string, match: RegExpExecArray, from: number): number {
  if (match[0] === "<!--") {
    const end = html.indexOf("-->", from);
    return end === -1 ? html.length : end + 3;
  }

  const tagEnd = html.indexOf(">", from);
  if (tagEnd === -1) return html.length;

  const name = match[1].toLowerCase();
  const isOpening = !match[0].startsWith("</");
  if (!isOpening || !SKIPPED_ELEMENTS.has(name)) return tagEnd + 1;

  const closing = new RegExp(`<\\/${name}\\s*>`, "gi");
  closing.lastIndex = tagEnd;
  return closing.exec(html) ? closing.lastIndex : html.length;
}

function cleanText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}
