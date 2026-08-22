# Contributing to Pegboard

Thanks for looking. This is a small project maintained in spare time.

## Setup

```bash
npm install
npm run dev        # http://localhost:3001
```

Node 24. No backend, no environment variables, no API keys — the whole app is
static files, and it stays that way.

## Before opening a PR

All four must pass, and the PR template asks you to paste the output:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm test             # vitest run
npm run build        # tsc -b && vite build
```

There is a fifth command, `npm run verify-api`, which calls IKEA's live search
endpoint to check the undocumented field contract we depend on. It is **not**
part of the PR gate — it is allowed to fail for reasons that have nothing to do
with your change, and it runs on its own weekly schedule.

## House rules

These four matter more than style. Everything else is negotiable.

### 1. Every catalog dimension needs a real, published source

`src/data/catalog.ts` is the credibility of the project. If a dimension is a
guess, mark it `// UNVERIFIED` and record how you arrived at it in
`findings.md`. Peg patterns are all flagged `patternEstimated` because IKEA does
not publish peg spacing — do not quietly un-flag one without a measurement.

### 2. Never bundle IKEA's assets

No meshes, no product photography, no copyrighted data. All geometry in this
project is authored procedurally from published dimensions. IKEA's own GLB
models are CORS-locked to their origin anyway, so this is not a limitation
anyone is working around — see `findings.md` F2.

### 3. Nothing in the price chain may throw, and an unknown price is never zero

The resolution chain is override → live → cache → snapshot → unknown. A dead
endpoint must degrade down it, visibly. An item whose price we cannot determine
renders "—" and is excluded from the total; costing it at 0 produces a number
someone would act on and be wrong.

The page makes **no third-party request on load**. Prices come from
`src/data/price-snapshot.json`, which a scheduled workflow keeps current. If you
find yourself adding a fetch that fires on mount, that is the thing to discuss
in an issue first.

### 4. Bump the persist version when you change saved state

`src/state/store.ts` persists to localStorage. If your change alters the stored
shape, bump `version`, add a step to `migrateConfig`, and cover it in
`src/state/store.test.ts`. A saved wall breaking on upgrade is the one failure
the app cannot reproduce for itself, and the user who hits it has already lost
their work.

## Research notes

`findings.md` is where research, probe results, measurements and any
third-party content live. It is append-only in spirit: F-numbered entries are
superseded by later ones rather than edited away, because knowing that we once
believed something wrong is often the useful part.

## Where things are

| Path | What |
|---|---|
| `src/data/catalog.ts` | The curated SKÅDIS catalog — source of truth |
| `src/lib/grid.ts` | Hole lattice maths, parity-aware snapping, occupancy |
| `src/lib/geometry/` | One procedural builder per accessory archetype |
| `src/lib/pricing.ts` | Resolution chain and pack-aware cost model |
| `src/state/store.ts` | Persisted configuration, undo/redo, migrations |
| `findings.md` | Every measurement and probe result, with method |
| `CLAUDE.md` | Architecture and the reference data, in one place |

## Code of conduct

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
