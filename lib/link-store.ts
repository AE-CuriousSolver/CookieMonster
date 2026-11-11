import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LookupResult } from "./lookup-policy-links.ts";
import type { MissedLinkCheck } from "./missed-links.ts";

/**
 * Connects with the secret key, which can read and write everything. Only
 * ever use this on the server. Returns null when the keys aren't set, so the
 * app still works without a database.
 */
export function connectToLinkStore(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) return null;
  return createClient(url, secretKey, { auth: { persistSession: false } });
}

/** The link_searches row for a search. */
export function searchRow(input: string, url: URL, result: LookupResult) {
  const pageUrl = result.status === "found" ? result.pageUrl : null;
  return {
    input_url: input,
    page_url: pageUrl,
    root_domain: new URL(pageUrl ?? url.href).hostname.replace(/^www\./, ""),
    status: result.status,
    error_message: result.status === "failed" ? result.message : null,
  };
}

/** The link_candidates rows for a search, one per link. */
export function candidateRows(searchId: number, result: LookupResult) {
  if (result.status === "failed") return [];
  return result.links.map((link) => ({
    search_id: searchId,
    link_text: link.text,
    link_url: link.url,
    categories: link.categories,
    matched_words: link.matches,
    found_in: [link.location],
    found_on_url: link.foundOn ?? result.pageUrl,
    depth: link.foundOn ? 1 : 0,
    score: link.score,
    final_url: link.finalUrl,
    page_title: link.page.status === "read" ? link.page.title || null : null,
    mentions_last_updated:
      link.page.status === "read" ? link.page.mentionsLastUpdated : null,
    page_problem: link.page.status === "unreadable" ? link.page.message : null,
  }));
}

/** Saves a search and its links. Returns the result with each link's row id. */
export async function saveSearch(
  db: SupabaseClient,
  input: string,
  url: URL,
  result: LookupResult,
): Promise<LookupResult> {
  const search = await db
    .from("link_searches")
    .insert(searchRow(input, url, result))
    .select("id")
    .single();
  if (search.error) throw search.error;
  const searchId: number = search.data.id;
  if (result.status === "failed") return { ...result, searchId };

  const candidates = await db
    .from("link_candidates")
    .insert(candidateRows(searchId, result))
    .select("id, link_url");
  if (candidates.error) throw candidates.error;

  const idByUrl = new Map(candidates.data.map((row) => [row.link_url, row.id]));
  return {
    ...result,
    searchId,
    links: result.links.map((link) => ({ ...link, candidateId: idByUrl.get(link.url) })),
  };
}

export async function setHelpful(
  db: SupabaseClient,
  candidateId: number,
  helpful: boolean,
): Promise<void> {
  const { error } = await db
    .from("link_candidates")
    .update({ helpful })
    .eq("id", candidateId);
  if (error) throw error;
}

/** The page a search read, or what was typed in if the search failed. */
export async function searchedPage(
  db: SupabaseClient,
  searchId: number,
): Promise<{ pageUrl: string | null; inputUrl: string } | null> {
  const { data, error } = await db
    .from("link_searches")
    .select("page_url, input_url")
    .eq("id", searchId)
    .maybeSingle();
  if (error) throw error;
  return data ? { pageUrl: data.page_url, inputUrl: data.input_url } : null;
}

/** Saves a missed link. Returns false if it was already added for this search. */
export async function saveMissedLink(
  db: SupabaseClient,
  searchId: number,
  linkUrl: string,
  check: MissedLinkCheck,
  note: string,
): Promise<boolean> {
  const { error } = await db.from("missed_links").insert({
    search_id: searchId,
    link_url: linkUrl,
    on_searched_page: check.onSearchedPage,
    link_text: check.linkText,
    found_in: check.foundIn,
    page_title: check.pageTitle,
    note: note || null,
  });
  if (error?.code === "23505") return false; // unique (search_id, link_url)
  if (error) throw error;
  return true;
}
