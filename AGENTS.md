# AGENTS.md — ACCESS DLSU Website

The official website of ACCESS DLSU (Association of Computer Engineering Students, De La Salle University). Central hub for events, academic resources, officer directory, and member benefits. Users: members (CpE students), officers (content management/analytics), general public.

**Stack**: Next.js 16 + React 19, TypeScript 6 (7-ready, see `docs/upgrades/`), TailwindCSS v4, Cloudflare Workers (D1 + opennextjs-cloudflare), NextAuth v5 (Google OAuth).

**Single source of truth**: this file. `CLAUDE.md` is a symlink to it. Longer planning docs live in `docs/` (index: `docs/README.md`; session memory: `docs/PROGRESS.md`) — read `docs/PROGRESS.md` when resuming.

## Commands (npm only, Node 24)

```bash
npm install        # no lockfile by design — resolves fresh (versions pinned in package.json)
npm run dev        # Turbopack (default), http://localhost:3000
npm run build      # Turbopack build — does NOT typecheck (Next 16 removed it) and does NOT exercise the Cloudflare runtime
npm run typecheck  # regenerates env.d.ts then tsc --noEmit — run this explicitly, CI-less repo
npm run lint       # bare `eslint`, no --fix
npm run preview    # opennextjs-cloudflare build + preview (use before deploy)
npm run deploy     # opennextjs-cloudflare build + deploy
npm run cf-typegen # regenerates env.d.ts after wrangler.jsonc binding changes (env.d.ts is gitignored, like next-env.d.ts)
```

No test framework, no Prettier config (CONTRIBUTING mentions Prettier; none configured — follow existing style). ESLint is `next/core-web-vitals` + `next/typescript` presets, no custom rules.

## Branches & deployment (repo reality)

- Push to `test` → auto-deploys staging (`wrangler deploy --env staging`, staging.accessdlsu.com).
- Push to `public` → auto-deploys production (accessdlsu.com). Both via `.github/workflows/deploy.yml`.
- `old-test` / `old-public` are archived branches. CONTRIBUTING.md's `dev`/`main` flow is outdated — there is no `dev` or `main`.
- `npm run preview` before any manual `npm run deploy`. Verify on staging (`test`) before promoting to `public`.
- CI env: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (GitHub secrets). No lockfile → CI uses `npm install`, not `npm ci`.

## Env

