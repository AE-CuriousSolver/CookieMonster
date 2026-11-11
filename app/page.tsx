import { missedLinksEnabled } from "@/lib/settings";
import { PolicyLinkForm } from "./policy-link-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Cookie Monster</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Enter a website to find its privacy, cookie and terms pages.
        </p>
      </div>
      <PolicyLinkForm canAddMissedLinks={missedLinksEnabled()} />
    </main>
  );
}
