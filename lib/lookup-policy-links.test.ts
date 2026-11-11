import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { FetchDeps } from "./fetch-page.ts";
import { lookupPolicyLinks, type LookupOptions, type LookupResult } from "./lookup-policy-links.ts";
import { RecentResults } from "./recent-results.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const lookup = (input: string, deps: FetchDeps, recent?: LookupOptions["recent"]) =>
  lookupPolicyLinks(input, { deps, recent });

const htmlResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const redirectTo = (location: string) =>
  new Response(null, { status: 302, headers: { location } });

function fakeDeps(
  respond: (url: string) => Response | Promise<Response>,
  addresses = ["93.184.216.34"],
): FetchDeps {
  return {
    fetch: async (input) => respond(String(input)),
    resolveHost: async () => addresses,
  };
}

async function failureMessage(deps: FetchDeps, input = "acme.example") {
  const result = await lookup(input, deps);
  assert.equal(result.status, "failed");
  return result.status === "failed" ? result.message : "";
}

test("returns links from the fetched homepage", async () => {
  const result = await lookup(
    "acme.example",
    fakeDeps(() => htmlResponse(fixture("footer-links.html"))),
  );
  assert.equal(result.status, "found");
  assert.ok(result.status === "found");
  assert.equal(result.links.length, 4);
});

test("resolves relative links against the page we were redirected to", async () => {
  const result = await lookup(
    "acme.example",
    fakeDeps((url) =>
      url === "https://acme.example/"
        ? redirectTo("https://www.acme.example/en/")
        : htmlResponse('<a href="privacy">Privacy</a>'),
    ),
  );
  assert.ok(result.status === "found");
  assert.equal(result.links[0].url, "https://www.acme.example/en/privacy");
});

test("does not call the network for an invalid address", async () => {
  const deps = fakeDeps(() => assert.fail("should not fetch"));
  assert.match(await failureMessage(deps, "not a url"), /valid address/);
});

test("refuses a hostname that resolves to a private address", async () => {
  const deps = fakeDeps(() => assert.fail("should not fetch"), ["10.0.0.5"]);
  assert.match(await failureMessage(deps), /private or local/);
});

test("refuses a redirect to a private address", async () => {
  const deps = fakeDeps(() => redirectTo("http://169.254.169.254/latest/meta-data"));
  assert.match(await failureMessage(deps), /private or local/);
});

test("gives up on redirect loops", async () => {
  const deps = fakeDeps(() => redirectTo("https://acme.example/"));
  assert.match(await failureMessage(deps), /redirected too many times/);
});

test("explains HTTP errors", async () => {
  const cases: [number, RegExp][] = [
    [403, /refused our request/],
    [404, /doesn't exist/],
    [503, /having problems/],
    [418, /HTTP 418/],
  ];
  for (const [status, expected] of cases) {
    const deps = fakeDeps(() => htmlResponse("nope", status));
    assert.match(await failureMessage(deps), expected);
  }
});

test("explains network failures", async () => {
  const failing = (error: unknown) => fakeDeps(() => Promise.reject(error));
  const timeout = new DOMException("timed out", "TimeoutError");
  const certificate = new TypeError("fetch failed", {
    cause: { code: "CERT_HAS_EXPIRED" },
  });

  assert.match(await failureMessage(failing(timeout)), /too long/);
  assert.match(await failureMessage(failing(certificate)), /certificate/);
  assert.match(await failureMessage(failing(new TypeError("fetch failed"))), /couldn't connect/);
});

test("explains a website that doesn't exist", async () => {
  const deps: FetchDeps = {
    fetch: () => assert.fail("should not fetch"),
    resolveHost: () => Promise.reject(Object.assign(new Error("dns"), { code: "ENOTFOUND" })),
  };
  assert.match(await failureMessage(deps), /couldn't find that website/);
});

test("rejects responses that aren't web pages", async () => {
  const deps = fakeDeps(
    () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
  );
  assert.match(await failureMessage(deps), /application\/pdf/);
});

test("explains empty pages", async () => {
  assert.match(await failureMessage(fakeDeps(() => htmlResponse("  "))), /empty page/);
});

test("explains why no links were found", async () => {
  const cases: [string, RegExp][] = [
    ["block-page.html", /bot check/],
    ["javascript-only.html", /JavaScript/],
    ["no-policy-links.html", /found no privacy/],
  ];
  for (const [name, expected] of cases) {
    const deps = fakeDeps(() => htmlResponse(fixture(name)));
    assert.match(await failureMessage(deps), expected);
  }
});

test("shows links even if the page mentions a bot-check phrase", async () => {
  const html = '<p>Access denied? Contact us.</p><a href="/privacy">Privacy</a>';
  const result = await lookup("acme.example", fakeDeps(() => htmlResponse(html)));
  assert.equal(result.status, "found");
});

test("reuses a recent result for the same URL instead of fetching again", async () => {
  let fetches = 0;
  const deps = fakeDeps(() => {
    fetches++;
    return htmlResponse('<a href="/privacy">Privacy</a>');
  });
  const recent = new RecentResults<LookupResult>(60_000, 10);

  // Each lookup fetches the homepage, then the privacy page it links to.
  await lookup("acme.example", deps, recent);
  const again = await lookup("https://acme.example/", deps, recent);
  assert.equal(again.status, "found");
  assert.equal(fetches, 2);

  await lookup("other.example", deps, recent);
  assert.equal(fetches, 4);
});

test("opens each policy link and reports what's on it", async () => {
  const result = await lookup(
    "acme.example",
    fakeDeps((url) =>
      url === "https://acme.example/"
        ? htmlResponse('<a href="/privacy">Privacy</a><a href="/terms">Terms</a>')
        : url.endsWith("/privacy")
          ? htmlResponse(fixture("privacy-page.html"))
          : htmlResponse("blocked", 403),
    ),
  );
  assert.ok(result.status === "found");
  const [privacy, terms] = result.links;
  assert.equal(privacy.page.status, "read");
  assert.equal(terms.page.status, "unreadable");
});

test("saves each new search once and remembers what the save returned", async () => {
  const deps = fakeDeps(() => htmlResponse('<a href="/privacy">Privacy</a>'));
  const recent = new RecentResults<LookupResult>(60_000, 10);
  const saved: string[] = [];
  const save: LookupOptions["save"] = async (input, url, result) => {
    saved.push(`${input} -> ${url.href}`);
    return result.status === "found"
      ? { ...result, links: result.links.map((link, i) => ({ ...link, candidateId: i + 1 })) }
      : result;
  };

  const first = await lookupPolicyLinks("acme.example", { deps, recent, save });
  const again = await lookupPolicyLinks("acme.example", { deps, recent, save });
  await lookupPolicyLinks("not a url", { deps, recent, save });

  assert.deepEqual(saved, ["acme.example -> https://acme.example/"]);
  assert.ok(first.status === "found" && again.status === "found");
  assert.equal(again.links[0].candidateId, 1);
});
