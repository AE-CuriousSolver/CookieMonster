"use client";

import { useActionState } from "react";
import { analyseText, type AnalyseState } from "./actions";

const initialState: AnalyseState = { status: "idle" };

export function AnalyseForm() {
  const [state, formAction, pending] = useActionState(analyseText, initialState);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-2">
        <label htmlFor="text" className="font-medium">
          Agreement text
        </label>
        <textarea
          id="text"
          name="text"
          rows={12}
          className="rounded border border-zinc-400 bg-transparent p-3 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
        >
          {pending ? "Analysing…" : "Analyse"}
        </button>
      </form>

      {!pending && state.status === "failed" && (
        <p role="alert" className="rounded border border-red-400 p-3 text-red-700 dark:text-red-300">
          <strong>{state.reason}</strong>: {state.message}
        </p>
      )}

      {!pending && state.status === "ok" && (
        <>
          <p className="text-sm text-zinc-500">
            Prompt <code>{state.promptVersion}</code> · model <code>{state.model}</code>
          </p>

          <section className="flex flex-col gap-3">
            <h2 className="font-semibold">Findings ({state.findings.length})</h2>
            <ul className="flex flex-col gap-3">
              {state.findings.map((finding, i) => (
                <li key={i} className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{finding.category}</p>
                  <p>{finding.plain_english}</p>
                  <blockquote className="mt-2 border-l-2 border-zinc-400 pl-3 text-sm italic text-zinc-600 dark:text-zinc-400">
                    “{finding.quote}”
                  </blockquote>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-semibold">Flagged ({state.flagged.length})</h2>
            {state.flagged.length === 0 && <p className="text-sm text-zinc-500">Nothing flagged.</p>}
            <ul className="flex flex-col gap-3">
              {state.flagged.map((flag, i) => (
                <li key={i} className="rounded border border-amber-400 p-3">
                  <p className="text-sm">
                    <strong>{flag.reason}</strong>: {flag.detail}
                  </p>
                  <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(flag.raw, null, 2)}</pre>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
