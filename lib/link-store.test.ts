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
      foundIn: ["footer"],
      page: {
        status: "read",
        title: "Privacy Policy | Acme",
        preview: "",
        wordCounts: [],
        mentionsLastUpdated: true,
      },
    },
    {
      url: "https://acme.example/aup",
      text: "Acceptable Use Policy",
      categories: ["policy"],
      matches: [],
      foundIn: ["main"],
      foundOn: "https://acme.example/terms",
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
      page_title: "Privacy Policy | Acme",
      mentions_last_updated: true,
      page_problem: null,
    },
    {
      search_id: 7,
      link_text: "Acceptable Use Policy",
      link_url: "https://acme.example/aup",
      categories: ["policy"],
      matched_words: [],
      found_in: ["main"],
      found_on_url: "https://acme.example/terms",
      depth: 1,
      page_title: null,
      mentions_last_updated: null,
      page_problem: "Blocked",
    },
  ]);
});
