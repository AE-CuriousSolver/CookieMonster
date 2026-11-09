import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchDeps } from "./fetch-page.ts";
import { checkMissedLink } from "./missed-links.ts";

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

function servePages(pages: Record<string, () => Response>): FetchDeps {
  return {
    fetch: async (input) => pages[new URL(String(input)).pathname](),
    resolveHost: async () => ["93.184.216.34"],
  };
}

const HOME = new URL("https://www.acme.example/");

test("finds the missed link on the searched page and reads its title", async () => {
  const check = await checkMissedLink(
    HOME,
    new URL("https://acme.example/your-choices/"),
    servePages({
      "/": () =>
        html(`
          <header><a href="/your-choices">Choices</a></header>
          <footer><a href="https://www.acme.example/your-choices#top">Your choices</a></footer>`),
      "/your-choices/": () => html("<title>Manage your data</title><p>…</p>"),
    }),
  );
  assert.deepEqual(check, {
    onSearchedPage: true,
    linkText: "Your choices",
    foundIn: ["header", "footer"],
    pageTitle: "Manage your data",
  });
});

test("reports when the link isn't on the searched page", async () => {
  const check = await checkMissedLink(
    HOME,
    new URL("https://acme.example/legal/dpa"),
    servePages({
      "/": () => html('<a href="/privacy">Privacy</a>'),
      "/legal/dpa": () => html("no", 403),
    }),
  );
  assert.deepEqual(check, {
    onSearchedPage: false,
    linkText: null,
    foundIn: null,
    pageTitle: null,
  });
});

test("says it couldn't check when the searched page can't be read", async () => {
  const check = await checkMissedLink(
    HOME,
    new URL("https://acme.example/privacy"),
    servePages({
      "/": () => html("blocked", 403),
      "/privacy": () => html("<title>Privacy</title>"),
    }),
  );
  assert.equal(check.onSearchedPage, null);
  assert.equal(check.pageTitle, "Privacy");
});
