"use server";

import {
  connectToLinkStore,
  saveMissedLink,
  saveSearch,
  searchedPage,
  setHelpful,
} from "@/lib/link-store";
import { lookupPolicyLinks, type LookupResult } from "@/lib/lookup-policy-links";
import { checkMissedLink } from "@/lib/missed-links";
import { RecentResults } from "@/lib/recent-results";
import { missedLinksEnabled } from "@/lib/settings";
import { parseUserUrl } from "@/lib/validate-url";

const MAX_NOTE_LENGTH = 500;

const FIVE_MINUTES = 5 * 60 * 1000;
const recentLookups = new RecentResults<LookupResult>(FIVE_MINUTES, 500);
const db = connectToLinkStore();

export type FormState = { status: "idle" } | LookupResult;

export async function checkUrl(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const url = formData.get("url");
  try {
    return await lookupPolicyLinks(typeof url === "string" ? url : "", {
      recent: recentLookups,
      save: saveToDatabase,
    });
  } catch (error) {
    console.error("Policy link lookup failed", error);
    return { status: "failed", message: "Something went wrong on our side. Please try again." };
  }
}

/** Records whether a found link was helpful. Returns false if it couldn't be saved. */
export async function markHelpful(candidateId: number, helpful: boolean): Promise<boolean> {
  if (!db || !Number.isSafeInteger(candidateId) || typeof helpful !== "boolean") return false;
  try {
    await setHelpful(db, candidateId, helpful);
    return true;
  } catch (error) {
    console.error("Couldn't save helpful answer", error);
    return false;
  }
}

/** Saves a link the search missed. Returns a message to show either way. */
export async function addMissedLink(
  searchId: number,
  linkInput: string,
  noteInput: string,
): Promise<{ ok: boolean; message: string }> {
  // Checked here too, not just by hiding the form: anyone can call this directly.
  if (!missedLinksEnabled()) return { ok: false, message: "Adding missed links is turned off." };
  if (!db || !Number.isSafeInteger(searchId)) {
    return { ok: false, message: "Saving isn't set up." };
  }
  const link = parseUserUrl(String(linkInput));
  if (!link.ok) return { ok: false, message: link.message };
  const note = String(noteInput).trim().slice(0, MAX_NOTE_LENGTH);

  try {
    const search = await searchedPage(db, searchId);
    if (!search) return { ok: false, message: "Couldn't find that search." };
    const page = parseUserUrl(search.pageUrl ?? search.inputUrl);
    if (!page.ok) return { ok: false, message: page.message };

    const check = await checkMissedLink(page.url, link.url);
    const saved = await saveMissedLink(db, searchId, link.url.href, check, note);
    if (!saved) return { ok: false, message: "That link was already added for this search." };

    const where =
      check.onSearchedPage === null
        ? "We couldn't re-read the searched page to look for it."
        : check.onSearchedPage
          ? `It was on the page as “${check.linkText}”, in the ${check.foundIn?.join(", ")}.`
          : "It isn't a link on the page we searched.";
    return { ok: true, message: `Saved. ${where}` };
  } catch (error) {
    console.error("Couldn't save missed link", error);
    return { ok: false, message: "Couldn't save. Check the server log." };
  }
}

// A failed save shouldn't break the search: show the results without the
// Helpful buttons and report the problem in the server log.
async function saveToDatabase(
  input: string,
  url: URL,
  result: LookupResult,
): Promise<LookupResult> {
  if (!db) return result;
  try {
    return await saveSearch(db, input, url, result);
  } catch (error) {
    console.error("Couldn't save search to the database", error);
    return result;
  }
}
