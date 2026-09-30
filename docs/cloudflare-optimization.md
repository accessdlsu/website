# Cloudflare Workers Code Optimization (this repo)

Guide for optimizing how this website uses Cloudflare Workers, D1, and opennextjs-cloudflare. Read alongside `load-handling.md` (spike/traffic handling).

## Workers Free plan constraints (hard requirement for this repo)

Everything must work on the **free plan**. The numbers that actually bind this codebase:

| Limit (free) | Value | Repo impact |
|---|---|---|
| Requests | 100k/day | Fine for an org site; monitor on announcement days |
| **CPU time** | **10 ms/request** | **Biggest free-plan risk**: `/api/resources/download` builds PDFs with `pdf-lib` — document generation typically blows past 10 ms CPU. Pre-generate PDFs at build time (wrangler `build.command` or CI step) into `.open-next/assets` and serve as static files; the route then only streams bytes. Fallback: generate-once-cache-in-R2 and accept the first-request cost |
| D1 rows written | 100k/day | Click counting (`UPDATE ... clicks + 1` per redirect) burns writes 1:1 with traffic — batch (see load-handling.md) |
| D1 rows read | 5M/day | Comfortable; prepared statements + indexes already limit row scans |
| KV writes | **1k/day** | **Do not use the KV incremental cache** — ISR revalidation writes would exhaust it and silently degrade cache freshness. This is the decisive reason to wire the **R2** incremental cache (R2 free: 10 GB, Class A writes ~1M/month, Class B reads 10M/month) |
| R2 | 10 GB storage | Incremental cache is tiny; fine |
| Subrequests | 50/request | All routes use 1–3; fine |
| Simultaneous connections | 6 | D1 batch() also helps here |
| Cron triggers | available (few) | The unwired archive job is feasible on free when wired |
| Durable Objects | available (SQLite-backed) | Usable for click batching, but each DO request counts against the 100k/day request cap — prefer cron aggregation unless traffic demands it |
| Queues | **paid only** | Off the table. Use cron batching instead |
| Smart Placement | n/a | Not needed; D1 is the only "origin" |
| next/image optimizer | needs `cloudflare:images` binding | Verify profile-picture (`lh3.googleusercontent.com`) optimization path works in `npm run preview`; if the optimizer errors on free, set `images.unoptimized: true` — logo/profile pics don't need dynamic resizing |

Enforcement habit: after any wrangler.jsonc or route change, `npm run preview` (which runs the real runtime locally with free-plan-shaped bindings) and check the dashboard's free-tier metrics the day after deploy.

## Current architecture

- Next.js 15 App Router compiled by `@opennextjs/cloudflare` into `.open-next/worker.js`, deployed via wrangler (`wrangler.jsonc`).
- D1 binding `DB` (`access_dlsu_db`) accessed through `await getCloudflareContext()` → `env.DB`.
- `open-next.config.ts` wires the **R2 incremental cache** override.
- `scripts/generate-sitemap.mjs` runs as the wrangler `build.command`.
- `initOpenNextCloudflareForDev()` in `next.config.ts` provides bindings locally — never remove.

## Issues found in this repo (fix these first)

### 1. Incremental cache — RESOLVED 2026-09-08 (final: no external cache needed)

`open-next.config.ts` now uses the **static-assets incremental cache** (`@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache`) — read-only, served from the existing `ASSETS` binding, zero extra bindings. Correct for this site because every page is prerendered static (no `use cache`, no ISR revalidation).

History: an R2 override was tried first (`NEXT_INC_CACHE_R2_BUCKET`), but opennextjs requires the binding at deploy for R2 — and since wrangler does **not** inherit top-level bindings into named environments, `env.staging` would have needed its own copy plus a real bucket. R2/KV caches only pay off once the site actually uses ISR/revalidation; revisit then (see `load-handling.md` for the free-plan constraints at that point — KV is never viable, R2 is).

### 2. D1 query patterns

Current queries are all one-shot `.prepare().bind().first()/run()` — correct shape, but:

- **Click counting is a write-per-redirect** (`src/lib/link-shortener.ts` UPDATE on every hit). Under load this serializes on D1 writes. Fix in `load-handling.md` (batch via Durable Object or defer increments).
- **Six officers pages each run the same officer lookup** — extract one `requireOfficer()` helper (see `modularization.md`) and add an index: `officers.email` already has `idx_officers_email`. Good.
- **Reuse prepared statements per request path**: in route handlers that loop (e.g. resource listing), use `db.batch([...])` instead of sequential awaits. D1 `batch()` sends one round trip.

