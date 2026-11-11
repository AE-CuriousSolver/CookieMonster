import assert from "node:assert/strict";
import { test } from "node:test";
import { categoriesOf, groupByCategory, matchWords, scoreFor } from "./link-score.ts";

test("scores location, topic words and document words", () => {
  const matches = [...matchWords("Privacy Policy", "text"), ...matchWords("/privacy", "path")];
  // footer 3 + topic in text 3 + topic in path 2 + document word in text 2
  assert.equal(scoreFor("footer", matches), 10);
  assert.equal(scoreFor("page", matches), 8);
});

test("counts each kind of word once per place", () => {
  const once = matchWords("Privacy notice", "text");
  const many = matchWords("Privacy and cookie policy statement", "text");
  assert.equal(scoreFor("footer", once), scoreFor("footer", many));
});

test("title words add points but not categories", () => {
  const matches = [
    ...matchWords("/privacy", "path"),
    ...matchWords("Privacy & Cookie Policy | Acme", "title"),
  ];
  assert.deepEqual(categoriesOf(matches), ["privacy"]);
  // footer 3 + topic in path 2 + topic in title 3 + document word in title 1
  assert.equal(scoreFor("footer", matches), 9);
});

test("groups by category: best first, shorter path wins a tie, two-category links in both", () => {
  const link = (path: string, score: number, ...categories: ("privacy" | "cookie" | "terms")[]) => ({
    url: `https://acme.example${path}`,
    score,
    categories,
  });
  const groups = groupByCategory([
    link("/privacy/how-we-use-x", 8, "privacy"),
    link("/privacy", 8, "privacy"),
    link("/privacy-and-cookies", 6, "privacy", "cookie"),
  ]);
  assert.deepEqual(
    groups.map((group) => [
      group.category,
      new URL(group.best.url).pathname,
      group.others.map((other) => new URL(other.url).pathname),
    ]),
    [
      ["privacy", "/privacy", ["/privacy/how-we-use-x", "/privacy-and-cookies"]],
      ["cookie", "/privacy-and-cookies", []],
    ],
  );
});

test("questions lose points once, but question-like headings don't", () => {
  const faq = matchWords("How long will you keep my information?", "text");
  const heading = matchWords("How we use your data", "text");
  assert.ok(faq.some((match) => match.category === "question"));
  assert.ok(!heading.some((match) => match.category === "question"));
  const both = [...faq, ...matchWords("What are my rights", "title")];
  // footer 3 - question 4, counted once
  assert.equal(scoreFor("footer", both), -1);
});
