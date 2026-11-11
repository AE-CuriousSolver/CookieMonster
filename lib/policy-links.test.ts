import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  countCategoryWords,
  findLinkTo,
  findLinkedPolicyLinks,
  findPolicyLinks,
  looksLikeBlockPage,
  normaliseUrl,
} from "./policy-links.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const PAGE = "https://acme.example/";

test("finds privacy, cookie and terms links in a typical footer, best first", () => {
  const links = findPolicyLinks(fixture("footer-links.html"), PAGE);
  assert.deepEqual(
    links.map((link) => [link.url, link.categories, link.score]),
    [
      ["https://acme.example/privacy", ["privacy"], 10],
      ["https://acme.example/cookies", ["cookie"], 8],
      ["https://legal.acme.example/terms-of-service", ["terms"], 8],
      ["https://acme.example/privacy/how-we-use-data", ["privacy"], 5],
    ],
  );
  assert.ok(links.every((link) => link.location === "footer"));
});

test("drops excluded words, even with a topic word", () => {
  const html = `<footer>
    <a href="/legal/returns-terms">Returns terms</a>
    <a href="/promotion-terms">Promotion T&amp;Cs</a>
    <a href="/help/faq-privacy">Privacy FAQ</a>
    <a href="/accessibility">Accessibility statement</a>
    <a href="/terms">Terms</a></footer>`;
  assert.deepEqual(
    findPolicyLinks(html, PAGE).map((link) => link.url),
    ["https://acme.example/terms"],
  );
});

test("document words add points but never make a link a candidate", () => {
  const html = '<a href="/acceptable-use">Acceptable Use Policy</a><a href="/data">Your data</a>';
  assert.deepEqual(findPolicyLinks(html, PAGE), []);
});

test("only uses footer links when the footer has any", () => {
  const html = `
    <header><a href="/privacy-centre">Privacy centre</a></header>
    <footer><a href="/privacy">Privacy</a></footer>`;
  const links = findPolicyLinks(html, PAGE);
  assert.deepEqual(links.map((link) => link.url), ["https://acme.example/privacy"]);
  assert.equal(links[0].location, "footer");
});

test("uses the whole page when there's no footer, or nothing useful in it", () => {
  for (const html of [
    '<nav><a href="/privacy">Privacy</a></nav>',
    '<footer><a href="/blog">Blog</a></footer><nav><a href="/privacy">Privacy</a></nav>',
  ]) {
    const [link] = findPolicyLinks(html, PAGE);
    assert.equal(link.location, "page");
    assert.equal(link.score, 1 + 3 + 2);
  }
});

test("matches tracking and conditions, and allows two categories", () => {
  const html = `<footer>
    <a href="/legal/tracking">Tracking notice</a>
    <a href="/conditions-of-use">Conditions of Use</a>
    <a href="/privacy-and-cookies">Privacy &amp; Cookies</a></footer>`;
  const categories = Object.fromEntries(
    findPolicyLinks(html, PAGE).map((link) => [new URL(link.url).pathname, link.categories]),
  );
  assert.deepEqual(categories, {
    "/legal/tracking": ["cookie"],
    "/conditions-of-use": ["terms"],
    "/privacy-and-cookies": ["privacy", "cookie"],
  });
});

test("records which words matched and where", () => {
  const html = '<a href="/legal/privacy-policy">Your Privacy</a>';
  assert.deepEqual(findPolicyLinks(html, PAGE)[0].matches, [
    { category: "privacy", keyword: "Privacy", where: "text" },
    { category: "privacy", keyword: "privacy", where: "path" },
    { category: "document", keyword: "policy", where: "path" },
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

test("treats a trailing slash, www, query strings and hashes as the same page", () => {
  const html =
    '<a href="/privacy/?cid=footer#top">Privacy</a><a href="https://www.acme.example/privacy">Privacy</a>';
  const links = findPolicyLinks(html, PAGE);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://acme.example/privacy");
});

test("normalises URLs", () => {
  assert.equal(normaliseUrl("https://acme.example/privacy/?a=1#b"), "https://acme.example/privacy");
  assert.equal(normaliseUrl("https://acme.example/"), "https://acme.example");
});

test("decodes entities and falls back to the path for image links", () => {
  const links = findPolicyLinks(fixture("footer-links.html"), PAGE);
  const textFor = (url: string) => links.find((link) => link.url === url)?.text;
  assert.equal(textFor("https://legal.acme.example/terms-of-service"), "Terms & Conditions");
  assert.equal(textFor("https://acme.example/cookies"), "cookies");
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

test("counts topic words in page text, most frequent first", () => {
  const counts = countCategoryWords("Privacy matters. Our privacy policy and cookies. Privacy!");
  assert.deepEqual(counts, [
    { category: "privacy", keyword: "privacy", count: 3 },
    { category: "cookie", keyword: "cookie", count: 1 },
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

test("marks gateway links in the footer, only by their text", () => {
  const html = `<footer>
    <a href="/legal/">All legal documents</a>
    <a href="/legal/fscs-protection">FSCS Protection</a>
    <a href="/legal/privacy-notice">Privacy Notice</a></footer>`;
  assert.deepEqual(
    findPolicyLinks(html, PAGE).map((link) => [link.url, link.gateway ?? false]),
    [
      ["https://acme.example/legal/privacy-notice", false],
      ["https://acme.example/legal", true],
    ],
  );
});

test("finds linked links without gateways, located as linked", () => {
  const html = '<a href="/legal">Legal</a><a href="/privacy-policy">Full privacy policy</a>';
  const links = findLinkedPolicyLinks(html, PAGE);
  assert.deepEqual(
    links.map((link) => [link.url, link.location, link.score]),
    [["https://acme.example/privacy-policy", "linked", 2 + 3 + 2 + 2 + 1]],
  );
});
