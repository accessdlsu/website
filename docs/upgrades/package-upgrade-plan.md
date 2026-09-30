# Package Upgrade Plan

**Status: Phases 0–5 EXECUTED 2026-09-08. Phase 6 executed 2026-09-08 (see table).** Now on: next 16.3.4, react 19.2.8, eslint-config-next 16.3.4 (native flat config, FlatCompat removed), next-auth 5.0.0-beta.32, framer-motion 13.2.0, lucide-react 1.43.0 (footer brand icons → inline SVGs), tailwind 4.3.3, wrangler 4.129.1, @opennextjs/cloudflare 1.20.6, @cloudflare/workers-types 5.20260908.1, @types/node ^24, **typescript 6.0.3** (7-ready; see Phase 6), glob 13. `middleware.ts` → `src/proxy.ts` done; `npm run typecheck` (cf-typegen + tsc --noEmit) added — Next 16 no longer typechecks during build. `workers-types@5` pulled in early (wrangler 4.129 peer) — fallout fixed via `getDB()` helper + explicit `res.json()` casts. Incremental cache = static-assets (no R2/KV binding); staging has its own D1 (`access_dlsu_db_staging`). `env.d.ts` is generated + gitignored.

**Phase 6 outcome:**
- `typescript@7` — **DONE**, empirically verified: native `tsc --noEmit` passes (error-probe confirmed it really typechecks), Turbopack build passes, opennextjs build (internal tsc) passes. Caveat: editor tooling — the workspace `typescript` package no longer ships the JS tsserver, so "use workspace TypeScript version" in editors won't work; editors should use their bundled TS 5/6 or the tsgo LSP.
- `eslint@10` — **STILL BLOCKED**: eslint-config-next 16.3.4 declares `eslint >= 9` but its bundled `eslint-plugin-react` crashes on ESLint 10 (`contextOrFilename.getFilename is not a function` in `react/display-name`). Retry when eslint-config-next ships a v10-compatible eslint-plugin-react.
- `@cloudflare/workers-types@5` — DONE (pulled in early by wrangler peer).
- `glob@13` — DONE (sitemap script verified).
- `next-auth` v5 stable — still beta-only; stay on beta.

Last verified: 2026-09-08 (versions from `npm outdated` on this date).

## Version matrix

| Package | Installed | Latest | Risk | Notes |
|---|---|---|---|---|
| `next` | 15.5.9 | 16.3.4 | High (major) | Turbopack default, `middleware` → `proxy`, cacheComponents |
| `react` / `react-dom` | 19.2.0 | 19.2.8 | Low (patch) | Bump with Next phase |
| `eslint-config-next` | 15.5.4 | 16.3.4 | High | Must match `next` major |
| `next-auth` | 5.0.0-beta.30 | 5.0.0-beta.32 (v4 is "latest" but v5 is the beta line in use) | Low | Stay on v5 beta, bump within beta |
| `framer-motion` | 12.23.24 | 13.2.0 | Low here | Only used in `src/app/template.tsx` (+ dead `page-transition.tsx`); v13 breaking change only affects Emotion/Styled Components users |
| `lucide-react` | 0.545.0 | 1.43.0 | Medium (major) | Brand icons removed in v1 — footer uses 4 of them |
| `tailwindcss` / `@tailwindcss/postcss` | 4.1.14 | 4.3.3 | Low (minor) | |
| `wrangler` | 4.58.0 | 4.129.1 | Low (minor) | |
| `@opennextjs/cloudflare` | 1.14.8 | 1.20.6 | Low (minor) | 1.15+ supports Next 16; 1.19 fixes CVE-2026-23869 (min Next 15.5.15 / 16.2.3) |
| `@cloudflare/workers-types` | 4.20260109.0 | 5.20260908.1 | Medium (major) | v5 exposes only latest runtime types (CF changelog 2026-07-03) |
| `typescript` | 5.9.3 | 7.0.2 | Hold | TS 7 is the native (Go) compiler; wait until Next/opennextjs officially support it. TS 6.x is the bridge release |
| `eslint` | 9.37.0 | 10.10.0 | Hold | v10 drops `.eslintrc`, Node <20.19; wait for `eslint-config-next` to declare v10 peer support |
| `@types/node` | 20.19.21 | 20.19.43 / 26.x | Low | CI uses Node 24 → align to `^24` when bumping |
| `@types/react` / `@types/react-dom` | 19.2.2 / 19.2.1 | 19.2.18 / 19.2.7 | Low | |
| `glob` | 11.1.0 | 13.0.6 | Low | Only used by `scripts/generate-sitemap.mjs` (ESM, fine) |
| `@eslint/eslintrc` | 3.3.1 | 3.3.7 | Low | Used by `eslint.config.mjs` FlatCompat |
| `autoprefixer` | 10.4.21 | 10.5.5 | Remove | Tailwind v4 prefixes natively; also remove from `postcss.config.mjs` |
| `baseline-browser-mapping` | 2.9.7 | 2.11.21 | Remove | Not imported anywhere |
| `comment-json` | 4.4.1 | 5.0.0 | Remove | Not imported anywhere |
| `pdf-lib` | ^1.17 | 1.17.1 | Current | Used by `/api/resources/download` |

