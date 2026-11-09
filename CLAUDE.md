# Cookie Monster

A web app that takes a company URL, finds its privacy policy, terms and
cookie policy, and gives plain-English FYIs on what data and access a user
gives by accepting. This is a learning project: building it is about
understanding how a full app ships, not about the product.

## Stack
- Next.js (App Router), TypeScript, Tailwind
- Deployed on Vercel (auto-deploys on push to main)
- Later: Gemini API (free tier), Supabase Postgres

## How I want to work
- I'm a backend Java/SQL engineer, new to frontend and TypeScript
- Work in small steps; explain what you'll do and why before changing files
- Point out any decisions you're making on my behalf
- Explain unfamiliar TypeScript/React/Next.js concepts briefly as they come up
- Don't add libraries without asking first
- Never put secrets in code; use .env.local


## Testing
- Keep logic (like link-finding) in separate functions with unit tests
- Test against saved HTML files, not live websites

## Commands
- `npm run dev`: run locally at http://localhost:3000