### 3. Auth check on every page render

`authorized` middleware + per-page `auth()` + per-page D1 officer check = 3 layers. Fine for correctness, but the officer DB hit repeats on every officer-page render. Options:
- Cache officer status in the session JWT (add `isOfficer` claim at sign-in time) — removes the D1 hit from page renders entirely. Invalidate by short JWT lifetime or a version claim.
- Keep server-side check for mutations (never trust the JWT alone for admin actions).

### 4. Static assets & headers

- All static UI is served from Workers Static Assets (`.open-next/assets`) — this is the fast path, keep pages mostly static where possible (currently true: most pages are static/ISR, only API routes + `[slug]` are dynamic).
- Long-lived immutable headers are automatic for hashed assets; if adding custom headers, use `_headers` in `public/` rather than Worker middleware for cacheable routes (middleware currently runs on everything — see next item).

### 5. Middleware runs on all routes

`src/middleware.ts` matcher excludes static files but still runs the NextAuth middleware on every HTML/API route including public marketing pages that don't need it. NextAuth edge middleware is cheap but not free at scale. Options:
- Narrow the matcher to `/members/:path*`, `/officers/:path*`, `/api/:path*` (auth check), leaving public pages untouched.
- After the Next 16 upgrade this file becomes `proxy.ts` — re-evaluate then.

### 6. Known dead/wrong Workers code

- `src/worker-scheduled.ts` exports a `scheduled` handler but **no cron trigger exists** in `wrangler.jsonc` and opennextjs doesn't consume it. Either wire it (`"triggers": { "crons": ["0 3 * * *"] }` in wrangler + a separate entrypoint — note: opennextjs-cloudflare worker doesn't support `scheduled` directly; a standalone Worker or Cloudflare Workflow is the normal route) or delete the file (see simplification doc). Its SQL is correct against the migration schema (`archived` column) but contradicts the stale `init_db.sql`.
- `database/init_db.sql` schema (`short_code`/`original_url`/`is_archived`) **does not match** the real migration schema (003/004: `slug`/`target_url`/`archived`). Code follows migrations. Fix `init_db.sql` before anyone initializes a fresh DB from it.

## General Workers optimization reference (Cloudflare docs)

- **Best practices**: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/ — stream responses, avoid blocking the event loop, minimize per-request work, use bindings instead of HTTP fetches to self.
- **Limits**: https://developers.cloudflare.com/workers/platform/limits/ — CPU time (free: 10 ms/request, paid: 30 s), 128 MB isolate memory, 50 subrequests/request (free) / 1000 (paid), 6 simultaneous open connections. This site's routes are far below these, but the resources download route (PDF generation with `pdf-lib`) is the heaviest CPU consumer — keep an eye on CPU limits there.
- **Smart Placement**: https://developers.cloudflare.com/workers/configuration/placement/ — runs the Worker near the origin data. Only relevant if D1 moves away from the current single location; D1 placement follows the Worker config. Check `/d1/configuration/data-location/`.
- **Observability**: already enabled (`wrangler.jsonc` `observability.logs`). Use `wrangler tail` + the dashboard when investigating latency.
- **Compatibility date**: currently `2025-09-01`. Bump periodically to pick up runtime perf improvements; test with `npm run preview` first.

## D1-specific (docs: https://developers.cloudflare.com/d1/best-practices/)

- Always parameterized prepared statements (already done everywhere).
- `db.batch()` for multi-statement work — one round trip.
- Index every column used in WHERE/ORDER BY: `links.slug`, `links.short_code`(stale file), `officers.email` covered; `links.expires_at` is scanned by the (unwired) archive query — add an index if that job goes live.
- Retry on transient D1 errors: https://developers.cloudflare.com/d1/best-practices/retry-queries/
- Read replication (beta) exists for globally-distributed reads — overkill for this site's traffic today.

## Build/deploy optimization

- GitHub Actions currently does `npm ci` → after the lockfile removal decision, `npm install` (see deploy.yml). Cache `node_modules` via `actions/setup-node` `cache: npm` only works with a lockfile — use `actions/cache` keyed on `package.json` hash instead.
- Turbopack (Next 16) cuts build times significantly; consider `turbopack` filesystem caching in CI once on Next 16.
- wrangler supports build caching for Workers Builds; not applicable while deploying via GitHub Actions.
