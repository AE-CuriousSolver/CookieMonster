import assert from "node:assert/strict";
import { test } from "node:test";
import { normaliseForQuoteCheck, parseFindings, quoteAppearsIn } from "./agreement-findings.ts";

const POLICY = `We collect your email address and device identifiers.
We share   your data with advertising partners.
We keep your data for “as long as necessary”.`;

const reply = (findings: unknown) => JSON.stringify({ findings });

test("keeps a valid finding whose quote is in the text", () => {
  const result = parseFindings(
    reply([
      {
        category: "collected",
        plain_english: "They collect your email and device IDs.",
        quote: "We collect your email address and device identifiers.",
      },
    ]),
    POLICY,
  );
  assert.deepEqual(result, {
    ok: true,
    findings: [
      {
        category: "collected",
        plain_english: "They collect your email and device IDs.",
        quote: "We collect your email address and device identifiers.",
      },
    ],
    flagged: [],
  });
});

test("flags a quote that isn't in the text", () => {
  const result = parseFindings(
    reply([{ category: "shared_with", plain_english: "x", quote: "We sell your data to anyone." }]),
    POLICY,
  );
  assert.ok(result.ok);
  assert.equal(result.findings.length, 0);
  assert.equal(result.flagged[0].reason, "quote_not_found");
});

test("flags a paraphrased quote (wording must match)", () => {
  const result = parseFindings(
    reply([{ category: "collected", plain_english: "x", quote: "We collect your e-mail address" }]),
    POLICY,
  );
  assert.ok(result.ok);
  assert.equal(result.flagged[0]?.reason, "quote_not_found");
});

test("accepts a quote that differs only in whitespace or curly quotes", () => {
  const result = parseFindings(
    reply([
      { category: "shared_with", plain_english: "x", quote: "share your data with\nadvertising partners" },
      { category: "retention", plain_english: "y", quote: 'for "as long as necessary"' },
    ]),
    POLICY,
  );
  assert.ok(result.ok);
  assert.equal(result.findings.length, 2);
  assert.equal(result.flagged.length, 0);
});

test("flags an unknown category", () => {
  const result = parseFindings(
    reply([{ category: "biometrics", plain_english: "x", quote: "We collect your email address" }]),
    POLICY,
  );
  assert.ok(result.ok);
  assert.equal(result.flagged[0].reason, "unknown_category");
});

test("flags items with missing or empty fields", () => {
  const result = parseFindings(
    reply([
      { category: "collected", quote: "We collect your email address" },
      { category: "collected", plain_english: "   ", quote: "We collect your email address" },
      { category: "collected", plain_english: "x", quote: 42 },
      "not an object",
      null,
    ]),
    POLICY,
  );
  assert.ok(result.ok);
  assert.equal(result.findings.length, 0);
  assert.deepEqual(
    result.flagged.map((f) => f.reason),
    ["bad_shape", "bad_shape", "bad_shape", "bad_shape", "bad_shape"],
  );
});

test("keeps good findings and flags bad ones from the same reply", () => {
  const result = parseFindings(
    reply([
      { category: "collected", plain_english: "ok", quote: "device identifiers" },
      { category: "collected", plain_english: "made up", quote: "your blood type" },
    ]),
    POLICY,
  );
  assert.ok(result.ok);
  assert.equal(result.findings.length, 1);
  assert.equal(result.flagged.length, 1);
});

test("accepts an empty findings list", () => {
  assert.deepEqual(parseFindings(reply([]), POLICY), { ok: true, findings: [], flagged: [] });
});

test("reads JSON wrapped in a ```json code fence", () => {
  const fenced = "```json\n" + reply([]) + "\n```";
  assert.deepEqual(parseFindings(fenced, POLICY), { ok: true, findings: [], flagged: [] });
});

test("rejects a reply that isn't JSON", () => {
  const result = parseFindings("Sure! Here are the findings: ...", POLICY);
  assert.equal(result.ok, false);
});

test("rejects JSON without a findings list", () => {
  assert.equal(parseFindings("[]", POLICY).ok, false);
  assert.equal(parseFindings('{"findings": "none"}', POLICY).ok, false);
  assert.equal(parseFindings("null", POLICY).ok, false);
});

test("an empty quote never matches", () => {
  assert.equal(quoteAppearsIn("   ", normaliseForQuoteCheck(POLICY)), false);
});
