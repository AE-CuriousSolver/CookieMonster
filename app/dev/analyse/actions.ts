"use server";

import type { AnalysisResult } from "@/lib/analyse-agreement";
import { analyseAgreement } from "@/lib/gemini";
import { devPagesEnabled } from "@/lib/settings";
import { PROMPT_VERSION } from "@/lib/agreement-prompt";

export type AnalyseState = { status: "idle" } | AnalysisResult;

export async function analyseText(
  _previous: AnalyseState,
  formData: FormData,
): Promise<AnalyseState> {
  // Checked here too, not just on the page: anyone can call a server action directly.
  if (!devPagesEnabled()) {
    return {
      status: "failed",
      promptVersion: PROMPT_VERSION,
      reason: "model_error",
      message: "This page only works locally.",
    };
  }
  const text = formData.get("text");
  return analyseAgreement(typeof text === "string" ? text : "");
}
