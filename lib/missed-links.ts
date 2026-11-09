import { fetchPage, type FetchDeps } from "./fetch-page.ts";
import { readPageText } from "./page-text.ts";
import { findLinkTo } from "./policy-links.ts";

export type MissedLinkCheck = {
  /** Was it a link on the page we searched? null = that page couldn't be read. */
  onSearchedPage: boolean | null;
  linkText: string | null;
  foundIn: string[] | null;
  /** The missed page's own title, if it could be read. */
  pageTitle: string | null;
};

/** Looks for the missed link on the searched page, and reads the missed page's title. */
export async function checkMissedLink(
  searchedPageUrl: URL,
  missedUrl: URL,
  deps?: FetchDeps,
): Promise<MissedLinkCheck> {
  const [searched, missed] = await Promise.all([
    fetchPage(searchedPageUrl, deps),
    fetchPage(missedUrl, deps),
  ]);

  const link = searched.ok ? findLinkTo(searched.html, searched.url, missedUrl.href) : null;
  const title = missed.ok ? readPageText(missed.html).title : "";

  return {
    onSearchedPage: searched.ok ? link !== null : null,
    linkText: link?.text ?? null,
    foundIn: link?.foundIn ?? null,
    pageTitle: title || null,
  };
}
