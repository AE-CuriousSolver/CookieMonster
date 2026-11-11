import {
  categoriesOf,
  compareLinks,
  isExcluded,
  isGateway,
  matchWords,
  mergeMatches,
  scoreFor,
  type LinkLocation,
  type PolicyMatch,
} from "./link-score.ts";
import { POLICY_CATEGORIES, TOPIC_WORDS, type PolicyCategory } from "./link-rules.ts";

/** How often one of our topic words appears in a page's text. */
export type WordCount = {
  category: PolicyCategory;
  keyword: string;
  count: number;
};

export type PolicyLink = {
  /** Without ?query, #hash or a trailing slash. */
  url: string;
  text: string;
  categories: PolicyCategory[];
  /** Why a link was picked: which words matched, and where. */
  matches: PolicyMatch[];
  location: LinkLocation;
  /** How likely this is the right document. Weights are in link-rules.ts. */
  score: number;
  /** A page like "All legal documents": opened to find policies, never a result. */
  gateway?: boolean;
};

const MAX_LINK_HTML_LENGTH = 2000;

// The HTML tags that mark out parts of a page. Sites that build a footer from
// plain <div>s instead will show up as "page body".
const PAGE_SECTIONS = ["header", "nav", "main", "aside", "footer"];
const MAX_SECTIONS = 200;

/**
 * Finds privacy, cookie and terms links on a homepage, plus gateway links like
 * "All legal documents" (gateway: true, no categories). If the page has a
 * <footer> with any of these, only footer links are used; otherwise the whole
 * page. Sorted best first.
 */
export function findPolicyLinks(html: string, pageUrl: string): PolicyLink[] {
  const footers = findSections(html).filter((section) => section.name === "footer");
  const all = readPolicyAnchors(html, pageUrl);
  const inFooter = all.filter((anchor) =>
    footers.some((footer) => footer.start <= anchor.index && anchor.index < footer.end),
  );
  return inFooter.length > 0 ? collect(inFooter, "footer") : collect(all, "page");
}

/**
 * Policy links on a page the homepage links to, e.g. a privacy hub's link to
 * the full policy. Pass only the page's main content. No gateways: we only go
 * one level deep.
 */
export function findLinkedPolicyLinks(html: string, pageUrl: string): PolicyLink[] {
  return collect(
    readPolicyAnchors(html, pageUrl).filter((anchor) => !anchor.gateway),
    "linked",
  );
}

type Anchor = ReturnType<typeof readPolicyAnchors>[number];

/** Merges links to the same page and scores them. Best first. */
function collect(anchors: Anchor[], location: LinkLocation): PolicyLink[] {
  const found = new Map<string, PolicyLink>();
  for (const { url, text, matches, gateway } of anchors) {
    const key = linkKey(url);
    const existing = found.get(key);
    if (existing) {
      existing.matches = mergeMatches(existing.matches, matches);
      existing.categories = categoriesOf(existing.matches);
      existing.score = scoreFor(location, existing.matches);
      if (existing.gateway && !gateway) delete existing.gateway;
      if (existing.text.length < text.length) existing.text = text;
      if (url.length < existing.url.length) existing.url = url;
      continue;
    }
    found.set(key, {
      url,
      text,
      categories: categoriesOf(matches),
      matches,
      location,
      score: scoreFor(location, matches),
      ...(gateway && { gateway }),
    });
  }
  return [...found.values()].sort(compareLinks);
}

