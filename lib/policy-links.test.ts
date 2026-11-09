import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  countCategoryWords,
  findLinkTo,
  findPolicyLinks,
  looksLikeBlockPage,
} from "./policy-links.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const PAGE = "https://acme.example/";

test("finds policy links in a typical footer", () => {
  const links = findPolicyLinks(fixture("footer-links.html"), PAGE);
  assert.deepEqual(links.map((link) => link.url).sort(), [
    "https://acme.example/cookies",
    "https://acme.example/dpa",
    "https://acme.example/privacy",
    "https://acme.example/trust-center",
    "https://acme.example/your-data",
    "https://legal.acme.example/terms-of-service",
  ]);
});

test("ignores scripts, comments, data-href and non-web links", () => {
  const urls = findPolicyLinks(fixture("footer-links.html"), PAGE).map((link) => link.url);
  for (const unwanted of ["script-privacy", "old-privacy", "wrong-privacy", "mailto:"]) {
    assert.ok(!urls.some((url) => url.includes(unwanted)), unwanted);
  }
});

test("merges duplicates and keeps the longest text", () => {
  const links = findPolicyLinks(fixture("footer-links.html"), PAGE);
  const privacy = links.filter((link) => link.url === "https://acme.example/privacy");
  assert.equal(privacy.length, 1);
  assert.equal(privacy[0].text, "Privacy Policy");
});

test("treats a trailing slash, www and query strings as the same page", () => {
  const html =
    '<a href="/privacy/?cid=footer">Privacy</a><a href="https://www.acme.example/privacy">Privacy</a>';
  const links = findPolicyLinks(html, PAGE);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://www.acme.example/privacy");
});

test("decodes entities and falls back to the path for image links", () => {
  const links = findPolicyLinks(fixture("footer-links.html"), PAGE);
  const textFor = (url: string) => links.find((link) => link.url === url)?.text;
  assert.equal(textFor("https://legal.acme.example/terms-of-service"), "Terms & Conditions");
  assert.equal(textFor("https://acme.example/cookies"), "cookies");
});

test("assigns categories", () => {
  const links = findPolicyLinks(fixture("footer-links.html"), PAGE);
  const categoriesFor = (url: string) => links.find((link) => link.url === url)?.categories;
  assert.deepEqual(categoriesFor("https://acme.example/cookies"), ["cookies"]);
  assert.deepEqual(categoriesFor("https://acme.example/trust-center"), ["security"]);
  assert.deepEqual(categoriesFor("https://acme.example/dpa"), ["data"]);
  assert.equal(categoriesFor("https://acme.example/accessibility"), undefined);
  assert.equal(categoriesFor("https://acme.example/affiliates/terms"), undefined);
});

test("records which word matched and where", () => {
  const html = '<a href="/legal/privacy-policy">Your Privacy</a>';
  assert.deepEqual(findPolicyLinks(html, PAGE)[0].matches, [
    { category: "privacy", keyword: "Privacy", where: "text" },
    { category: "privacy", keyword: "privacy", where: "path" },
    { category: "terms", keyword: "legal", where: "path" },
    { category: "policy", keyword: "policy", where: "path" },
  ]);
});

test("records which part of the page each link sat in", () => {
  const html = `
    <header><a href="/privacy">Privacy</a></header>
    <p><a href="/terms">Terms</a></p>
    <footer><nav><a href="/cookies">Cookies</a></nav><a href="/privacy">Privacy</a></footer>`;
  const foundIn = Object.fromEntries(
    findPolicyLinks(html, PAGE).map((link) => [new URL(link.url).pathname, link.foundIn]),
  );
  assert.deepEqual(foundIn, {
    "/privacy": ["header", "footer"],
    "/terms": ["page body"],
    "/cookies": ["footer > nav"],
  });
});

test("does not match on the domain name", () => {
  const html = '<a href="/pricing">Pricing</a>';
  assert.deepEqual(findPolicyLinks(html, "https://cookies-and-privacy.example/"), []);
});

test("returns nothing when no links are policies", () => {
  assert.deepEqual(findPolicyLinks(fixture("no-policy-links.html"), PAGE), []);
});

test("survives malformed paths and entities", () => {
  const html = '<a href="/privacy/%E0%A4%A"></a><a href="/terms">&#99999999; Terms</a>';
  assert.equal(findPolicyLinks(html, PAGE).length, 2);
});

test("stays fast on pages crafted to be slow", () => {
  const size = 3 * 1024 * 1024;
  for (const unit of ["<a>", "<a ", "<!--", "<script>", "<style ", "<a href=x>"]) {
    const started = performance.now();
    findPolicyLinks(unit.repeat(size / unit.length), PAGE);
    assert.ok(performance.now() - started < 1000, unit);
  }
  const started = performance.now();
  findPolicyLinks(`<a>${"<b ".repeat(size / 3)}</a>`, PAGE);
  assert.ok(performance.now() - started < 1000, "one huge link");
});

test("recognises bot-check pages", () => {
  assert.equal(looksLikeBlockPage(fixture("block-page.html")), true);
  assert.equal(looksLikeBlockPage(fixture("footer-links.html")), false);
});

test("counts our words in page text, most frequent first", () => {
  const counts = countCategoryWords("Privacy matters. Our privacy policy and DPA. Privacy!");
  assert.deepEqual(counts, [
    { category: "privacy", keyword: "privacy", count: 3 },
    { category: "data", keyword: "dpa", count: 1 },
    { category: "policy", keyword: "policy", count: 1 },
  ]);
});

test("finds a specific link on a page, whatever its wording", () => {
  const html = '<footer><a href="/choices/">Do Not Sell or Share</a></footer>';
  assert.deepEqual(findLinkTo(html, PAGE, "http://www.acme.example/choices"), {
    text: "Do Not Sell or Share",
    foundIn: ["footer"],
  });
  assert.equal(findLinkTo(html, PAGE, "https://acme.example/other"), null);
});

test("decodes common punctuation entities in link text", () => {
  const html = '<a href="/terms">Terms &ndash; Acme&rsquo;s rules</a>';
  assert.equal(findPolicyLinks(html, PAGE)[0].text, "Terms – Acme’s rules");
});
