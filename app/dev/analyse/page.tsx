import { notFound } from "next/navigation";
import { PROMPT_VERSION } from "@/lib/agreement-prompt";
import { devPagesEnabled } from "@/lib/settings";
import { AnalyseForm } from "./analyse-form";

/** TEMPORARY developer page for trying the Gemini analysis by hand. */
export default function AnalysePage() {
  if (!devPagesEnabled()) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Analyse agreement (dev)</h1>
        <p className="text-sm text-zinc-500">
          Paste a policy or terms text. Prompt version: <code>{PROMPT_VERSION}</code>
        </p>
      </header>
      <AnalyseForm />
    </main>
  );
}
