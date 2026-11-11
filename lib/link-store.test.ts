import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateRows, searchRow } from "./link-store.ts";
import type { LookupResult } from "./lookup-policy-links.ts";

const URL_ENTERED = new URL("https://www.acme.example/careers");

const found: LookupResult = {
  status: "found",
  pageUrl: "https://www.acme.example/careers",
  links: [
    {
      url: "https://acme.example/privacy",
      text: "Privacy",
      categories: ["privacy"],
      matches: [{ category: "privacy", keyword: "Privacy", where: "text" }],
      location: "footer",
      score: 10,
      finalUrl: "https://acme.example/privacy",
      page: {
        status: "read",
        title: "Privacy Policy | Acme",
        preview: "",
        wordCounts: [],
        mentionsLastUpdated: true,
      },
    },
    {
      url: "https://acme.example/legal/terms",
      text: "Terms",
      categories: ["terms"],
      matches: [],
      location: "footer",
      score: 6,
      finalUrl: null,
      page: { status: "unreadable", message: "Blocked" },
    },
  ],
};

test("builds the search row", () => {
  assert.deepEqual(searchRow("acme.example/careers", URL_ENTERED, found), {
    input_url: "acme.example/careers",
    page_url: "https://www.acme.example/careers",
    root_domain: "acme.example",
    status: "found",
    error_message: null,
  });
});

test("keeps the domain for failed searches", () => {
  const failed: LookupResult = { status: "failed", message: "Bot check" };
  assert.deepEqual(searchRow("acme.example", URL_ENTERED, failed), {
    input_url: "acme.example",
    page_url: null,
    root_domain: "acme.example",
    status: "failed",
    error_message: "Bot check",
  });
  assert.deepEqual(candidateRows(1, failed), []);
});

test("builds one candidate row per link", () => {
  assert.deepEqual(candidateRows(7, found), [
    {
      search_id: 7,
      link_text: "Privacy",
      link_url: "https://acme.example/privacy",
      categories: ["privacy"],
      matched_words: [{ category: "privacy", keyword: "Privacy", where: "text" }],
      found_in: ["footer"],
      found_on_url: "https://www.acme.example/careers",
      depth: 0,
      score: 10,
      final_url: "https://acme.example/privacy",
      page_title: "Privacy Policy | Acme",
      mentions_last_updated: true,
      page_problem: null,
    },
    {
      search_id: 7,
      link_text: "Terms",
      link_url: "https://acme.example/legal/terms",
      categories: ["terms"],
      matched_words: [],
      found_in: ["footer"],
      found_on_url: "https://www.acme.example/careers",
      depth: 0,
      score: 6,
      final_url: null,
      page_title: null,
      mentions_last_updated: null,
      page_problem: "Blocked",
    },
  ]);
});
