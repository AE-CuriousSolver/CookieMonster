-- Compare scores with the helpful marks, after `npm run check-urls -- --save`.
-- Run in the Supabase SQL editor. Change first_search_id to the first id the
-- script printed under "Saved searches", so older runs are left out.
-- Assumes categories is a text[] column; if it's jsonb, replace
-- unnest(c.categories) with jsonb_array_elements_text(c.categories).

-- 1. Every link, ranked within its category (rank 1 = what the UI shows first).
with params as (select 25 as first_search_id),
ranked as (
  select
    s.root_domain,
    cat as category,
    row_number() over (
      partition by c.search_id, cat
      order by c.score desc, length(regexp_replace(c.link_url, '^https?://[^/]+', ''))
    ) as rank,
    c.score,
    c.helpful,
    c.link_text,
    c.link_url,
    c.page_title,
    c.id
  from link_candidates c
  join link_searches s on s.id = c.search_id
  cross join lateral unnest(c.categories) as cat
  where c.search_id >= (select first_search_id from params)
)
select * from ranked order by root_domain, category, rank;

-- 2. How well the ranking does, per category. Paste the same params/ranked
--    block above this select to run it.
-- select
--   category,
--   count(*) filter (where rank = 1 and helpful)          as best_was_helpful,
--   count(*) filter (where rank = 1 and not helpful)      as best_was_unhelpful,
--   count(*) filter (where rank > 1 and helpful)          as good_link_ranked_lower,
--   count(*) filter (where rank > 1 and not helpful)      as others_unhelpful,
--   count(*) filter (where helpful is null)               as not_marked
-- from ranked group by category order by category;

-- 3. Score spread: do helpful links actually score higher?
-- select helpful, count(*), min(score), round(avg(score), 1) as avg_score, max(score)
-- from link_candidates
-- where search_id >= 25
-- group by helpful;
