# Modularization & Code Manageability

Evidence from `fallow` (2026-09-08): 856 duplicated lines (11.8%) across 15 files; 2 critical complexity hotspots. This doc maps each finding to a concrete extraction.

## Priority 1 — Officers page guard (26 lines × 6 pages)

`src/app/officers/{analytics,database,events,link-shortener,members,resources}/page.tsx` all repeat:

```tsx
const session = await auth();
if (!session?.user?.email) redirect("/");
const { env } = await getCloudflareContext();
const result = await DB.prepare("SELECT id, name, position FROM officers WHERE email = ?").bind(session.user.email).first();
if (!result) redirect("/");
```

**Extract** to `src/lib/officer-auth.ts`:

```ts
export async function requireOfficer(): Promise<{ id: number; name: string; position: string | null; email: string }> {
  const session = await auth();
  if (!session?.user?.email) redirect("/");
  const { env } = await getCloudflareContext();
  const officer = await env.DB.prepare("SELECT id, name, position FROM officers WHERE email = ?").bind(session.user.email).first();
  if (!officer) redirect("/");
  return officer;
}
```

(`redirect()` throws, so the return makes types work naturally.) Each page becomes 3 lines. Saves ~130 lines and, more importantly, means the auth flow exists in exactly one place.

## Priority 2 — Header split (607-LOC file, `HeaderContent` cognitive complexity 41)

`src/components/header.tsx` contains five distinct concerns. Split into:

| New file | Contents |
|---|---|
| `src/lib/nav-config.ts` | `NAV_CONFIG` (pure data, 90 lines) |
| `src/components/header/use-scroll-behavior.ts` | `handleScroll` effect + `isVisible`/`isCompressed`/`suppressCompressTransition` state (the 60-line scroll effect with its timing hacks) |
| `src/components/header/use-officer-status.ts` | `/api/officers/check` fetch effect |
| `src/components/header/login-pill.tsx` | The login/profile pill (lines ~408–580) |
| `src/components/header/auth-error.tsx` | `AuthErrorHandler` + the error notification div |

`HeaderContent` becomes a ~60-line composition. Keep `header.tsx` as the public entry so imports don't change.

## Priority 3 — Link-shortener redirect dedup

`src/app/[slug]/route.ts` and `src/app/api/link-shortener/[slug]/route.ts` duplicate 24 lines of redirect handling around `getRedirectTarget`. `src/lib/link-shortener.ts` already returns a structured `RedirectResult` — move the response-building (status codes, caching headers) into one shared helper there, e.g. `redirectResponse(result: RedirectResult): Response`, and have both routes call it. Decide whether the `/api/link-shortener/[slug]` API variant is even needed (the root `[slug]` route serves end users; the API one may be legacy) — if unused, delete instead.

Also: `getRedirectTarget` queries `archived`/`slug`/`target_url` — matches migration schema (003/004), not the stale `database/init_db.sql`. Fix the SQL file (see simplification doc), not this code.

## Priority 4 — Resources API duplication (71 lines × 2 files)

`src/app/api/resources/route.ts` and `src/app/api/resources/download/route.ts` share three clone families:

1. `str2ab` (duplicated verbatim, 2 files) → `src/lib/resources/pdf.ts`
2. PDF metadata/stamping helpers (43 lines) → same file
3. Auth/session + D1 access boilerplate (26 lines) → same file or a `requireOfficer` reuse from Priority 1

Additionally `download/route.ts`'s `GET` is 166 lines / cyclomatic 27 — split into `buildCertificatePdf()`, `resolveResource()`, `respondWithPdf()` units in the same folder.

## Priority 5 — Resources page (487 lines, cognitive 28)

`src/app/academics/resources/page.tsx` mixes: file fetching, `categorizeFile`/`getFileTypeCategory` heuristics (12 + 9 cyclomatic), filter state, and rendering.

- Move categorization to `src/lib/resources/categories.ts` (pure functions — easy to reason about and to test later).
- Extract the file-list rendering into `src/app/academics/resources/file-list.tsx`.
- The download-progress block duplicates `src/components/ui/loading-overlay` (fallow family 2) — use the UI primitive instead.

## Priority 6 — Small shared-state cleanup

- `src/app/api/link-shortener/archive/route.ts` duplicates the archive SQL in `src/worker-scheduled.ts` (fallow family 3) — the worker file is unwired; if the cron is dropped, fold the "archive expired links" query into `src/lib/link-shortener.ts` as `archiveExpiredLinks()` and have the API route call it.
- `framer-motion` only exists for `template.tsx` + the dead `page-transition.tsx`; after deleting the latter, evaluate whether `template.tsx` needs the dependency at all.

## Target shape

```
src/
├── lib/
│   ├── auth.ts              (exists)
│   ├── officer-auth.ts      (new — requireOfficer)
│   ├── link-shortener.ts    (exists — + redirectResponse, archiveExpiredLinks)
│   ├── nav-config.ts        (new — NAV_CONFIG)
│   └── resources/           (new — pdf.ts, categories.ts)
├── components/
│   └── header/              (new — split of header.tsx)
└── app/ ...                 (pages shrink to composition)
```

## Order & verification

Work top-down (P1 → P6); each item is independently shippable. After each:

1. `npm run lint`
2. Manual pass of the affected routes (officer pages, link shortener, resources)
3. `fallow` re-run — the corresponding clone families must disappear
4. `npm run preview` before any deploy to staging
