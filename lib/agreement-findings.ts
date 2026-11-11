import { CATEGORIES, type Category } from "./agreement-prompt.ts";

export type Finding = {
  category: Category;
  plain_english: string;
  quote: string;
};

/** Something the model returned that we won't show as a finding, and why. */
export type FlaggedFinding = {
  reason: "bad_shape" | "unknown_category" | "quote_not_found";
  detail: string;
  /** What the model sent for this item, as-is. */
  raw: unknown;
};

export type ParsedFindings =
  | { ok: true; findings: Finding[]; flagged: FlaggedFinding[] }
  | { ok: false; message: string };

/**
 * Turns the model's reply into findings. The reply is untrusted: it may not be
 * JSON, may be the wrong shape, and quotes may be invented. Items that fail a
 * check are moved to `flagged` instead of being shown as findings.
 */
export function parseFindings(reply: string, sourceText: string): ParsedFindings {
  let data: unknown;
  try {
    data = JSON.parse(stripCodeFence(reply));
  } catch {
    return { ok: false, message: "The model's reply wasn't valid JSON." };
  }

  if (!isObject(data) || !Array.isArray(data.findings)) {
    return { ok: false, message: 'The model\'s reply had no "findings" list.' };
  }

  const source = normaliseForQuoteCheck(sourceText);
  const findings: Finding[] = [];
  const flagged: FlaggedFinding[] = [];

  for (const item of data.findings) {
    if (
      !isObject(item) ||
      !isNonEmptyString(item.category) ||
      !isNonEmptyString(item.plain_english) ||
      !isNonEmptyString(item.quote)
    ) {
      flagged.push({
        reason: "bad_shape",
        detail: "Needs category, plain_english and quote, all non-empty text.",
        raw: item,
      });
      continue;
    }
    if (!isCategory(item.category)) {
      flagged.push({ reason: "unknown_category", detail: `"${item.category}"`, raw: item });
      continue;
    }
    if (!quoteAppearsIn(item.quote, source)) {
      flagged.push({
        reason: "quote_not_found",
        detail: "This quote isn't in the text, so the model may have made it up.",
        raw: item,
      });
      continue;
    }
    findings.push({
      category: item.category,
      plain_english: item.plain_english.trim(),
      quote: item.quote.trim(),
    });
  }

  return { ok: true, findings, flagged };
}

/**
 * True if the quote is in the text. Exact apart from whitespace (line breaks,
 * double spaces) and curly vs straight quotes/dashes, which models often
 * change when copying. Wording, case and punctuation must otherwise match.
 * `normalisedSource` must already be passed through normaliseForQuoteCheck.
 */
export function quoteAppearsIn(quote: string, normalisedSource: string): boolean {
  const q = normaliseForQuoteCheck(quote);
  return q.length > 0 && normalisedSource.includes(q);
}

export function normaliseForQuoteCheck(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Some models wrap JSON in ```json ... ``` even when told not to. */
function stripCodeFence(reply: string): string {
  const match = reply.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : reply;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
