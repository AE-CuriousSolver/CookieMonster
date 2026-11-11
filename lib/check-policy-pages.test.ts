import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkPolicyPages } from "./check-policy-pages.ts";
import type { FetchDeps } from "./fetch-page.ts";
import type { PolicyCategory } from "./link-rules.ts";
import type { PolicyLink } from "./policy-links.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// A footer link with its topic word in the path only: 3 + 2 = 5 points.
const link = (path: string, category: PolicyCategory = "privacy"): PolicyLink => ({
  url: `https://acme.example${path}`,
  text: path,
  categories: [category],
  matches: [{ category, keyword: category, where: "path" }],
  location: "footer",
  score: 5,
});

function servePages(pages: Record<string, () => Response>): FetchDeps {
  return {
    fetch: async (input) => {
      const path = new URL(String(input)).pathname.replace(/(.)\/$/, "$1");
      return pages[path]?.() ?? html("missing", 404);
    },
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
  const messageFor = (path: string) => {
    const page = checked.find((item) => item.url.endsWith(path))?.page;
    return page?.status === "unreadable" ? page.message : "read";
  };
  assert.match(messageFor("/blocked"), /refused our request/);
  assert.match(messageFor("/pdf"), /application\/pdf/);
  assert.match(messageFor("/bot"), /bot check/);
  assert.match(messageFor("/empty"), /no readable text/);
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

test("adds title words to the score and records the final URL", async () => {
  const [checked] = await checkPolicyPages(
    HOME,
    [link("/privacy")],
    servePages({
      "/privacy": () => html("<title>Privacy Notice | Acme</title><p>Our privacy notice</p>"),
    }),
  );
  // 3 (footer) + 2 (path) + 3 (title topic word) + 1 (title document word)
  assert.equal(checked.score, 9);
  assert.equal(checked.finalUrl, "https://acme.example/privacy");
  assert.deepEqual(checked.categories, ["privacy"]);
});

test("merges links that redirect to the same page, keeping the best", async () => {
  const checked = await checkPolicyPages(
    HOME,
    [link("/legal/privacy-old"), link("/privacy"), link("/cookie-policy", "cookie")],
    servePages({
      "/privacy": () => html("<p>Our privacy policy</p>"),
      "/legal/privacy-old": () =>
        new Response(null, { status: 301, headers: { location: "/privacy" } }),
      "/cookie-policy": () =>
        new Response(null, { status: 301, headers: { location: "/privacy/?section=cookies" } }),
    }),
  );
  assert.equal(checked.length, 1);
  assert.equal(checked[0].url, "https://acme.example/privacy");
  assert.deepEqual(checked[0].categories, ["privacy", "cookie"]);
});

test("follows links on footer pages and lets a better linked page win", async () => {
  const checked = await checkPolicyPages(
    HOME,
    [link("/privacy")],
    servePages({
      "/privacy": () =>
        html(`<title>Your privacy</title><nav><a href="/privacy/sidebar">Privacy sidebar</a></nav>
          <main><p>Privacy hub</p>
          <a href="/privacy/what-are-my-rights">What are my rights?</a>
          <a href="/privacy-policy">View the full privacy policy</a>
          <a href="https://other.example/privacy">Their privacy policy</a></main>`),
      "/privacy-policy": () => html("<title>Privacy Policy | Acme</title><p>The full policy</p>"),
      "/privacy/what-are-my-rights": () => html("<title>What are my rights?</title><p>Rights</p>"),
    }),
  );
  assert.deepEqual(
    checked.map((item) => [new URL(item.url).pathname, item.location, item.score, item.foundOn]),
    [
      // linked 2 + text topic 3 + text document 2 + path topic 2 + path document 1 + title 3 + 1
      ["/privacy-policy", "linked", 14, "https://acme.example/privacy"],
      // footer 3 + path 2 + title 3
      ["/privacy", "footer", 8, undefined],
      // linked 2 + path 2 - question 4 (no topic word in its title)
      ["/privacy/what-are-my-rights", "linked", 0, "https://acme.example/privacy"],
    ],
  );
});

test("opens gateway links to find policies, but never returns them", async () => {
  const gateway: PolicyLink = {
    url: "https://acme.example/legal",
    text: "All legal documents",
    categories: [],
    matches: [],
    location: "footer",
    score: 3,
    gateway: true,
  };
  const checked = await checkPolicyPages(
    HOME,
    [gateway],
    servePages({
      "/legal": () => html('<main><a href="/legal/cookie-policy">Cookie Policy</a></main>'),
      "/legal/cookie-policy": () => html("<title>Cookie Policy</title><p>Cookies</p>"),
    }),
  );
  assert.deepEqual(
    checked.map((item) => [item.url, item.categories]),
    [["https://acme.example/legal/cookie-policy", ["cookie"]]],
  );
});

test("keeps a link that redirects to the homepage, with its own score", async () => {
  const checked = await checkPolicyPages(
    HOME,
    [link("/site/privacy"), link("/cookies", "cookie")],
    servePages({
      "/": () => html("<title>Acme</title><p>Welcome to Acme</p>"),
      "/site/privacy": () => new Response(null, { status: 302, headers: { location: "/" } }),
      "/cookies": () => new Response(null, { status: 302, headers: { location: "/" } }),
    }),
  );
  assert.equal(checked.length, 2, "not merged just because both landed on the homepage");
  const privacy = checked.find((item) => item.url.endsWith("/site/privacy"));
  assert.equal(privacy?.score, 5);
  assert.equal(privacy?.finalUrl, "https://acme.example");
  assert.match(privacy?.page.status === "unreadable" ? privacy.page.message : "", /homepage/);
});
