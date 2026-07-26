# PROTOTYPE — retrieval in PostgreSQL (throwaway)

> Answers [#10](https://github.com/david-plugge/agent-memory/issues/10). Delete this directory once the answer is folded into the real schema.

## The question

Does a minimal PostgreSQL representation of human-authored **Document Paths** and immutable Markdown **Revisions** give useful **path-prefix browsing** and useful **lexical full-text retrieval** over the representative 14-document corpus from
[#9](https://github.com/david-plugge/agent-memory/issues/9) — and what indexing/ranking behaviour should the POC keep?

The load-bearing case is cross-context discovery. Relations were ruled out of scope, so a `hunga` session working on
"favourite recipes" must reach `stack/drizzle/migration-workflow` using only its own task vocabulary — it will never think
to search for "agent-memory" or "stack". If lexical search cannot do that, the map's premise that "cross-project sharing
rests on author path choice plus full-text search" is what failed.

## Three arms

1. **Weighted `tsvector` + GIN** — the candidate. `setweight` over path segments + title (A), summary (B), body (C),
   queried with `websearch_to_tsquery`, ranked by `ts_rank_cd`.
2. **Unweighted body-only `tsvector`** — the control. Shows whether the weighting is load-bearing or decoration.
3. **Prefix browsing: `LIKE` vs `ltree`** — whether `ltree` + GiST earns its complexity over
   `path LIKE 'stack/drizzle%'` on a `text_pattern_ops` btree.

## Run it

```sh
pnpm db:start          # if postgres isn't already up
pnpm proto:retrieval
```

Everything lives in the `prototype_retrieval_wipe_me` schema on the local dev database and is dropped and reseeded on
every start.

## What is deliberately fake

- **The bodies.** The 14 documents don't exist yet — #12 authors them. These are distilled from real sources in this repo
  (`drizzle.config.ts`, `src/env.ts`, `src/hooks.server.ts`, `src/lib/server/auth.ts`, `Dockerfile`, `CONTEXT.md`, the
  `/wayfinder` skill, and the resolutions of #5 and #6) so the vocabulary and the near-misses are real, but they are
  shorter than real documents would be. Ranking gaps here are a floor, not a measurement.
- **`revision.path`** is denormalised so a generated `tsvector` column can include path segments. A generated column
  cannot read another table. The real schema would use a trigger or a separate search table — that is an implementation
  detail, not part of the question.
- **No Reviews, no Trust Tiers.** `trust` is a plain column here purely so the ranking output shows what a tier-aware
  result page would look like. Deriving tiers is #7's answer and not under test.
