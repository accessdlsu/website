# Docs Index

All project documentation lives here. Start with `PROGRESS.md` when resuming work.

| File | Purpose |
|------|---------|
| `PROGRESS.md` | Current progress, decisions made, what to do next. Read this first. |
| `upgrades/package-upgrade-plan.md` | Full dependency upgrade plan: version matrix, migration guides, ordered phases. |
| `cloudflare-optimization.md` | Cloudflare Workers + D1 code optimization guide for this repo. |
| `load-handling.md` | Handling sudden traffic spikes on Cloudflare Workers. |
| `ui-standardization.md` | Standardizing the UI design system (tokens, glass-morphism, page shells). |
| `modularization.md` | Modularizing code: extracting shared logic, splitting hotspot files. |
| `simplification.md` | Dead code, unused deps, and over-engineered code to simplify (fallow findings). |

Tooling that indexes/analyzes this repo (outputs are gitignored):
- `codegraph` — code knowledge graph, stored in `.codegraph/`
- `fallow` — dead code / duplication / complexity analyzer, cached in `.fallow/`

Run `fallow` (no args) for a full report; `codegraph explore "<query>"` for code questions.
