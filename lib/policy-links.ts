export const POLICY_CATEGORIES = [
  "privacy",
  "cookies",
  "terms",
  "data",
  "access",
  "security",
  // Experimental: to see how many policies the word "policy" alone would catch.
  "policy",
] as const;

export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

/** Why a link was picked: which word matched, and where. For checking results. */
export type PolicyMatch = {
  category: PolicyCategory;
  keyword: string;
  where: "text" | "path";
};

/** How often one of our words appears in a page's text. */
export type WordCount = {
  category: PolicyCategory;
  keyword: string;
  count: number;
};

export type PolicyLink = {
  url: string;
  text: string;
  categories: PolicyCategory[];
  matches: PolicyMatch[];
  /** Which parts of the page the link sat in, e.g. "footer" or "footer > nav". */
  foundIn: string[];
};

const CATEGORY_PATTERNS: Record<PolicyCategory, RegExp[]> = {
  privacy: [
    /privacy/i,
    /\bgdpr\b/i,
    /\bccpa\b/i,
    /\bcpra\b/i,
  ],
  cookies: [/cookie/i],
  terms: [
    /\bterms\b/i,
    /terms[-_\s]?(of|and|conditions)/i,
    /\beula\b/i,
    /\blegal\b/i,
  ],
  data: [
    /data[-_\s]?protection/i,
    /data[-_\s]?policy/i,
    /data[-_\s]?processing/i,
    /personal[-_\s]?(data|information)/i,
    /subject[-_\s]?access/i,
    /do[-_\s]?not[-_\s]?sell/i,
    /\bdpa\b/i,
  ],
  access: [/access[-_\s]?policy/i, /subject[-_\s]?access/i],
  security: [
    /security/i,
    /trust[-_\s]?cent(er|re)/i,
    /responsible[-_\s]?disclosure/i,
    /vulnerability/i,
    /bug[-_\s]?bounty/i,
  ],
  policy: [/polic(y|ies)/i],
};

// Links we never want, even when they match a category, e.g. "Affiliate terms".
// Checked against the link text and path.
const EXCLUDED_PATTERNS: RegExp[] = [/affiliate/i];

const MAX_LINK_HTML_LENGTH = 2000;

// The HTML tags that mark out parts of a page. Sites that build a footer from
// plain <div>s instead will show up as "page body".
const PAGE_SECTIONS = ["header", "nav", "main", "aside", "footer"];
const MAX_SECTIONS = 200;

export function findPolicyLinks(html: string, pageUrl: string): PolicyLink[] {
  const base = new URL(pageUrl);
  const found = new Map<string, PolicyLink>();
  const sections = findSections(html);

  for (const anchor of readAnchors(html)) {
    const href = readHref(anchor.attributes);
    if (!href) continue;

    let absolute: URL;
    try {
      absolute = new URL(href, base);
    } catch {
      continue;
    }

    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
      continue;
    }

    absolute.hash = "";
    const text = linkText(anchor.innerHtml, absolute);
    // Only the link text and path: the domain would match every link on a site
    // like cookies.com.
    const matches = matchesFor(text, absolute.pathname);
    if (matches.length === 0) continue;
    if (isExcluded(text, absolute.pathname)) continue;

    const url = absolute.toString();
    const key = linkKey(url);
    const where = sectionAt(sections, anchor.index);
    const existing = found.get(key);
    if (existing) {
      existing.matches = mergeMatches(existing.matches, matches);
      existing.categories = categoriesOf(existing.matches);
      if (!existing.foundIn.includes(where)) existing.foundIn.push(where);
      if (existing.text.length < text.length) existing.text = text;
      // Prefer the cleanest version, e.g. without "?cid=footer" tracking.
      if (url.length < existing.url.length) existing.url = url;
      continue;
    }

    found.set(key, {
      url,
      text,
      categories: categoriesOf(matches),
      matches,
      foundIn: [where],
    });
  }

  return [...found.values()].sort((a, b) => {
    const categoryOrder =
      POLICY_CATEGORIES.indexOf(a.categories[0]) -
      POLICY_CATEGORIES.indexOf(b.categories[0]);
    if (categoryOrder !== 0) return categoryOrder;
    return a.text.localeCompare(b.text);
  });
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

/** Counts our category words in a page's text, most frequent first. */
export function countCategoryWords(text: string): WordCount[] {
  const counts: WordCount[] = [];
  for (const category of POLICY_CATEGORIES) {
    for (const pattern of CATEGORY_PATTERNS[category]) {
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

function isExcluded(text: string, path: string): boolean {
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(text) || pattern.test(path));
}

function matchesFor(text: string, path: string): PolicyMatch[] {
  const matches: PolicyMatch[] = [];
  for (const category of POLICY_CATEGORIES) {
    for (const pattern of CATEGORY_PATTERNS[category]) {
      for (const [where, value] of [["text", text], ["path", path]] as const) {
        const keyword = pattern.exec(value)?.[0];
        if (keyword) matches.push({ category, keyword, where });
      }
    }
  }
  return mergeMatches([], matches);
}

/** Drops repeats, e.g. "privacy" in the text of two links to the same page. */
export function mergeMatches(current: PolicyMatch[], next: PolicyMatch[]): PolicyMatch[] {
  const merged = [...current];
  for (const match of next) {
    const isRepeat = merged.some(
      (seen) =>
        seen.category === match.category &&
        seen.where === match.where &&
        seen.keyword.toLowerCase() === match.keyword.toLowerCase(),
    );
    if (!isRepeat) merged.push(match);
  }
  return merged;
}

export function categoriesOf(matches: PolicyMatch[]): PolicyCategory[] {
  return POLICY_CATEGORIES.filter((category) =>
    matches.some((match) => match.category === category),
  );
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
