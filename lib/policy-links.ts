export const POLICY_CATEGORIES = [
  "privacy",
  "data",
  "access",
  "security",
] as const;

export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

export type PolicyLink = {
  url: string;
  text: string;
  categories: PolicyCategory[];
};

const CATEGORY_PATTERNS: Record<PolicyCategory, RegExp[]> = {
  privacy: [
    /privacy/i,
    /cookie/i,
    /\bgdpr\b/i,
    /\bccpa\b/i,
    /\bcpra\b/i,
  ],
  data: [
    /data[-_\s]?protection/i,
    /data[-_\s]?policy/i,
    /data[-_\s]?processing/i,
    /personal[-_\s]?(data|information)/i,
    /subject[-_\s]?access/i,
  ],
  access: [/accessib/i, /access[-_\s]?policy/i, /subject[-_\s]?access/i],
  security: [
    /security/i,
    /trust[-_\s]?cent(er|re)/i,
    /responsible[-_\s]?disclosure/i,
    /vulnerability/i,
    /bug[-_\s]?bounty/i,
  ],
};

const ANCHOR =
  /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

export function findPolicyLinks(html: string, pageUrl: string): PolicyLink[] {
  const base = new URL(pageUrl);
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  const found = new Map<string, PolicyLink>();

  for (const match of visible.matchAll(ANCHOR)) {
    const href = readHref(match[1] ?? "");
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
    const text = linkText(match[2] ?? "", absolute);
    const categories = categoriesFor(`${text} ${absolute.pathname} ${absolute.href}`);
    if (categories.length === 0) continue;

    const url = absolute.toString();
    const existing = found.get(url);
    if (existing) {
      existing.categories = mergeCategories(existing.categories, categories);
      if (existing.text.length < text.length) existing.text = text;
      continue;
    }

    found.set(url, { url, text, categories });
  }

  return [...found.values()].sort((a, b) => {
    const categoryOrder =
      POLICY_CATEGORIES.indexOf(a.categories[0]) -
      POLICY_CATEGORIES.indexOf(b.categories[0]);
    if (categoryOrder !== 0) return categoryOrder;
    return a.text.localeCompare(b.text);
  });
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

function categoriesFor(haystack: string): PolicyCategory[] {
  return POLICY_CATEGORIES.filter((category) =>
    CATEGORY_PATTERNS[category].some((pattern) => pattern.test(haystack)),
  );
}

function mergeCategories(
  current: PolicyCategory[],
  next: PolicyCategory[],
): PolicyCategory[] {
  return POLICY_CATEGORIES.filter(
    (category) => current.includes(category) || next.includes(category),
  );
}

function readHref(attributes: string): string | null {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
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
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
  return path.split("/").filter(Boolean).pop() || url.hostname;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits: string) =>
      String.fromCodePoint(Number(digits)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    );
}