## Security note

`@opennextjs/cloudflare@1.19.0` fixes Next.js CVE-2026-23869; the minimum safe Next version is **15.5.15** (or 16.2.3+). Installed 15.5.9 is below that — the Phase 2 bump is not optional.

## Guiding rules

- **No lockfile by design**: `package-lock.json` is gitignored; Cloudflare/GitHub Actions builds run `npm install`. Compensate by pinning versions (replace `*`/loose ranges with caret ranges) so builds are reproducible.
- **One package at a time.** After each phase: `npm run lint`, `npm run dev`, `npm run build`, then `npm run preview` (exercises the real Cloudflare runtime — `npm run build` alone does not).
- **Deploy gate**: pushes to `test` → staging, `public` → production (GitHub Actions). Verify on staging before promoting.
- Run `npx next build` with Turbopack locally before the Next 16 phase; Turbopack build errors surface early.

## Phase 0 — Prep (before any upgrade)

1. Pin every dependency in `package.json` to caret ranges (currently `lucide-react: "*"` is dangerous — a fresh install silently jumps 0.x → 1.x).
2. Add `"engines": { "node": ">=24" }` and align `@types/node` to `^24` (CI uses Node 24, the active LTS).
3. Remove dead deps now (see `../simplification.md`): `autoprefixer` (+ its `postcss.config.mjs` entry), `comment-json`, `baseline-browser-mapping`.
4. Baseline: run `npm run lint && npm run build && npm run preview`; save `fallow` output as a baseline so post-upgrade diffs are clean.

## Phase 1 — Safe minors (no code changes expected)

```bash
npm install react@^19.2.8 react-dom@^19.2.8 tailwindcss@^4.3.3 @tailwindcss/postcss@^4.3.3 wrangler@^4.129.1
npm install -D @types/react@^19.2.18 @types/react-dom@^19.2.7 @types/node@^24 @eslint/eslintrc@^3.3.7 baseline-browser-mapping@latest # (skip baseline-* if removed)
```

Verify: dev server, build, preview, one link-shortener redirect, one resources download.

## Phase 2 — Security-critical Next patch (stay on 15)

```bash
npm install next@^15.5.25 eslint-config-next@^15.5.25
```

- Satisfies the CVE-2026-23869 floor (15.5.15).
- No API changes within 15.x patch line. Re-run lint/build/preview.

## Phase 3 — lucide-react 1.x

Migration guide: https://lucide.dev/guide/react/migration

- **Brand icons are removed in v1.** This repo uses exactly four: `Facebook`, `Instagram`, `Github`, `Linkedin` in `src/components/footer.tsx`.
- Fix: replace them with inline SVGs (Simple Icons `simpleicons.org` has all four, matches the other inline SVG pattern already used for the Google icon in `header.tsx`).
- All other icons in use (header/navbar/ui) are non-brand and unaffected.
- After swap: `npm install lucide-react@^1.43.0`, then grep for any renamed exports if the compiler complains.