Copy `.env.example` → `.env.local`: `AUTH_SECRET` (`openssl rand -base64 32`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL=http://localhost:3000`. Production `AUTH_URL`/`AUTH_TRUST_HOST` live in `wrangler.jsonc` (`staging` env too), not `.env`.

## Architecture (what agents get wrong)

- Path alias `@/*` → `./src/*`. Fonts (Poppins 700 brand / Manrope 400–700 UI) load in `src/app/layout.tsx` as CSS vars `--font-poppins` / `--font-manrope` — always use the vars.
- Cloudflare bindings: D1 via `getDB()` from `src/lib/db.ts` (wraps `getCloudflareContext()`; generated binding types are optional, so never destructure `env.DB` directly). Never `process.env.DB`. `initOpenNextCloudflareForDev()` in `next.config.ts` makes this work in dev — don't remove.
- D1 schema: `database/001–004` migrations are authoritative. Tables: `officers` (email-keyed), `links` (`slug`, `target_url`, `clicks`, `expires_at`, `archived`). **`init_db.sql` contradicts the migrations — trust migrations.** Schema changes = manual wrangler D1 migration; code changes alone do nothing.
- Auth (`src/lib/auth.ts`, `src/proxy.ts`): Google OAuth restricted to `@dlsu.edu.ph` in `signIn` callback; proxy gates `/members/*` + `/officers/*` (Next 16 renamed middleware→proxy; nodejs runtime). Matcher skips `api/auth`, `_next/*`, favicon, images. Officer privilege ≠ login: pages verify via D1 `officers` lookup (see `/api/officers/check`); extract to one `requireOfficer()` helper is planned (`docs/modularization.md`).
- Routes: `src/app/{about-us,academics,events,members,officers}/…`, API under `src/app/api/` (auth, link-shortener, officers/check, resources, set-user-info). `/[slug]` = short-link redirect.
- Sitemap: `scripts/generate-sitemap.mjs` runs as wrangler `build.command` — keep it working when routes change. (fallow flags it "unused"; it's not.)
- Deploy target: `.open-next/worker.js` + `.open-next/assets` per `wrangler.jsonc`. Incremental cache = static-assets override (`open-next.config.ts`) — no R2/KV bindings; add them only when the site starts using ISR/revalidation. Staging (`env.staging`) does NOT inherit top-level bindings — every binding (D1, future ones) must be duplicated under `env.staging`.
- Known dead code (`src/worker-scheduled.ts`, `src/lib/auth.config.ts`, `auth-provider.tsx`, `page-transition.tsx`, `components/loading.tsx`) and planned cleanups: `docs/simplification.md`.

## Design system (must match existing UI)

- **Colors**: brand green `#4e8d1f` (hover `#3d7018`, light `#5fa526`, raw gradient `#5e9432→#4c7628`); dark bg `#0a0a0a`, surface `#18181b`; text `#f1f5f9` / `#a1a1aa`.
- **Glass-morphism** (defined in `src/app/globals.css`, ~2.6k lines — don't modify `src/components/ui/` or global classes without reading it): `backdrop-filter: blur() saturate()` + translucent bg + 1.5px light border + 4-layer shadow. Dark default; big `prefers-color-scheme: light` override block restyles everything.
- **Classes**: `.navbar*` (compressed/focus-mode states), `.login-pill`/`.login-expanded`, `.glass-card`, `.course-card`, `.search-bar`, `.category-filter`, `.resource-button`, `.modal-panel`, `.brand-text`.
- **Animation timings**: fast 0.15–0.2s, standard 0.25s, smooth 0.3s, slow 0.4–0.5s; easing `cubic-bezier(0.4, 0, 0.2, 1)`.
- **UI primitives** (`src/components/ui/`, all named-export, glass-styled): Hero, PageHeader, SectionHeader, SectionContainer; Card, FeatureCard, StatCard; SearchInput, FilterButton, FilterGroup; Notification + `useNotification`, LoadingProgress, LoadingOverlay, EmptyState; Button, AuthWarning, Placeholder. Use them for new pages before writing anything custom.
- **Brand**: logo `/logo/access.svg`, page background `/dlsu.png`, dark theme + green accents.

## Conventions

- Files: `PascalCase.tsx` for components, `camelCase` otherwise, `kebab-case` routes. Route is `/officers/` — spelling matters (historic typo `/offcers/`).
- Branch/commit: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Components `"use client"` when interactive; ARIA labels on interactive elements, `aria-hidden` on decorative icons.
- Icon imports from `lucide-react` stay tree-shakeable (`optimizePackageImports` set; note v1 migration pending, `docs/upgrades/`).
- Line endings: LF everywhere (`.gitattributes`). Don't generate `.md` files unless instructed.
- Tooling available: `codegraph` (index in gitignored `.codegraph/`, run `codegraph init -i` if missing) and `fallow` (dead-code/duplication scan; 2 documented false positives: `eslint-config-next`, sitemap script).

## Gotchas

1. **Free plan only**: the site runs on the Workers **free** plan — no Queues, 10 ms CPU/request (watch the `pdf-lib` route), D1 100k writes/day, KV 1k writes/day. Any new binding/route must fit free limits (numbers: `docs/cloudflare-optimization.md`).
2. `npm run build` succeeds ≠ deploy works, and it no longer typechecks — run `npm run typecheck` + `npm run preview` (exercises worker runtime + bindings).
3. Tailwind v4 (`@import "tailwindcss"`, `@tailwindcss/postcss`) — no `tailwind.config.js`; globals.css custom classes can override utilities.
4. NextAuth v5 is beta; API surface can shift on package bumps.
5. React 19 / Next 16: async APIs (params, searchParams are Promises; sync access fully removed) — follow existing page patterns.
6. DB changes need wrangler D1 migration on the real DB — staging (`access_dlsu_db_staging`) and production (`access_dlsu_db`) are separate databases; apply migrations to both.
7. Browserslist: `defaults, Safari >= 14` — keep `-webkit-backdrop-filter` prefixes.
8. npm install-scripts: `allowScripts` in package.json must stay unpinned (`workerd`, `esbuild`, `sharp`, `@tailwindcss/oxide`, `unrs-resolver`) — pinned entries break CI on version drift since there is no lockfile.
9. `npm run lint` flags the new react-hooks v6 rules (`set-state-in-effect`, refs-during-render) — fix patterns, don't disable rules.
