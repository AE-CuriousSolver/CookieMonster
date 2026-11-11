import { buildPrompt, PROMPT_VERSION } from "./agreement-prompt.ts";
import { parseFindings, type FlaggedFinding, type Finding } from "./agreement-findings.ts";

/** Longest text we send, to protect the free-tier quota from huge pastes. */
export const MAX_TEXT_LENGTH = 100_000;

export type AnalysisFailure =
  | "empty_text"
  | "text_too_long"
  | "missing_config"
  | "rate_limited"
  | "invalid_json"
  | "model_error";

export type AnalysisResult =
  | {
      status: "ok";
      promptVersion: string;
      model: string;
      findings: Finding[];
      flagged: FlaggedFinding[];
    }
  | { status: "failed"; promptVersion: string; reason: AnalysisFailure; message: string };

/** Sends a prompt to a model and returns its text reply. Tests pass a fake. */
export type GenerateText = (prompt: string) => Promise<string>;

export type GeminiConfig =
  | { ok: true; apiKey: string; model: string }
  | { ok: false; message: string };

/** Reads GEMINI_API_KEY and GEMINI_MODEL. Takes env as a parameter so it can be tested. */
export function readGeminiConfig(env: Record<string, string | undefined>): GeminiConfig {
  const apiKey = env.GEMINI_API_KEY?.trim();
  const model = env.GEMINI_MODEL?.trim();
  const missing = [!apiKey && "GEMINI_API_KEY", !model && "GEMINI_MODEL"].filter(Boolean);
  if (!apiKey || !model) {
    return { ok: false, message: `Gemini isn't set up: add ${missing.join(" and ")} to .env.local.` };
  }
  return { ok: true, apiKey, model };
}

/** The steps of analyseAgreement, with the model call passed in. */
export async function analyseAgreementWith(
  text: string,
  model: string,
  generate: GenerateText,
): Promise<AnalysisResult> {
  const fail = (reason: AnalysisFailure, message: string): AnalysisResult => ({
    status: "failed",
    promptVersion: PROMPT_VERSION,
    reason,
    message,
  });

  if (text.trim().length === 0) return fail("empty_text", "Paste some text to analyse.");
  if (text.length > MAX_TEXT_LENGTH) {
    return fail(
      "text_too_long",
      `The text is ${text.length.toLocaleString()} characters; the limit is ${MAX_TEXT_LENGTH.toLocaleString()}.`,
    );
  }

  let reply: string;
  try {
    reply = await generate(buildPrompt(text));
  } catch (error) {
    if (statusOf(error) === 429) {
      return fail("rate_limited", "Gemini's rate limit was hit. Wait a minute and try again.");
    }
    console.error("Gemini request failed", error);
    return fail("model_error", "The request to Gemini failed. Check the server log.");
  }

  const parsed = parseFindings(reply, text);
  if (!parsed.ok) {
    console.error("Gemini reply couldn't be used:", parsed.message, reply.slice(0, 500));
    return fail("invalid_json", parsed.message);
  }
  return {
    status: "ok",
    promptVersion: PROMPT_VERSION,
    model,
    findings: parsed.findings,
    flagged: parsed.flagged,
  };
}

/** The HTTP status on an SDK error (e.g. 429), if it has one. */
function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}
