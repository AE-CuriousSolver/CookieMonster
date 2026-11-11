/**
 * Runs the link search on every site in a file and prints what it picked.
 * For checking the scoring by eye. Hits live websites; saves only with --save.
 *
 *   npm run check-urls                       uses scripts/test-urls.txt
 *   npm run check-urls -- my-sites.txt       uses another file
 *   npm run check-urls -- --save             also saves to Supabase, so links
 *                                            can be marked helpful afterwards
 */
import { readFileSync } from "node:fs";
import { groupByCategory } from "../lib/link-score.ts";
import { connectToLinkStore, saveSearch } from "../lib/link-store.ts";
import { lookupPolicyLinks, type LookupOptions } from "../lib/lookup-policy-links.ts";

const args = process.argv.slice(2);
const shouldSave = args.includes("--save");
const file =
  args.find((arg) => !arg.startsWith("--")) ??
  new URL("./test-urls.txt", import.meta.url).pathname;

let save: LookupOptions["save"];
if (shouldSave) {
  const db = connectToLinkStore();
  if (!db) {
    console.log("Can't save: SUPABASE_URL and SUPABASE_SECRET_KEY aren't set in .env.local.");
    process.exit(1);
  }
  save = (input, url, result) => saveSearch(db, input, url, result);
}
const searchIds: number[] = [];
const sites = readFileSync(file, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

if (sites.length === 0) {
  console.log(`No URLs in ${file}. Add one per line.`);
  process.exit(0);
}

// One site at a time, so the output stays in order and we're gentle on servers.
for (const site of sites) {
  console.log(`\n=== ${site}`);
  const result = await lookupPolicyLinks(site, { save });
  if (result.searchId !== undefined) searchIds.push(result.searchId);
  if (result.status === "failed") {
    console.log(`  FAILED: ${result.message}`);
    continue;
  }
  console.log(`  read ${result.pageUrl}, found ${result.links.length} links`);
  for (const { category, best, others } of groupByCategory(result.links)) {
    console.log(`  ${category.toUpperCase()}`);
    for (const [i, link] of [best, ...others].entries()) {
      const marker = i === 0 ? "BEST " : "     ";
      const title = link.page.status === "read" ? link.page.title : `(${link.page.message})`;
      const redirect = link.finalUrl && link.finalUrl !== link.url ? ` -> ${link.finalUrl}` : "";
      const id = link.candidateId === undefined ? "" : `  [id ${link.candidateId}]`;
      console.log(`    ${marker}${String(link.score).padStart(2)}  ${link.url}${redirect}${id}`);
      console.log(`             "${link.text}" · ${link.foundOn ? `linked from ${link.foundOn}` : link.location} · title: ${title}`);
    }
  }
}

if (shouldSave) {
  console.log(`\nSaved searches: ${searchIds.join(", ") || "none"}`);
  console.log("Mark links in Supabase: Table Editor > link_candidates > helpful.");
}
