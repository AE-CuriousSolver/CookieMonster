import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkPolicyPages } from "./check-policy-pages.ts";
import type { FetchDeps } from "./fetch-page.ts";
import type { PolicyLink } from "./policy-links.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const link = (path: string): PolicyLink => ({
  url: `https://acme.example${path}`,
  text: path,
  categories: ["privacy"],
  matches: [],
  foundIn: ["footer"],
});

function servePages(pages: Record<string, () => Response>): FetchDeps {
  return {
    fetch: async (input) => pages[new URL(String(input)).pathname](),
    resolveHost: async () => ["93.184.216.34"],
  };
}

const HOME = "https://acme.example/";

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

test("reports a preview and word counts for a readable page", async () => {
  const [checked] = await checkPolicyPages(
    HOME,
    [link("/privacy")],
    servePages({ "/privacy": () => html(fixture("privacy-page.html")) }),
  );
  assert.ok(checked.page.status === "read");
  assert.equal(checked.page.title, "Privacy Policy & Your Data | Acme");
  assert.match(checked.page.preview, /^Privacy Policy This privacy policy/);
  assert.equal(checked.page.mentionsLastUpdated, false);
  assert.deepEqual(checked.page.wordCounts[0], {
    category: "privacy",
    keyword: "privacy",
    count: 2,
  });
});

test("explains pages that can't be read", async () => {
  const checked = await checkPolicyPages(
    HOME,
    [link("/blocked"), link("/pdf"), link("/bot"), link("/empty")],
    servePages({
      "/blocked": () => html("no", 403),
      "/pdf": () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
      "/bot": () => html(fixture("block-page.html")),
      "/empty": () => html('<div id="root"></div><script src="/app.js"></script>'),
    }),
  );
  const messages = checked.map((item) =>
    item.page.status === "unreadable" ? item.page.message : "read",
  );
  assert.match(messages[0], /refused our request/);
  assert.match(messages[1], /application\/pdf/);
  assert.match(messages[2], /bot check/);
  assert.match(messages[3], /no readable text/);
});

test("only opens 20 pages per search", async () => {
  let opened = 0;
  const deps: FetchDeps = {
    fetch: async () => {
      opened++;
      return html("<p>Privacy</p>");
    },
    resolveHost: async () => ["93.184.216.34"],
  };
  const links = Array.from({ length: 25 }, (_, i) => link(`/page-${i}`));
  const checked = await checkPolicyPages(HOME, links, deps);
  assert.equal(opened, 20);
  assert.equal(checked.length, 25);
  assert.equal(checked[24].page.status, "unreadable");
});

test("finds more policy links on policy pages, one level deep", async () => {
  const checked = await checkPolicyPages(
    HOME,
    [link("/terms"), link("/privacy")],
    servePages({
      "/terms": () =>
        html(`
          <nav><a href="/sidebar-policy">Sidebar policy</a></nav>
          <main><p>Our terms</p>
          <a href="/privacy">Privacy</a>
          <a href="/acceptable-use">Acceptable Use Policy</a>
          <a href="https://other-company.example/privacy">Their privacy policy</a></main>`),
      "/privacy": () => html("<p>Our privacy policy</p>"),
      "/acceptable-use": () =>
        html('<p>Acceptable use policy</p><a href="/deeper-policy">Deeper policy</a>'),
    }),
  );
  assert.deepEqual(
    checked.map((item) => [item.url, item.foundOn]),
    [
      ["https://acme.example/terms", undefined],
      ["https://acme.example/privacy", undefined],
      ["https://acme.example/acceptable-use", "https://acme.example/terms"],
    ],
  );
  assert.equal(checked[2].page.status, "read");
  assert.deepEqual(checked[2].foundIn, ["main"]);
});

test("keeps every place a link was seen, labelling other pages", async () => {
  const checked = await checkPolicyPages(
    HOME,
    [link("/privacy"), link("/terms")],
    servePages({
      "/privacy": () => html("<main><p>Our privacy policy</p></main>"),
      "/terms": () =>
        html('<main><p>Terms</p><a href="/privacy/?cid=terms">Privacy policy</a></main>'),
    }),
  );
  assert.equal(checked.length, 2);
  assert.deepEqual(checked[0].foundIn, ["footer", "main on acme.example/terms"]);
});

test("merges different links that redirect to the same page", async () => {
  const checked = await checkPolicyPages(
    HOME,
    [link("/privacy"), link("/legal/privacy-old")],
    servePages({
      "/privacy": () => html("<p>Our privacy policy</p>"),
      "/legal/privacy-old": () =>
        new Response(null, { status: 301, headers: { location: "/privacy" } }),
    }),
  );
  assert.deepEqual(
    checked.map((item) => item.url),
    ["https://acme.example/privacy"],
  );
});
