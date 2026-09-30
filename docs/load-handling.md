# Handling Sudden Loads (Cloudflare Workers)

How to keep the site responsive under traffic spikes (enrollment/announcement days, social media links, bot floods). Workers are inherently good at this — the risk points in this repo are **D1 write contention** and **unbounded per-request work**.

**Constraint: everything runs on the Workers free plan.** That means no Cloudflare Queues, 10 ms CPU per request, 100k requests/day, D1 100k row-writes/day, KV 1k writes/day. Mitigations below are chosen to stay inside those caps — the numbers are in `cloudflare-optimization.md`.

## Where this site is vulnerable today

1. **Every redirect writes to D1.** `src/lib/link-shortener.ts` increments `clicks` on each hit. A viral short-link = one D1 write per request — at ~100k redirect/day you'd exhaust the free D1 write cap, and each write also costs request latency.
2. **Officer check queries on every officer page render** (6 pages × 1 query).
3. **Middleware runs on every request** (NextAuth session resolution).
4. **PDF generation (`/api/resources/download`)** is CPU-heavy (166-line handler, `pdf-lib` document build) — on the free plan's 10 ms CPU limit this is the only route that can get killed outright under load, or even on a cold single request.

## Mitigations, cheapest first

### 1. Cache at the edge (do first, biggest win)

- Static pages are already cached via the opennextjs incremental cache (R2/KV — see `cloudflare-optimization.md` issue #1: wire the missing R2 binding or this doesn't actually persist).
- For hot dynamic routes (`/[slug]` redirects), add the **Cache API**: cache the 307 response keyed by slug URL with a short TTL (60–300 s). Expired/missing slugs must stay uncacheable. Even 60 s of edge caching turns a spike into ~1 D1 query/minute instead of one per hit.
- Cloudflare's CDN already absorbs static asset floods for free.

### 2. Move click counting off the request path

Free-plan compatible options, in order of preference:

- **Cron aggregation (simplest, fully free-plan safe)**: redirect handler does INSERT-only into a `click_events` table (no read-modify-write), and a cron trigger (`triggers.crons` in wrangler) aggregates into `links.clicks` every 5–15 min. INSERTs are cheap, the cron does one `UPDATE` per active slug per run. Free plan allows cron triggers.
- **Durable Object + flush**: in-memory per-slug counter in a SQLite-backed DO (available on free), flushing `UPDATE links SET clicks = clicks + ?` every 10–30 s. Works, but every DO request counts against the same 100k/day request cap — only worth it if cron aggregation's write volume is still too high.
- **Minimum viable**: fire the increment with `ctx.waitUntil()` so the redirect response never waits on the write (latency win, but still 1 D1 write per hit — doesn't solve the write cap).
- ~~Cloudflare Queues~~ — **paid-only, off the table on free.**

### 3. Rate limiting

- Layer 1 (free, no code): Cloudflare WAF rate limiting — the free plan includes **one** rate limiting rule; spend it on `/api/*` to stop abusive clients before the Worker runs.
- Layer 2 (in-code): for expensive endpoints (`/api/resources/download`, `/api/link-shortener` POST), use the Workers **Rate Limiting binding** (`ratelimits` in wrangler) — platform feature, no DO boilerplate; verify the binding works under `npm run preview` on free before relying on it:
  ```jsonc
  "ratelimits": [{ "name": "API_RATE", "simple": { "limit": 30, "period": 60 } }]
  ```

### 4. Cheapen the hot path

- Extract `requireOfficer()` (see `modularization.md`) and cache the officer verdict in the session JWT — officer pages stop hitting D1 on every render.
- Narrow the middleware matcher so public pages skip session resolution.
- **PDF route on free plan**: 10 ms CPU/request makes per-request `pdf-lib` generation unsafe. Pre-generate stamped PDFs at build time (add to wrangler `build.command` / CI) into `.open-next/assets` and serve statically; only fall back to on-demand generation + R2 memoization if stamps must be per-user/per-request.

### 5. D1 resilience

- Wrap D1 calls with the documented retry pattern for transient errors (https://developers.cloudflare.com/d1/best-practices/retry-queries/) — retries during spikes matter more than usual.
- `db.batch()` anything doing sequential queries.
- Index `links.expires_at` if the archive job (currently unwired) goes live — a full-table scan on a large `links` table under load is avoidable pain.

### 6. Platform-level safety nets

- **Gradual deployments** (https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/): roll new versions to a percentage of traffic first — catches perf regressions before a full-blown spike hits a bad build.
- **Observability** is already on: use `wrangler tail` and dashboard metrics (CPU per request, errors) to find the real bottleneck before optimizing anything else.
- The free plan's 100k requests/day is the hard ceiling — no code changes that. If a legitimate spike can approach it, upgrading the plan is the only lever; keep the free-plan-compatible design anyway so nothing breaks on the day of the switch.

## Anti-patterns to avoid here

- Don't add an in-Worker memory cache for D1 rows: isolates are ephemeral and per-colo — hit rates are poor and invalidation is a trap. Use the Cache API / incremental cache instead.
- Don't move auth checks client-side only; the edge middleware gate is what keeps `/officers` cheap *and* safe.
- Don't use Cloudflare Queues (paid-only on free plan) anywhere — cron aggregation covers the write side.
- Don't use the KV incremental cache for ISR — 1k KV writes/day on free would silently throttle cache freshness; R2 incremental cache is the free-plan-correct choice (see cloudflare-optimization.md).
