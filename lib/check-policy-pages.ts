import { fetchPage, type FetchDeps } from "./fetch-page.ts";
import { compareLinks, matchWords, mergeMatches, scoreFor } from "./link-score.ts";
import { mainContentHtml, readPageText } from "./page-text.ts";
import {
  countCategoryWords,
  findLinkedPolicyLinks,
  linkKey,
  looksLikeBlockPage,
  normaliseUrl,
  type PolicyLink,
  type WordCount,
} from "./policy-links.ts";
import { checkFetchable } from "./validate-url.ts";

export type PageCheck =
  | {
      status: "read";
      title: string;
      preview: string;
      wordCounts: WordCount[];
      mentionsLastUpdated: boolean;
    }
  | { status: "unreadable"; message: string };

/**
 * finalUrl is where the link landed after redirects, or null if it couldn't
 * be opened. foundOn is the page a "linked" link was found on.
 * candidateId is the link's database row, once saved.
 */
export type CheckedLink = PolicyLink & {
  finalUrl: string | null;
  page: PageCheck;
  foundOn?: string;
  candidateId?: number;
};

/** A link after opening it, with the page's HTML so we can follow its links. */
type Opened = { link: CheckedLink; html: string | null };

const MAX_PAGES = 20;
const PAGES_AT_ONCE = 4;
const PREVIEW_LENGTH = 300;
// Bot-check pages are short. A long page that mentions "access denied" is probably real.
const SHORT_PAGE_LENGTH = 1000;
const HOMEPAGE_REDIRECT =
  "Opening this link took us to the homepage, so we couldn't read it. The link itself may still be right.";

/**
 * Opens each homepage link to read its title (which adds to the score) and
 * where it redirects to. Then looks for more policy links on those pages, one
 * level deep, and opens the best of them. Gateway links (e.g. "All legal
 * documents") are only used for that second step. Links that land on the same
 * page become one. Best first.
 */
export async function checkPolicyPages(
  homepageUrl: string,
  links: PolicyLink[],
  deps?: FetchDeps,
): Promise<CheckedLink[]> {
  const firstRound = await openAll(homepageUrl, links, MAX_PAGES, deps);

  // Only websites we've already seen, so a privacy page's links to other
  // companies' policies (Google, Stripe…) aren't followed.
  const sites = new Set([homepageUrl, ...links.map((link) => link.url)].map(siteOf));
  const known = new Set(links.map((link) => linkKey(link.url)));
  const linked = new Map<string, PolicyLink & { foundOn: string }>();

  for (const { link, html } of firstRound) {
    if (!html || !link.finalUrl) continue;
    for (const found of findLinkedPolicyLinks(mainContentHtml(html), link.finalUrl)) {
      const key = linkKey(found.url);
      if (known.has(key) || !sites.has(siteOf(found.url))) continue;
      const existing = linked.get(key);
      if (existing) {
        existing.categories = [...new Set([...existing.categories, ...found.categories])];
        continue;
      }
      linked.set(key, { ...found, foundOn: link.url });
    }
  }

  const pagesLeft = Math.max(0, MAX_PAGES - Math.min(links.length, MAX_PAGES));
  const secondRound = await openAll(
    homepageUrl,
    [...linked.values()].sort(compareLinks),
    pagesLeft,
    deps,
  );

  const results = [...firstRound, ...secondRound]
    .map((opened) => opened.link)
    .filter((link) => !link.gateway);
  return mergeRedirects(results).sort(compareLinks);
}

/**
 * Different links that end up on the same page become one. The best-scoring
 * link is kept, and gains the other links' categories. Uses the link's own URL
 * when the page couldn't be read (including redirects to the homepage).
 */
function mergeRedirects(links: CheckedLink[]): CheckedLink[] {
  const byPage = new Map<string, CheckedLink>();
  for (const link of [...links].sort(compareLinks)) {
    const landedOn = link.page.status === "read" && link.finalUrl ? link.finalUrl : link.url;
    const key = linkKey(landedOn);
    const kept = byPage.get(key);
    if (!kept) {
      byPage.set(key, { ...link });
      continue;
    }
    kept.categories = [...new Set([...kept.categories, ...link.categories])];
  }
  return [...byPage.values()];
}

/** Opens up to maxPages links, a few at a time so we don't flood the site. */
async function openAll(
  homepageUrl: string,
  links: (PolicyLink & { foundOn?: string })[],
  maxPages: number,
  deps?: FetchDeps,
): Promise<Opened[]> {
  const opened: Opened[] = [];
  for (let i = 0; i < links.length; i += PAGES_AT_ONCE) {
    const batch = links.slice(i, i + PAGES_AT_ONCE);
    const results = await Promise.all(
      batch.map((link, j) =>
        i + j < maxPages
          ? openLink(homepageUrl, link, deps)
          : notOpened(link, null, `Not opened: we only open ${MAX_PAGES} pages per search.`),
      ),
    );
    opened.push(...results);
  }
  return opened;
}

async function openLink(
  homepageUrl: string,
  link: PolicyLink & { foundOn?: string },
  deps?: FetchDeps,
): Promise<Opened> {
  const target = checkFetchable(new URL(link.url));
  if (!target.ok) return notOpened(link, null, target.message);

  const page = await fetchPage(target.url, deps);
  if (!page.ok) return notOpened(link, null, page.message);

  const finalUrl = normaliseUrl(page.url);
  // Some sites send a fresh visitor to the homepage. That says nothing about
  // whether the link is right, so keep the link's own score.
  if (isHomepage(finalUrl, homepageUrl)) return notOpened(link, finalUrl, HOMEPAGE_REDIRECT);

  const check = describePage(page.html);
  const matches =
    check.status === "read"
      ? mergeMatches(link.matches, matchWords(check.title, "title"))
      : link.matches;
  return {
    link: {
      ...link,
      matches,
      score: scoreFor(link.location, matches),
      finalUrl,
      page: check,
    },
    html: check.status === "read" ? page.html : null,
  };
}

function notOpened(link: PolicyLink, finalUrl: string | null, message: string): Opened {
  return { link: { ...link, finalUrl, page: { status: "unreadable", message } }, html: null };
}

function isHomepage(url: string, homepageUrl: string): boolean {
  return new URL(url).pathname === "/" || linkKey(url) === linkKey(homepageUrl);
}

function describePage(html: string): PageCheck {
  const { title, text } = readPageText(html);
  if (text.length < SHORT_PAGE_LENGTH && looksLikeBlockPage(html)) {
    return { status: "unreadable", message: "The site showed a bot check instead of this page." };
  }
  if (!text) {
    return {
      status: "unreadable",
      message: "The page had no readable text. It may be built with JavaScript.",
    };
  }
  return {
    status: "read",
    title,
    preview: shorten(text, PREVIEW_LENGTH),
    wordCounts: countCategoryWords(text),
    mentionsLastUpdated: /last (updated|modified|revised)|effective (date|from|as of)/i.test(text),
  };
}

function siteOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

function shorten(text: string, length: number): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : length)}…`;
}
