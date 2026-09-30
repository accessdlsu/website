# UI Design Standardization

Goal: one visual system instead of ~2,600 lines of bespoke CSS in `globals.css` (which `fallow` reports as 11.8% duplicated, 19 clone groups). This is a refactor plan, not a rewrite — do it incrementally per component.

## Source of truth today

All tokens live in `src/app/globals.css` as ad-hoc class styles. Extracted here so new pages stop guessing:

### Color palette

| Token | Value | Use |
|---|---|---|
| Brand primary | `#4e8d1f` | Active dropdown, links hover (light mode) |
| Brand primary raw | `#5e9432` / `rgb(94,148,50)` | Hero buttons, resource buttons, active filters |
| Brand dark | `#4c7628` / `rgb(76,118,40)` | Gradient end of green buttons |
| Brand light | `#5fa526` | Hover accent |
| Background (dark) | `#0a0a0a` | `:root` background |
| Background (light) | `#f8fafc → #eef2f7` gradient | Light-mode body |
| Text primary | `#f1f5f9` / `#0f172a` (light mode) | |
| Text secondary | `#a1a1aa` | Descriptions, muted text |
| Glass surface | `rgba(28,28,28,0.35)` | navbar / pills / cards (dark) |
| Glass surface (light) | `rgba(255,255,255,0.72)` | light-mode override |
| Glass border | `rgba(255,255,255,0.25)` / `rgba(203,213,225,0.85)` light | |

### Glass-morphism recipe (the canonical one)

```css
background: rgba(28, 28, 28, 0.35);
-webkit-backdrop-filter: blur(60px) saturate(200%) brightness(1.1);
backdrop-filter: blur(60px) saturate(200%) brightness(1.1);
border: 1.5px solid rgba(255, 255, 255, 0.25);
box-shadow:
  0 8px 32px rgba(0, 0, 0, 0.5),
  0 2px 8px rgba(0, 0, 0, 0.3),
  inset 0 1px 0 rgba(255, 255, 255, 0.15),
  inset 0 -1px 0 rgba(0, 0, 0, 0.2);
```

Variants in use: `blur(40px) saturate(180%)` (buttons/filters), `blur(20px)` (dropdown items, tooltip), `blur(60px) saturate(200%)` (navbar/pills/cards). Standardize to **two** recipes: `glass-strong` (60px: navbar, pills, cards, dropdown menus) and `glass-soft` (40px: buttons, filters, inputs). The 20px items fold into one of the two.

### Animation timings

| Label | Value | Used for |
|---|---|---|
| Fast | 0.15–0.2s | Opacity fades, small hovers |
| Standard | 0.25s | Most transitions (`cubic-bezier(0.4, 0, 0.2, 1)`) |
| Smooth | 0.3s | Scroll-based show/hide |
| Slow | 0.4–0.5s | Morphing/width animations |

Standard easing: `cubic-bezier(0.4, 0, 0.2, 1)`.

### Fonts

- `--font-poppins` (Poppins 700): brand text only (`.brand-text`, logo).
- `--font-manrope` (Manrope 400/500/600/700): everything else.
- Never use raw `font-family` — always the CSS variables (already loaded in `src/app/layout.tsx`).

## Plan

### Step 1 — Move tokens into Tailwind v4 `@theme`

Tailwind v4 reads design tokens from CSS. In `globals.css`:

```css
@theme {
  --color-brand: #5e9432;
  --color-brand-dark: #4c7628;
  --color-brand-light: #5fa526;
  --glass-bg: rgba(28, 28, 28, 0.35);
  --glass-border: rgba(255, 255, 255, 0.25);
}
```

This makes `bg-brand`, `text-brand` etc. real Tailwind utilities and gives components a reason to stop hardcoding rgba values.

### Step 2 — Deduplicate the glass classes

Create composable utility classes (in `globals.css`, single definition each):

- `.glass-strong` — navbar/pill/card recipe (60px blur)
- `.glass-soft` — button/filter recipe (40px blur)
- `.glass-inset-shadows` — the 4-layer shadow block (repeated 15+ times across the file)

Then refactor existing classes (`.navbar`, `.login-pill`, `.logo-pill`, `.footer`, `.course-card`, `.search-bar`, `.category-filter`, `.resource-button`, `.modal-panel`, `.navbar-dropdown-menu`, …) to `@apply`/compose from these instead of restating the recipe. `fallow`'s clone families 3, 5–27 in `globals.css` (239 lines) are exactly these repeats — this step deletes them.

### Step 3 — Consolidate light-mode overrides

The `@media (prefers-color-scheme: light)` block (~340 lines) restyles every component manually. Once glass recipes are centralized, this collapses to overriding the recipe variables (`--glass-bg`, `--glass-border`, blur values) inside the media query — one place instead of 15 selector groups.

### Step 4 — Standard page shell

Every page should be: `<main className="pt-32 pb-20 px-6 max-w-7xl mx-auto">` + `PageHeader` + content. That main className string is copy-pasted on nearly every page. Turn it into `SectionContainer` (already exists in `src/components/ui/section-container`) and use it everywhere; `page-header` has fan-in 18 — follow that lead.

Rules for new pages:
- Use `PageHeader` + `SectionContainer` + the `ui/` primitives; no bespoke headers.
- Icons: `lucide-react`, sized via `className="w-4 h-4"` … `w-7 h-7` (established convention).
- Interactive elements need ARIA labels (existing pattern: `aria-hidden` on decorative icons, `aria-label` on icon-only buttons).
- Never add `backdrop-filter` inline in a component — use a glass class.

### Step 5 — Component-class responsibility split

Current split is inconsistent: some components style via `globals.css` classes (`.login-pill`, `.navbar`), others via Tailwind utilities. Going forward:

- `src/components/ui/*` → Tailwind utilities + the two glass classes; no component-specific CSS blocks.
- `globals.css` keeps only: tokens, glass recipes, true global styles (body, scrollbar), and the legacy classes until each is migrated.

### Verification

- Visual diff every page in dark + light mode after each step (dev server, compare against prod screenshots).
- `fallow` re-run: `globals.css` clone families should shrink to ~0.
- Browserslist floor is `defaults, Safari >= 14` — `backdrop-filter` needs the `-webkit-` prefix everywhere (the codebase already dual-writes it; keep that).
