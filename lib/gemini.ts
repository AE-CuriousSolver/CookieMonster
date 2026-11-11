// Makes the build fail if a client component imports this file, so the API key
// can never end up in browser code. Next.js provides this module itself.
import "server-only";

import { GoogleGenAI } from "@google/genai";
import { CATEGORIES, PROMPT_VERSION } from "./agreement-prompt.ts";
import {
  analyseAgreementWith,
  readGeminiConfig,
  type AnalysisResult,
} from "./analyse-agreement.ts";

/** Asks Gemini what the user agrees to in a policy or terms text. */
export async function analyseAgreement(text: string): Promise<AnalysisResult> {
  const config = readGeminiConfig(process.env);
  if (!config.ok) {
    return {
      status: "failed",
      promptVersion: PROMPT_VERSION,
      reason: "missing_config",
      message: config.message,
    };
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  return analyseAgreementWith(text, config.model, async (prompt) => {
    const response = await ai.models.generateContent({
      model: config.model,
      contents: prompt,
      config: {
        // Ask Gemini's JSON mode for this shape. We still check the reply
        // ourselves in parseFindings, because the model can get it wrong.
        responseMimeType: "application/json",
        responseJsonSchema: FINDINGS_SCHEMA,
        temperature: 0,
      },
    });
    return response.text ?? "";
  });
}

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...CATEGORIES] },
          plain_english: { type: "string" },
          quote: { type: "string" },
        },
        required: ["category", "plain_english", "quote"],
      },
    },
  },
  required: ["findings"],
};
