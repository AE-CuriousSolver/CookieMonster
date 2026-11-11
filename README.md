This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.


## Checking results on real sites
[scripts/test-urls.txt](scripts/test-urls.txt) holds a fixed list of websites, one per line (blank lines and `#` comments are ignored). To run the link search on all of them and print the best link per category, then the others, with scores, final URLs and page titles:

```bash
npm run check-urls                       # uses scripts/test-urls.txt
npm run check-urls -- path/to/other.txt  # uses another file
```

This visits the live sites. It's for checking the scoring by eye; the unit tests (`npm test`) use saved HTML files instead. It reads the Supabase keys from `.env.local`.

To tune the scoring:
1. `npm run check-urls -- --save` saves every search and link to Supabase, printing each link's `[id …]` and the search ids at the end.
2. In Supabase, Table Editor › `link_candidates`, set `helpful` to true or false for every link from those searches.
3. Run [scripts/score-review.sql](scripts/score-review.sql) in the SQL editor (set `first_search_id` first) to see each link's rank against your marks.
4. Adjust the weights in [lib/link-rules.ts](lib/link-rules.ts) and run again.

## How links are chosen
Every word list and weight lives in [lib/link-rules.ts](lib/link-rules.ts).
- If the homepage has a `<footer>` containing policy links, only those are used; otherwise the whole page.
- A link's category comes from a topic word in its text or path: privacy (`privacy`), cookie (`cookie`, `tracking`), terms (`terms`, `conditions`).
- Document words (`policy`, `notice`, `statement`, `agreement`) and matches in the linked page's title only add to the score. Link text or a title that's a question ("What are my rights?") loses points, since those are usually FAQ articles.
- Gateway words in link text (`legal`, `policies`, e.g. "All legal documents") mark a page that leads to the policies. It's opened and searched, but never shown as a result.
- Every footer page we open is searched once more (its main content only, same sites only), so a privacy hub's link to the full policy is found. These score a little less for location than footer links, so the hub wins unless the linked page looks more like the real document. Up to 20 pages are opened per search, best-scoring first.
- If opening a link lands on the homepage (some sites do this to new visitors), we keep the link and its score rather than trusting where it landed.
- Links mentioning accessibility, refunds, returns, shipping, warranty, FAQ, careers, glossary, promotions or affiliates are dropped.
- URLs lose their `?query`, `#hash` and trailing `/`. Links that redirect to the same page are merged.
- The highest score per category is shown first; on a tie, the shorter path wins.

## Limitations to note in the project
- There are six main places companies set out data and sharing conditions: privacy policy, terms, cookie policy, end-user licence agreement (EULA), data processing agreement (DPA) and acceptable use policy. We only look for the first three. The other three may show up among the other pages found when their link also uses a topic word (e.g. "Terms & Acceptable Use"), but that's unlikely. DPAs are usually business-to-business, so they rarely apply to everyday users anyway.
- Relies on links being in the footer or page HTML. Sites built entirely with JavaScript won’t work.
- Only a real `<footer>` tag counts as the footer. If a site has one but puts its policy links elsewhere (e.g. the header), those are missed.
- Only one level is followed: the homepage, then the pages its footer links to. A policy two clicks behind a hub is missed.
- Policies that are PDFs are found but can't be read, so they get no title points.
- Only English words are matched.
- Stripping the query string can merge different pages on sites that use addresses like `?doc=privacy`.
- "terms" also matches unrelated pages such as "Terms of sale"; the exclusion list only catches the common ones.
- Bot-blocked sites fail. A fallback of pasting a specific policy URL or its text is planned for the future.
- Policies split across several sub-pages are only partly covered.
- Different country versions of a policy aren’t handled; you get whatever the server is shown.
- Security practices (breaches, encryption) are out of scope.
- The cookie banner and its default settings aren’t checked; that’s planned for a future browser extension.
- Policies that change between runs are only detected once the database caching with text hashes is built.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

