/**
 * Review tools (adding missed links) are for the project owner only. Turn them
 * on with ENABLE_MISSED_LINKS=true in .env.local. Never set this on Vercel.
 */
export function missedLinksEnabled(): boolean {
  return process.env.ENABLE_MISSED_LINKS === "true";
}
