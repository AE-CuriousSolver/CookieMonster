"use client";

import { useActionState, useState, useTransition } from "react";
import type { CheckedLink } from "@/lib/check-policy-pages";
import type { PolicyCategory } from "@/lib/link-rules";
import { groupByCategory, type CategoryGroup } from "@/lib/link-score";
import { addMissedLink, checkUrl, markHelpful, type FormState } from "./actions";

const initialState: FormState = { status: "idle" };

export function PolicyLinkForm({ canAddMissedLinks }: { canAddMissedLinks: boolean }) {
  const [state, formAction, pending] = useActionState(checkUrl, initialState);
  const [url, setUrl] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="url" className="sr-only">
          Website address
        </label>
        <input
          id="url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="flex-1 rounded border border-zinc-400 bg-transparent px-3 py-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
        >
          {pending ? "Checking…" : "Find policies"}
        </button>
      </form>

      {!pending && state.status === "failed" && (
        <p role="alert" className="rounded border border-red-400 p-3 text-red-700 dark:text-red-300">
          {state.message}
        </p>
      )}

      {!pending && state.status === "found" && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">
            Found {state.links.length} {state.links.length === 1 ? "link" : "links"} on{" "}
            {state.pageUrl}
          </h2>
          {groupByCategory(state.links).map((group) => (
            <CategoryResult key={group.category} group={group} />
          ))}
        </section>
      )}

      {canAddMissedLinks && !pending && state.status !== "idle" && state.searchId !== undefined && (
        <MissedLinkForm key={state.searchId} searchId={state.searchId} />
      )}
    </div>
  );
}

function MissedLinkForm({ searchId }: { searchId: number }) {
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startSaving(async () => {
      const outcome = await addMissedLink(searchId, link, note);
      setResult(outcome);
      if (outcome.ok) {
        setLink("");
        setNote("");
      }
    });
  }

  return (
    <section className="flex flex-col gap-2 border-t border-zinc-300 pt-4 dark:border-zinc-700">
      <h2 className="font-semibold">Missed a link?</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Paste a helpful link the search didn&rsquo;t find.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input
          type="text"
          inputMode="url"
          aria-label="Missed link"
          placeholder="https://example.com/privacy-choices"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          className="rounded border border-zinc-400 bg-transparent px-3 py-2"
        />
        <input
          type="text"
          aria-label="Note (optional)"
          placeholder="Note (optional), e.g. was in the cookie banner"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="rounded border border-zinc-400 bg-transparent px-3 py-2"
        />
        <button
          type="submit"
          disabled={saving || !link.trim()}
          className="self-start rounded border border-zinc-400 px-4 py-2 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add missed link"}
        </button>
      </form>
      {result && (
        <p className={`text-sm ${result.ok ? "" : "text-amber-700 dark:text-amber-300"}`}>
          {result.message}
        </p>
      )}
    </section>
  );
}

const CATEGORY_NAMES: Record<PolicyCategory, string> = {
  privacy: "Privacy",
  cookie: "Cookies",
  terms: "Terms",
};

/** The best link for one category, with the others behind "Show more". */
function CategoryResult({ group }: { group: CategoryGroup<CheckedLink> }) {
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-300 pt-3 dark:border-zinc-700">
      <h3 className="font-semibold">{CATEGORY_NAMES[group.category]}</h3>
      <ul>
        <LinkResult link={group.best} />
      </ul>
      {group.others.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-400">
            Show {group.others.length} more
          </summary>
          <ul className="mt-3 flex flex-col gap-4 pl-4">
            {group.others.map((link) => (
              <LinkResult key={link.url} link={link} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function LinkResult({ link }: { link: CheckedLink }) {
  const title = link.page.status === "read" && link.page.title ? link.page.title : link.text;

  return (
    <li className="flex flex-col gap-1">
      <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline">
        {title}
      </a>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Score {link.score} ·{" "}
        {link.foundOn ? `linked from ${link.foundOn}` : `in the ${link.location}`} ·{" "}
        {link.categories.join(", ")}
      </p>
      {link.finalUrl && link.finalUrl !== link.url && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Redirects to {link.finalUrl}</p>
      )}
      {link.page.status === "unreadable" && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Couldn&rsquo;t read the page: {link.page.message}
        </p>
      )}
      {link.candidateId !== undefined && <HelpfulButtons candidateId={link.candidateId} />}
    </li>
  );
}

function HelpfulButtons({ candidateId }: { candidateId: number }) {
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, startSaving] = useTransition();

  function choose(helpful: boolean) {
    startSaving(async () => {
      const saved = await markHelpful(candidateId, helpful);
      setFailed(!saved);
      if (saved) setAnswer(helpful);
    });
  }

  const style = (selected: boolean) =>
    `rounded border px-2 py-0.5 ${selected ? "border-foreground bg-foreground text-background" : "border-zinc-400"}`;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span>Helpful?</span>
      <button type="button" disabled={saving} onClick={() => choose(true)} className={style(answer === true)}>
        Yes
      </button>
      <button type="button" disabled={saving} onClick={() => choose(false)} className={style(answer === false)}>
        No
      </button>
      {failed && <span className="text-amber-700 dark:text-amber-300">Couldn&rsquo;t save</span>}
    </div>
  );
}