/** Every web link on the page with a topic word, or a gateway word in its text. */
function readPolicyAnchors(html: string, pageUrl: string) {
  const base = new URL(pageUrl);
  const result: {
    index: number;
    url: string;
    text: string;
    matches: PolicyMatch[];
    gateway: boolean;
  }[] = [];

  for (const anchor of readAnchors(html)) {
    const href = readHref(anchor.attributes);
    if (!href) continue;

    let absolute: URL;
    try {
      absolute = new URL(href, base);
    } catch {
      continue;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") continue;

    const url = normaliseUrl(absolute);
    const text = linkText(anchor.innerHtml, absolute);
    const path = new URL(url).pathname;
    // Only the link text and path: the domain would match every link on a site
    // like cookies.com.
    const matches = mergeMatches([], [...matchWords(text, "text"), ...matchWords(path, "path")]);
    const isCandidate = categoriesOf(matches).length > 0;
    const gateway = !isCandidate && isGateway(text);
    if (!isCandidate && !gateway) continue;
    if (isExcluded(text, path)) continue;

    result.push({ index: anchor.index, url, text, matches, gateway });
  }
  return result;
}

/** Drops the ?query, #hash and trailing slash: "/privacy/?cid=x#top" → "/privacy". */
export function normaliseUrl(url: URL | string): string {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  const href = parsed.toString();
  return parsed.pathname === "/" ? href.replace(/\/$/, "") : href.replace(/\/+$/, "");
}

/**
 * Looks through every link on a page (not only policy ones) for links to
 * targetUrl. Ignores http/https, "www." and a trailing slash when comparing.
 * Returns the link's text and where it sat, or null if the page doesn't link to it.
 */
export function findLinkTo(
  html: string,
  pageUrl: string,
  targetUrl: string,
): { text: string; foundIn: string[] } | null {
  const base = new URL(pageUrl);
  const target = linkKey(targetUrl);
  const sections = findSections(html);
  let found: { text: string; foundIn: string[] } | null = null;

  for (const anchor of readAnchors(html)) {
    const href = readHref(anchor.attributes);
    if (!href) continue;
    let absolute: URL;
    try {
      absolute = new URL(href, base);
    } catch {
      continue;
    }
    if (linkKey(absolute.href) !== target) continue;

    const text = linkText(anchor.innerHtml, absolute);
    const where = sectionAt(sections, anchor.index);
    found ??= { text, foundIn: [] };
    if (found.text.length < text.length) found.text = text;
    if (!found.foundIn.includes(where)) found.foundIn.push(where);
  }
  return found;
}

/**
 * Links to the same page share a key. Ignores http/https, "www.", a trailing
 * slash and the query string, so "/privacy" and "/privacy/?cid=footer" match.
 */
export function linkKey(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname.replace(/^www\./, "") + parsed.pathname.replace(/\/$/, "");
}

/** Counts our topic words in a page's text, most frequent first. */
export function countCategoryWords(text: string): WordCount[] {
  const counts: WordCount[] = [];
  for (const category of POLICY_CATEGORIES) {
    for (const pattern of TOPIC_WORDS[category]) {
      for (const [found] of text.matchAll(new RegExp(pattern.source, "gi"))) {
        const keyword = found.toLowerCase();
        const existing = counts.find(
          (count) => count.category === category && count.keyword === keyword,
        );
        if (existing) existing.count++;
        else counts.push({ category, keyword, count: 1 });
      }
    }
  }
  return counts.sort((a, b) => b.count - a.count);
}

export function looksLikeBlockPage(html: string): boolean {
  const head = html.slice(0, 8000).toLowerCase();
  return [
    "cf-challenge",
    "cf-browser-verification",
    "just a moment",
    "attention required",
    "enable javascript and cookies",
    "pardon our interruption",
    "access denied",
    "request blocked",
    "bot verification",
    "verify you are human",
  ].some((marker) => head.includes(marker));
}

/**
 * Walks the page once, skipping comments, scripts and styles. Each search moves
 * forward and an unclosed tag ends the walk, so a hostile page can't make this
 * slow. A single regex over the whole page takes minutes on crafted input.
 */
function* readAnchors(
  html: string,
): Generator<{ index: number; attributes: string; innerHtml: string }> {
  const opening = /<!--|<script\b|<style\b|<a(?=[\s>])/gi;
  let match: RegExpExecArray | null;

  while ((match = opening.exec(html))) {
    const token = match[0].toLowerCase();
    const closing =
      token === "<!--" ? /-->/g
      : token === "<a" ? /<\/a\s*>/gi
      : new RegExp(`<\\/${token.slice(1)}\\s*>`, "gi");

    const tagEnd = token === "<!--" ? opening.lastIndex : html.indexOf(">", opening.lastIndex);
    if (tagEnd === -1) return;

    closing.lastIndex = tagEnd;
    const end = closing.exec(html);
    if (!end) return;
    opening.lastIndex = closing.lastIndex;

    if (token === "<a") {
      yield {
        index: match.index,
        attributes: html.slice(match.index + token.length, tagEnd),
        innerHtml: html.slice(tagEnd + 1, end.index).slice(0, MAX_LINK_HTML_LENGTH),
      };
    }
  }
}

type Section = { name: string; start: number; end: number };

/** Where each <header>, <nav>, <main>, <aside> and <footer> starts and ends. */
function findSections(html: string): Section[] {
  const sections: Section[] = [];
  for (const name of PAGE_SECTIONS) {
    const opening = new RegExp(`<${name}(?=[\\s>])`, "gi");
    const closing = new RegExp(`<\\/${name}\\s*>`, "gi");
    let match: RegExpExecArray | null;
    while (sections.length < MAX_SECTIONS && (match = opening.exec(html))) {
      closing.lastIndex = opening.lastIndex;
      const end = closing.exec(html);
      if (!end) break;
      sections.push({ name, start: match.index, end: closing.lastIndex });
      opening.lastIndex = closing.lastIndex;
    }
  }
  // Sorted by start, so the outer section comes before the one inside it.
  return sections.sort((a, b) => a.start - b.start);
}

function sectionAt(sections: Section[], index: number): string {
  const containing = sections.filter((section) => section.start <= index && index < section.end);
  return containing.length > 0
    ? containing.map((section) => section.name).join(" > ")
    : "page body";
}

function readHref(attributes: string): string | null {
  const match = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
    attributes,
  );
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return null;
  const href = decodeEntities(raw).trim();
  if (!href || href.startsWith("#")) return null;
  return href;
}

function linkText(innerHtml: string, url: URL): string {
  const text = decodeEntities(innerHtml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text.slice(0, 140);
  const lastSegment = url.pathname.split("/").filter(Boolean).pop();
  return lastSegment ? safeDecodeUri(lastSegment) : url.hostname;
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

// One pass, so "&amp;lt;" becomes the text "&lt;" rather than "<".
export function decodeEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal?: string, hex?: string, name?: string) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
      const codePoint = decimal ? Number(decimal) : parseInt(hex ?? "", 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    },
  );
}
