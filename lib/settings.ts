/**
 * Review tools (adding missed links) are for the project owner only. Turn them
 * on with ENABLE_MISSED_LINKS=true in .env.local. Never set this on Vercel.
 */
export function missedLinksEnabled(): boolean {
  return process.env.ENABLE_MISSED_LINKS === "true";
}

/**
 * Developer pages like /dev/analyse only work under `npm run dev`, so nobody
 * can use up the Gemini quota through the deployed site.
 */
export function devPagesEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}
