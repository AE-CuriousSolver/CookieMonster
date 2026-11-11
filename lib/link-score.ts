import {
  DOCUMENT_WORDS,
  EXCLUDED_WORDS,
  GATEWAY_WORDS,
  POLICY_CATEGORIES,
  QUESTION_PATTERNS,
  SCORE_WEIGHTS,
  TOPIC_WORDS,
  type PolicyCategory,
} from "./link-rules.ts";

export type Where = "text" | "path" | "title";

/**
 * Where the link was found: in the homepage's <footer>, anywhere on a homepage
 * without one, or on a page the homepage links to.
 */
export type LinkLocation = "footer" | "page" | "linked";

/**
 * A word that matched, and where. category is "document" for document words
 * and "question" when the text or title reads as a question.
 */
export type PolicyMatch = {
  category: PolicyCategory | "document" | "question";
  keyword: string;
  where: Where;
};

/** Topic and document words found in one piece of text. */
export function matchWords(value: string, where: Where): PolicyMatch[] {
  const matches: PolicyMatch[] = [];
  for (const category of POLICY_CATEGORIES) {
    for (const pattern of TOPIC_WORDS[category]) {
      const keyword = pattern.exec(value)?.[0];
      if (keyword) matches.push({ category, keyword, where });
    }
  }
  for (const pattern of DOCUMENT_WORDS) {
    const keyword = pattern.exec(value)?.[0];
    if (keyword) matches.push({ category: "document", keyword, where });
  }
  const trimmed = value.trim();
  if (where !== "path" && QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    matches.push({ category: "question", keyword: trimmed.slice(0, 60), where });
  }
  return matches;
}

/** Link text like "All legal documents": worth opening to find the policies. */
export function isGateway(text: string): boolean {
  return GATEWAY_WORDS.some((pattern) => pattern.test(text));
}

function isTopic(match: PolicyMatch): boolean {
  return (POLICY_CATEGORIES as readonly string[]).includes(match.category);
}

export function isExcluded(...values: string[]): boolean {
  return EXCLUDED_WORDS.some((pattern) => values.some((value) => pattern.test(value)));
}

/**
 * The categories a link belongs to: only topic words in the link text or path
 * count. Document words and words in the page title only add to the score.
 */
export function categoriesOf(matches: PolicyMatch[]): PolicyCategory[] {
  return POLICY_CATEGORIES.filter((category) =>
    matches.some((match) => match.category === category && match.where !== "title"),
  );
}

/** Adds up the weights in link-rules.ts. */
export function scoreFor(location: LinkLocation, matches: PolicyMatch[]): number {
  let score = SCORE_WEIGHTS.location[location];
  for (const where of ["text", "path", "title"] as const) {
    const here = matches.filter((match) => match.where === where);
    if (here.some(isTopic)) {
      score += SCORE_WEIGHTS.topicWord[where];
    }
    if (here.some((match) => match.category === "document")) {
      score += SCORE_WEIGHTS.documentWord[where];
    }
  }
  if (matches.some((match) => match.category === "question")) {
    score += SCORE_WEIGHTS.question;
  }
  return score;
}

/** Drops repeats, e.g. "privacy" in the text of two links to the same page. */
export function mergeMatches(current: PolicyMatch[], next: PolicyMatch[]): PolicyMatch[] {
  const merged = [...current];
  for (const match of next) {
    const isRepeat = merged.some(
      (seen) =>
        seen.category === match.category &&
        seen.where === match.where &&
        seen.keyword.toLowerCase() === match.keyword.toLowerCase(),
    );
    if (!isRepeat) merged.push(match);
  }
  return merged;
}

type Rankable = { url: string; score: number; categories: PolicyCategory[] };

/** Highest score first; on a tie, the shorter path (/privacy before /privacy/x). */
export function compareLinks(a: Rankable, b: Rankable): number {
  return (
    b.score - a.score ||
    new URL(a.url).pathname.length - new URL(b.url).pathname.length ||
    a.url.localeCompare(b.url)
  );
}

export type CategoryGroup<T> = { category: PolicyCategory; best: T; others: T[] };

/**
 * One group per category that has links: the best link, then the rest.
 * A link in two categories appears in both groups.
 */
export function groupByCategory<T extends Rankable>(links: T[]): CategoryGroup<T>[] {
  const groups: CategoryGroup<T>[] = [];
  for (const category of POLICY_CATEGORIES) {
    const [best, ...others] = links
      .filter((link) => link.categories.includes(category))
      .sort(compareLinks);
    if (best) groups.push({ category, best, others });
  }
  return groups;
}
