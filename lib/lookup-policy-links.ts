import { checkPolicyPages, type CheckedLink } from "./check-policy-pages.ts";
import { fetchPage, type FetchDeps } from "./fetch-page.ts";
import { findPolicyLinks, looksLikeBlockPage } from "./policy-links.ts";
import type { RecentResults } from "./recent-results.ts";
import { parseUserUrl } from "./validate-url.ts";

/** searchId is the search's database row, once saved. */
export type LookupResult =
  | { status: "found"; pageUrl: string; links: CheckedLink[]; searchId?: number }
  | { status: "failed"; message: string; searchId?: number };

export type LookupOptions = {
  /** Fake network for tests. */
  deps?: FetchDeps;
  /** Results from the last few minutes, reused instead of searching again. */
  recent?: RecentResults<LookupResult>;
  /**
   * Called once for each new search (not for repeats or invalid input), e.g. to
   * save it. What it returns is what gets remembered and shown.
   */
  save?: (input: string, url: URL, result: LookupResult) => Promise<LookupResult>;
};

export async function lookupPolicyLinks(
  input: string,
  { deps, recent, save }: LookupOptions = {},
): Promise<LookupResult> {
  const checked = parseUserUrl(input);
  if (!checked.ok) return { status: "failed", message: checked.message };

  // The cleaned-up URL, so "bbc.co.uk" and "https://bbc.co.uk/" share a result.
  const key = checked.url.href;
  const saved = recent?.get(key);
  if (saved) return saved;

  let result = await fetchAndFind(checked.url, deps);
  if (save) result = await save(input, checked.url, result);
  recent?.set(key, result);
  return result;
}

async function fetchAndFind(url: URL, deps?: FetchDeps): Promise<LookupResult> {
  const page = await fetchPage(url, deps);
  if (!page.ok) return { status: "failed", message: page.message };

  const links = findPolicyLinks(page.html, page.url);
  if (links.length === 0) return { status: "failed", message: noLinksMessage(page.html) };

  const checked = await checkPolicyPages(page.url, links, deps);
  return { status: "found", pageUrl: page.url, links: checked };
}

function noLinksMessage(html: string): string {
  if (looksLikeBlockPage(html)) {
    return "The site showed a bot check instead of its homepage, so we couldn't read it.";
  }
  if (!/<a\b/i.test(html)) {
    return "We didn't find any links on this page. The site may add them with JavaScript, which we can't read yet.";
  }
  return "We read the homepage but found no privacy, terms, security or similar policy links.";
}
