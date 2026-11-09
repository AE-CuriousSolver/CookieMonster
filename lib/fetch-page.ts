import { lookup } from "node:dns/promises";
import {
  checkFetchable,
  isNonPublicAddress,
  PRIVATE_ADDRESS_MESSAGE,
} from "./validate-url.ts";

export type PageResult =
  | { ok: true; html: string; url: string }
  | { ok: false; message: string };

/** Passed in so tests can use saved HTML instead of the live internet. */
export type FetchDeps = {
  fetch: typeof fetch;
  resolveHost: (hostname: string) => Promise<string[]>;
};

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 3 * 1024 * 1024;
const USER_AGENT = "CookieMonster/0.1 (policy link finder)";

const defaultDeps: FetchDeps = {
  fetch: (input, init) => fetch(input, init),
  resolveHost: async (hostname) => {
    const results = await lookup(hostname, { all: true });
    return results.map((result) => result.address);
  },
};

export async function fetchPage(
  startUrl: URL,
  deps: FetchDeps = defaultDeps,
): Promise<PageResult> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = startUrl;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const addresses = await deps.resolveHost(url.hostname.replace(/^\[|\]$/g, ""));
      if (addresses.some(isNonPublicAddress)) {
        return { ok: false, message: PRIVATE_ADDRESS_MESSAGE };
      }

      // "manual" so we can check each redirect target before following it.
      const response = await deps.fetch(url, {
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const next = nextUrl(response, url);
        if (!next.ok) return next;
        url = next.url;
        continue;
      }
      if (!response.ok) return { ok: false, message: statusMessage(response.status) };

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !/html/i.test(contentType)) {
        const type = contentType.split(";")[0].trim();
        return { ok: false, message: `That address returned a file (${type}), not a web page.` };
      }

      const html = await readText(response);
      if (!html.trim()) return { ok: false, message: "The site returned an empty page." };
      return { ok: true, html, url: url.toString() };
    }
    return { ok: false, message: "The site redirected too many times, so we stopped following it." };
  } catch (error) {
    return { ok: false, message: networkErrorMessage(error) };
  }
}

function nextUrl(
  response: Response,
  current: URL,
): { ok: true; url: URL } | { ok: false; message: string } {
  const location = response.headers.get("location");
  if (!location) {
    return { ok: false, message: "The site sent a redirect without saying where to." };
  }
  try {
    return checkFetchable(new URL(location, current));
  } catch {
    return { ok: false, message: "The site redirected to an invalid address." };
  }
}

/** Stops at MAX_BYTES so a huge response can't use up the server's memory. */
async function readText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;

  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text;
}

function statusMessage(status: number): string {
  if (status === 401 || status === 403 || status === 429) {
    return `The site refused our request (HTTP ${status}). Many sites block automated tools.`;
  }
  if (status === 404) return "The site says that page doesn't exist (HTTP 404).";
  if (status >= 500) return `The site is having problems right now (HTTP ${status}). Try again later.`;
  return `The site couldn't return the page (HTTP ${status}).`;
}

function networkErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "The site took too long to respond.";
  }
  const code = errorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
    return "We couldn't find that website. Check the address for typos.";
  }
  if (/CERT|SSL|TLS/.test(code)) {
    return "The site's security certificate couldn't be verified, so we didn't read it.";
  }
  return "We couldn't connect to that website.";
}

// Node's fetch wraps the real reason in `error.cause`.
function errorCode(error: unknown): string {
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: { code?: unknown } };
  return String(cause?.code ?? code ?? "");
}
