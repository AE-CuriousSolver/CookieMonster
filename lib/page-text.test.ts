import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { mainContentHtml, readPageText } from "./page-text.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("reads the title and the main content", () => {
  const { title, text } = readPageText(fixture("privacy-page.html"));
  assert.equal(title, "Privacy Policy & Your Data | Acme");
  assert.equal(
    text,
    "Privacy Policy This privacy policy explains how Acme collects and uses your " +
      "personal data . Your rights under GDPR You can request a copy of your data under our DPA.",
  );
});

test("without a <main>, reads the whole page minus menus, footers and code", () => {
  const html =
    "<body><nav>Menu</nav><h1>Terms</h1><p>Be nice.</p><script>x()</script><footer>Bye</footer></body>";
  assert.equal(readPageText(html).text, "Terms Be nice.");
});

test("keeps the main content's links but not the menus or footer", () => {
  const html =
    '<nav><a href="/menu">Menu</a></nav><main><p>See our <a href="/aup">Acceptable Use Policy</a>.</p>' +
    '<nav><a href="/sidebar-policy">Sidebar</a></nav></main><footer><a href="/terms">Terms</a></footer>';
  const content = mainContentHtml(html);
  assert.ok(content.includes('<a href="/aup">Acceptable Use Policy</a>'));
  assert.ok(content.endsWith("</main>"), "keeps </main> so links show as found in main");
  for (const unwanted of ["/menu", "/sidebar-policy", "/terms"]) {
    assert.ok(!content.includes(unwanted), unwanted);
  }
});

test("stays fast on pages crafted to be slow", () => {
  const size = 3 * 1024 * 1024;
  for (const unit of ["<a ", "<!--", "<nav>", "<title ", "<main>"]) {
    const started = performance.now();
    readPageText(unit.repeat(size / unit.length));
    mainContentHtml(unit.repeat(size / unit.length));
    assert.ok(performance.now() - started < 1000, unit);
  }
});
