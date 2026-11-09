import { fetchPage, type FetchDeps } from "./fetch-page.ts";
import { mainContentHtml, readPageText } from "./page-text.ts";
import {
  categoriesOf,
  countCategoryWords,
  findPolicyLinks,
  linkKey,
  looksLikeBlockPage,
  mergeMatches,
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
 * foundOn is set for links found on a policy page rather than the homepage.
 * foundIn lists every place the link was seen: plain ("footer") on the foundOn
 * page, or with the page added ("main on acme.com/terms") elsewhere.
 * candidateId is the link's database row, once saved.
 */
export type CheckedLink = PolicyLink & {
  foundOn?: string;
  page: PageCheck;
  candidateId?: number;
};

/** A place a link was seen: which part of which page. */
type Location = { where: string; page: string };

/** A link and every place it's been seen so far. */
type Found = { link: PolicyLink; foundOn?: string; locations: Location[] };

type Opened = {
  found: Found;
  page: PageCheck;
  /** The address after redirects, so two links to one page can be merged. */
  finalUrl: string | null;
  linksOnPage: PolicyLink[];
};

const MAX_PAGES = 20;
const PAGES_AT_ONCE = 4;
const PREVIEW_LENGTH = 300;
// Bot-check pages are short. A long page that mentions "access denied" is probably real.
const SHORT_PAGE_LENGTH = 1000;

/**
 * Opens each policy link, then looks for more policy links on those pages and
 * opens them too. That second round goes one level deep only. Links to the
 * same page are merged into one, keeping every place they were seen.
 */
export async function checkPolicyPages(
  homepageUrl: string,
  links: PolicyLink[],
  deps?: FetchDeps,
): Promise<CheckedLink[]> {
  const fromHomepage: Found[] = links.map((link) => ({
    link: { ...link },
    locations: link.foundIn.map((where) => ({ where, page: homepageUrl })),
  }));
  const firstRound = await openAll(fromHomepage, MAX_PAGES, deps);

  const byKey = new Map(fromHomepage.map((found) => [linkKey(found.link.url), found]));
  // Only websites we've already seen, so a privacy page's links to other
  // companies' policies (Google, Stripe…) aren't pulled in.
  const sites = new Set([homepageUrl, ...links.map((link) => link.url)].map(siteOf));
  const nested: Found[] = [];
  const pagesLeft = Math.max(0, MAX_PAGES - links.length);

  for (const opened of firstRound) {
    const page = opened.found.link.url;
    for (const link of opened.linksOnPage) {
      const key = linkKey(link.url);
      if (key === linkKey(page)) continue; // a page linking to itself
      const locations = link.foundIn.map((where) => ({ where, page }));

      const known = byKey.get(key);
      if (known) {
        addSighting(known, link, locations);
        continue;
      }
      if (!sites.has(siteOf(link.url)) || nested.length >= pagesLeft) continue;

      const found: Found = { link: { ...link }, foundOn: page, locations };
      nested.push(found);
      byKey.set(key, found);
    }
  }

  const secondRound = await openAll(nested, pagesLeft, deps);
  return mergeRedirects([...firstRound, ...secondRound]).map((opened) =>
    toCheckedLink(opened, homepageUrl),
  );
}

/** Records another place a link was seen, and the words that matched there. */
function addSighting(target: Found, link: PolicyLink, locations: Location[]): void {
  for (const location of locations) {
    const isNew = !target.locations.some(
      (seen) => seen.where === location.where && seen.page === location.page,
    );
    if (isNew) target.locations.push(location);
  }
  target.link.matches = mergeMatches(target.link.matches, link.matches);
  target.link.categories = categoriesOf(target.link.matches);
}

/**
 * Different links that end up on the same page after redirects become one,
 * keeping the first: homepage links come first, so it's the closest one.
 */
function mergeRedirects(opened: Opened[]): Opened[] {
  const byPage = new Map<string, Opened>();
  const kept: Opened[] = [];
  for (const item of opened) {
    const key = linkKey(item.finalUrl ?? item.found.link.url);
    const existing = byPage.get(key);
    if (existing) {
      addSighting(existing.found, item.found.link, item.found.locations);
      continue;
    }
    byPage.set(key, item);
    kept.push(item);
  }
  return kept;
}

function toCheckedLink({ found, page }: Opened, homepageUrl: string): CheckedLink {
  const mainPage = found.foundOn ?? homepageUrl;
  const foundIn = found.locations.map((location) =>
    location.page === mainPage ? location.where : `${location.where} on ${shortUrl(location.page)}`,
  );
  return {
    ...found.link,
    foundIn: [...new Set(foundIn)],
    ...(found.foundOn && { foundOn: found.foundOn }),
    page,
  };
}

async function openAll(found: Found[], maxPages: number, deps?: FetchDeps): Promise<Opened[]> {
  const opened: Opened[] = [];

  // A few at a time, so we don't flood the site with requests.
  for (let i = 0; i < found.length; i += PAGES_AT_ONCE) {
    const batch = found.slice(i, i + PAGES_AT_ONCE);
    const results = await Promise.all(
      batch.map((item, j) =>
        i + j < maxPages
          ? openLink(item, deps)
          : {
              found: item,
              page: unreadable(`Not opened: we only open ${MAX_PAGES} pages per search.`),
              finalUrl: null,
              linksOnPage: [],
            },
      ),
    );
    opened.push(...results);
  }
  return opened;
}

async function openLink(found: Found, deps?: FetchDeps): Promise<Opened> {
  const target = checkFetchable(new URL(found.link.url));
  if (!target.ok) {
    return { found, page: unreadable(target.message), finalUrl: null, linksOnPage: [] };
  }

  const page = await fetchPage(target.url, deps);
  if (!page.ok) {
    return { found, page: unreadable(page.message), finalUrl: null, linksOnPage: [] };
  }

  return {
    found,
    page: describePage(page.html),
    finalUrl: page.url,
    // Only links in the policy's own text, not the site's menus and footer.
    linksOnPage: findPolicyLinks(mainContentHtml(page.html), page.url),
  };
}

function describePage(html: string): PageCheck {
  const { title, text } = readPageText(html);
  if (text.length < SHORT_PAGE_LENGTH && looksLikeBlockPage(html)) {
    return unreadable("The site showed a bot check instead of this page.");
  }
  if (!text) {
    return unreadable("The page had no readable text. It may be built with JavaScript.");
  }
  return {
    status: "read",
    title,
    preview: shorten(text, PREVIEW_LENGTH),
    wordCounts: countCategoryWords(text),
    mentionsLastUpdated: /last (updated|modified|revised)|effective (date|from|as of)/i.test(text),
  };
}

/** "https://www.acme.com/terms/" → "acme.com/terms", for labelling locations. */
function shortUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname.replace(/^www\./, "") + parsed.pathname.replace(/\/$/, "");
}

function siteOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

function unreadable(message: string): PageCheck {
  return { status: "unreadable", message };
}

function shorten(text: string, length: number): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : length)}…`;
}
