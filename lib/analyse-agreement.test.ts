import assert from "node:assert/strict";
import { test } from "node:test";
import { PROMPT_VERSION } from "./agreement-prompt.ts";
import {
  analyseAgreementWith,
  MAX_TEXT_LENGTH,
  readGeminiConfig,
  type GenerateText,
} from "./analyse-agreement.ts";

// These tests never call Gemini: each one passes a fake `generate` function.

const TEXT = "We collect your email address. We share it with partners.";

const replyWith = (reply: string): GenerateText => async () => reply;
const failWith = (error: unknown): GenerateText => async () => {
  throw error;
};

test("returns findings, flagged items, prompt version and model", async () => {
  const fake = replyWith(
    JSON.stringify({
      findings: [
        { category: "collected", plain_english: "They collect your email.", quote: "We collect your email address." },
        { category: "shared_with", plain_english: "Invented.", quote: "We sell it to anyone." },
      ],
    }),
  );
  const result = await analyseAgreementWith(TEXT, "test-model", fake);
  assert.equal(result.status, "ok");
  assert.ok(result.status === "ok");
  assert.equal(result.promptVersion, PROMPT_VERSION);
  assert.equal(result.model, "test-model");
  assert.equal(result.findings.length, 1);
  assert.equal(result.flagged[0].reason, "quote_not_found");
});

test("sends the text inside the prompt", async () => {
  let sent = "";
  await analyseAgreementWith(TEXT, "m", async (prompt) => {
    sent = prompt;
    return '{"findings": []}';
  });
  assert.ok(sent.includes(TEXT));
});

test("reports a 429 from Gemini as rate_limited", async () => {
  const error = Object.assign(new Error("Resource exhausted"), { status: 429 });
  const result = await analyseAgreementWith(TEXT, "m", failWith(error));
  assert.equal(result.status === "failed" && result.reason, "rate_limited");
});

test("reports other Gemini errors as model_error", async (t) => {
  t.mock.method(console, "error", () => {}); // keep the test output quiet
  const error = Object.assign(new Error("Server error"), { status: 500 });
  const result = await analyseAgreementWith(TEXT, "m", failWith(error));
  assert.equal(result.status === "failed" && result.reason, "model_error");
});

test("reports a non-JSON reply as invalid_json", async (t) => {
  t.mock.method(console, "error", () => {});
  const result = await analyseAgreementWith(TEXT, "m", replyWith("I can't help with that."));
  assert.equal(result.status === "failed" && result.reason, "invalid_json");
});

test("doesn't call Gemini for empty or too-long text", async () => {
  let calls = 0;
  const counting: GenerateText = async () => {
    calls++;
    return '{"findings": []}';
  };
  const empty = await analyseAgreementWith("   \n ", "m", counting);
  const long = await analyseAgreementWith("a".repeat(MAX_TEXT_LENGTH + 1), "m", counting);
  assert.equal(empty.status === "failed" && empty.reason, "empty_text");
  assert.equal(long.status === "failed" && long.reason, "text_too_long");
  assert.equal(calls, 0);
});

test("config: reports a missing key and model by name", () => {
  const config = readGeminiConfig({});
  assert.equal(config.ok, false);
  assert.ok(!config.ok && config.message.includes("GEMINI_API_KEY and GEMINI_MODEL"));
});

test("config: treats blank values as missing", () => {
  const config = readGeminiConfig({ GEMINI_API_KEY: "  ", GEMINI_MODEL: "gemini-x" });
  assert.ok(!config.ok && config.message.includes("GEMINI_API_KEY"));
});

test("config: reads key and model", () => {
  assert.deepEqual(readGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-x" }), {
    ok: true,
    apiKey: "k",
    model: "gemini-x",
  });
});
