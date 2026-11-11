/**
 * The prompt sent to Gemini to read a policy or terms page.
 *
 * TEMPORARY: the categories and wording are placeholders so the connection can
 * be tested end to end. Bump PROMPT_VERSION whenever the prompt changes, so a
 * result can always be traced back to the prompt that produced it.
 */
export const PROMPT_VERSION = "v0-placeholder";

/** `as const` makes this a fixed list of literal strings, not just string[]. */
export const CATEGORIES = [
  "collected",
  "used_for",
  "shared_with",
  "retention",
  "ongoing_tracking",
  "user_controls",
] as const;

/** One of the strings above, e.g. "collected". */
export type Category = (typeof CATEGORIES)[number];

const CATEGORY_HINTS: Record<Category, string> = {
  collected: "what personal data they collect",
  used_for: "what they use the data for",
  shared_with: "who they share or sell the data to",
  retention: "how long they keep the data",
  ongoing_tracking: "tracking that continues after sign-up (cookies, pixels, device IDs)",
  user_controls: "what the user can do: opt out, delete, download, object",
};

export function buildPrompt(agreementText: string): string {
  const categoryList = CATEGORIES.map((c) => `- ${c}: ${CATEGORY_HINTS[c]}`).join("\n");
  return `You read privacy policies, cookie policies and terms of service, and tell
an ordinary person what they agree to about their data by accepting.

Find the important points in the text below. Use only these categories:
${categoryList}

Reply with JSON only, no other text, in exactly this shape:
{"findings": [{"category": "<one of the categories>", "plain_english": "<one short sentence a non-lawyer understands>", "quote": "<exact sentence or phrase copied from the text>"}]}

Rules:
- "quote" must be copied exactly, character for character, from the text. Do not paraphrase it.
- Only report what the text says. If the text says nothing for a category, skip it.

TEXT:
"""
${agreementText}
"""`;
}
