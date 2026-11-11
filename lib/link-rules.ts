/**
 * Every word list and weight used to find and score policy links, in one place.
 * Change these to tune results; the logic lives in policy-links.ts and link-score.ts.
 */

/** The three documents we look for. */
export const POLICY_CATEGORIES = ["privacy", "cookie", "terms"] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

/**
 * Topic words decide a link's category. Checked in the link text and URL path.
 * "terms" also covers "terms of use", "terms of service" and "terms and conditions".
 */
export const TOPIC_WORDS: Record<PolicyCategory, RegExp[]> = {
  privacy: [/privacy/i],
  cookie: [/cookie/i, /tracking/i],
  terms: [/terms/i, /conditions/i],
};

/** Document words only add points. On their own they never make a link a candidate. */
export const DOCUMENT_WORDS: RegExp[] = [
  /polic(y|ies)/i,
  /notice/i,
  /statement/i,
  /agreement/i,
];

/**
 * Gateway words mark a page that leads to the policies, like "All legal
 * documents". Checked in link text only (many sites put every page under
 * /legal/). A gateway link is opened and its links followed, but it's never a
 * result itself. A link with a topic word as well is a normal result.
 */
export const GATEWAY_WORDS: RegExp[] = [/\blegal\b/i, /\bpolicies\b/i];

/**
 * Link text or page titles that are questions are usually FAQ articles, not the
 * policy itself, e.g. "How can I change my BBC cookie settings?". Text ending
 * in "?" always counts; "How/What…" only when a question verb follows, so a
 * heading like "How we use your data" doesn't.
 */
export const QUESTION_PATTERNS: RegExp[] = [
  /\?\s*$/,
  /^(how|what|why|when|where|who|which)\s+(do|does|did|can|could|will|would|is|are|was|should|happens?|long|much|many)\b/i,
];

/**
 * A link containing any of these is dropped, even if it has a topic word.
 * Mostly the many other uses of "terms", e.g. "Returns terms" or "Promotion terms".
 */
export const EXCLUDED_WORDS: RegExp[] = [
  /accessibility/i,
  /refund/i,
  /returns/i,
  /shipping/i,
  /warranty/i,
  /\bfaq/i,
  /careers/i,
  /glossary/i,
  /promotion/i,
  /affiliate/i,
];

/**
 * Points added to a link's score. Topic and document words count once per
 * place (text, path, title), however many of them appear there.
 * Ties go to the shorter path, so /privacy beats /privacy/how-we-use-x.
 */
export const SCORE_WEIGHTS = {
  /**
   * footer: in the homepage's <footer>. page: anywhere on a homepage without one.
   * linked: in the main content of a page the homepage links to (one level only).
   */
  location: { footer: 3, page: 1, linked: 2 },
  topicWord: { text: 3, path: 2, title: 3 },
  documentWord: { text: 2, path: 1, title: 1 },
  /** Added once if the link text or page title is a question. */
  question: -4,
} as const;
