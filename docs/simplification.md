# Simplification — Dead Code, Unused Deps, Over-Engineering

Findings from `fallow` full scan (2026-09-08): 30 dead-code issues, 4 unused devDependencies, 25 high-complexity functions. This doc is the actionable list. Run `fallow` for current numbers; `fallow dead-code --trace <file>:<export>` to double-check anything before deleting.

## Delete outright (verified unused)

| File | Evidence | Note |
|---|---|---|
| `src/lib/auth.config.ts` | 100% dead exports | Older copy of `auth.ts` — missing the `/officers` gate and the `hd: dlsu.edu.ph` param. Superseded; delete, don't merge |
| `src/components/auth-provider.tsx` | 0 imports | `layout.tsx` uses `SessionProvider` directly |
| `src/components/page-transition.tsx` | 0 imports | Deletes one of two `framer-motion` call sites |
| `src/components/loading.tsx` | 0 imports | `src/app/loading.tsx` (used by Next) is a different file — don't confuse them |
| `src/worker-scheduled.ts` | Not wired: no `triggers.crons` in wrangler.jsonc, not consumed by opennextjs | Either wire a real cron (see cloudflare-optimization.md) or delete; currently it only rots. Its SQL logic is duplicated in the archive API route anyway |

### Exports to trim (keep the named export, drop the dead one)

Every `src/components/ui/*` component exports both a named export and a `default` — pages consistently use named imports, so all 16 `default` exports are dead. Pick one convention and enforce it: **named exports only** for `ui/` (matches all real usage). Also drop:

- `useNotification` re-export + `NotificationState` type in `src/components/ui/notification/` (dead; only the hook file's own export is used)
- `src/lib/auth.ts`: `signIn`/`signOut` exports (client components import them from `next-auth/react` directly)
- `src/components/ui/filter-button/index.tsx`: `FilterButton` named export flagged — check whether consumers import default or named here and normalize (this is the reverse case)

## Remove devDependencies

| Dep | Why safe to remove |
|---|---|
| `autoprefixer` | Not imported in code, and redundant: Tailwind v4's `@tailwindcss/postcss` handles vendor prefixing. Also remove it from `postcss.config.mjs` (it IS referenced there — that's the only wiring) |
| `comment-json` | Zero imports anywhere |
| `baseline-browser-mapping` | Zero imports; it's pulled transitively by Tailwind tooling when needed |

**Keep despite fallow flags:**
- `eslint-config-next` — false positive; consumed as a *string* preset through `FlatCompat` in `eslint.config.mjs`.
- `scripts/generate-sitemap.mjs` — false positive as "unused file"; it runs as wrangler's `build.command` in `wrangler.jsonc`.

## Fix stale/wrong artifacts

- `database/init_db.sql` defines `links(short_code, original_url, is_archived, icon)`; the real schema (migrations 003/004) is `links(slug, target_url, archived, expires_at)` and all code matches migrations. Rewrite `init_db.sql` to match the migration schema or a fresh-DB setup breaks the link shortener.
- `.env.example`/docs mention R2 storage — no R2 binding exists in `wrangler.jsonc`; the only R2 relevance is the (unbound) opennextjs incremental cache. See cloudflare-optimization.md.

## Over-engineering to simplify (in priority order)

1. **`src/app/api/resources/download/route.ts` GET** — 166 lines, cyclomatic 27 (critical). Split per `modularization.md` P4; consider caching generated PDFs in R2 instead of regenerating per download (also a load-handling win).
2. **`src/components/header.tsx`** — 607 lines, cognitive 41. Split per `modularization.md` P2. The `suppressCompressTransition` 80 ms `setTimeout` hack exists to work around a CSS transition race — once split out, try replacing with a `data-state` attribute + one CSS rule before keeping JS timing logic.
3. **`hasActiveDropdown` useMemo** (header.tsx) — memoizing `activeDropdown !== null` saves nothing and adds noise. Inline it.
4. **Profile-image `onError` DOM manipulation** (header.tsx lines ~434–440) — directly mutating `nextElementSibling` styles fights React. Swap to a tiny `useState(hasImageError)` render toggle.
5. **`academics/resources/page.tsx`** — 487 lines with two heuristic functions (`categorizeFile` cyclomatic 12, `getFileTypeCategory` 9) that are pure data mapping: move to `src/lib/resources/categories.ts` and reduce to a lookup table instead of if-chains.
6. **`globals.css`** — 19 clone groups / 239 duplicated lines and commented-out leftovers (e.g. `.navbar.header-visible` empty rule blocks ~lines 212–218). Follow `ui-standardization.md` for the dedupe plan; the empty/commented blocks can be deleted immediately.
7. **`getRedirectTarget`'s inline expire-and-archive side effect** — a SELECT that writes is surprising. Extract the expiry check into the shared `archiveExpiredLinks()` (modularization.md P6) or make it explicit and documented.

## What NOT to touch

- `src/components/ui/*` primitives are consumed by 18+ pages (`page-header` fan-in 18) — changing their props is high blast radius. The named/default export normalization is the only touch they need now.
- The auth stack (`auth.ts`, `middleware.ts`) is correct and minimal; the duplication with `auth.config.ts` resolves by deletion, not refactor.

## Verification after deletion pass

```bash
npm run lint && npm run build && npm run preview
fallow          # dead files/exports should drop to ~0 (expect the 2 documented false positives)
```