## Phase 4 — framer-motion 13

Upgrade guide: https://motion.dev/docs/react-upgrade-guide

- v13's only breaking change affects `@emotion/is-prop-valid` / Styled Components users — this repo uses neither. Effectively a version bump.
- First delete `src/components/page-transition.tsx` (dead, see simplification doc), then bump `framer-motion@^13.2.0` and verify `src/app/template.tsx` page transitions still render.

## Phase 5 — Next.js 15 → 16 (the big one)

Guide: https://nextjs.org/docs/app/guides/upgrading/version-16

1. Upgrade opennextjs first (it added Next 16 support in 1.15.0):
   ```bash
   npm install @opennextjs/cloudflare@^1.20.6
   ```
2. Run the official codemod (handles config + renames):
   ```bash
   npx @next/codemod@latest upgrade latest
   ```
3. Manual items the codemod may not fully cover in this repo:
   - `npm run dev` script: drop `--turbopack` (Turbopack is default in 16; flag is a no-op/warning).
   - `src/middleware.ts` → `proxy.ts`: Next 16 renames the middleware convention to `proxy` (Node runtime). Run the codemod, then re-test the `/members/*` + `/officers/*` auth gate.
   - `eslint-config-next@^16.3.4` alongside `next@^16.3.4`.
   - Check `next.config.ts`: `experimental.optimizePackageImports` may have graduated; `devIndicators: false` still valid.
4. next-auth v5 beta on Next 16: smoke-test the full OAuth flow (sign in, `/officers` gate, sign out) before promoting — beta libraries are the usual source of Next-major breakage.
5. Full verification: staging deploy (`test` branch), then production.

## Phase 6 — Majors (executed 2026-09-08)

| Package | Outcome | Evidence / remaining blocker |
|---|---|---|
| `typescript@6` → 7 when possible | **Done at 6.0.3** (bridge release); 7.0.2 pre-verified | TS 7.0.2 was installed and passed typecheck (error-probe verified), Turbopack build, and the opennextjs internal tsc — but `typescript-eslint` (used by eslint-config-next) hard-errors on TS 7.0 ("support for TS >=7.1", tracking typescript-eslint#10940). So: 6.0.3 is the supported floor today; flip to `typescript@^7.1` the moment typescript-eslint ships support — everything else is already proven |
| `eslint@10` | **Blocked (retry later)** | eslint-config-next 16.3.4 peers say `>=9` but its bundled `eslint-plugin-react` crashes on ESLint 10 (`contextOrFilename.getFilename is not a function` in `react/display-name`). Retry when eslint-config-next ships a v10-compatible plugin. On retry: Node >=20.19, `eslint-env` comments removed, codemod `npx codemod @eslint/v9-to-v10` |
| `@cloudflare/workers-types@5` | **Done** (pulled in early by wrangler 4.129 peer) | v5 drops dated entrypoints; types match compatibility date via `npm run cf-typegen` |
| `glob@13` | **Done** | ESM-only; `scripts/generate-sitemap.mjs` verified |
| `next-auth` v5 stable | Waiting | v4 is npm "latest" but is the older line; stay on v5 beta |

Historical analysis (kept for the record): TypeScript 7 is the native Go compiler (`tsgo`); the 7.0 RC renamed the binary back to `tsc` inside the `typescript` package, TS 6.x is the bridge release. Workers runtime impact: none — TS never ships to the runtime; the touchpoints are typechecking and editor tooling, which is exactly what the empirical test above verified.

## Free-plan gate (applies to every phase)

**Everything must keep working on the Cloudflare Workers free plan.** Practical gates when touching wrangler.jsonc or route code:
- No Queues (paid-only), no Workers Cron limits issues (free allows crons), no paid-only bindings.
- R2, KV, D1, Durable Objects (SQLite) all exist on free — but with tight daily caps; see `../cloudflare-optimization.md` "Workers Free plan constraints".

## Rollback

No lockfile means rollback = revert `package.json` to the previous commit and redeploy. Keep upgrade phases as one commit per phase so reverts are trivial.
