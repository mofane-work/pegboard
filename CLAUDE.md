# CLAUDE.md for Pegboard

Guidance for Claude Code when working in this repository.

## What this is

A minimalistic, **fully static** web app for planning an IKEA SKÅDIS pegboard wall:
pick a board → see it in 3D → drag SKÅDIS accessories onto real peg holes → read the UI
in your language → pull live IKEA prices → total the cost with per-item checkboxes.

The checkbox detail matters: a user who already owns some parts should be able to price
**only the upgrade**, not the whole wall. That is a core requirement, not a nicety.

## Working agreement

- **Main thread (Opus) handles**: architecture, data modelling, the grid/snapping algorithm,
  pricing resolution logic, catalog curation decisions, and anything defining project direction.
- **Delegate to subagents with `model: sonnet`** (or `haiku` when truly trivial): scaffolding,
  boilerplate, repetitive edits, dependency wrangling, mechanical refactors, test fixtures.
- Subagents start cold — give them self-contained prompts with explicit verification steps
  and require them to paste real command output before claiming success.
  
## Hard constraints

- **No backend.** This ships as static files. If something seems to need a server, it doesn't —
  use the fallback chain instead.
- **Never bundle or hotlink IKEA's 3D models, images-as-assets, or copyrighted meshes.**
  All geometry is authored procedurally by us.
- **Never let a failed price fetch break the app.** Degrade down the chain, show the state honestly.
- **Never count an unknown price as 0** in a total. Show "—" and prompt for input.
- `.claude/` holds a skill install — don't modify it.
- **Exactly one thing fetches on page load, and it is the visit counter.** counter.dev's
  tracker (`lib/analytics.ts`) is the single sanctioned mount-time third-party request —
  added deliberately, documented in findings **F27**, and gated on a configured token *and*
  the visitor not having opted out. Everything else still holds: no cookies, no other
  third-party scripts, no embeds (the Buy Me a Coffee widget included), and prices still
  fetch only on the user's button press.
- **The Help panel's Privacy section is a promise, in three languages, and it must track the
  build.** `help.pv1` describes a build that counts; `help.pv1off` describes one that does
  not; `Help.tsx` picks between them from `analyticsConfigured()`. A fork with no token must
  keep seeing the "no analytics" wording. Adding anything that reports more than a visit
  means rewriting those strings in en/ja/zh-Hant *first*.
- **The counter.dev token is never hardcoded.** `VITE_COUNTER_DEV_ID` is its only source,
  set at build time by `deploy-pages.yml` from the `COUNTER_DEV_ID` repository variable.
  Forks don't inherit repo variables, so a fork ships unconfigured and cannot report its
  visitors into this project's account (findings **F27g**). Do not add a fallback constant
  back to `analytics.ts` — `analytics.test.ts` asserts the unset build is unconfigured.
- **The analytics opt-out is not optional and does not live in the store.** It is what the
  UK statistical-purposes and CNIL audience-measurement exemptions require, and it is kept
  under its own localStorage key so no migration, share link or `applyShared` can reset a
  privacy choice.

## Verified reference data

Probed live on 2026-08-18. Full detail and method in `findings.md`.

### Price API (works, CORS-open)

```
https://sik.search.blue.cdtapps.com/{country}/{lang}/search-result-page
  ?types=PRODUCT&q=skadis&size=100&c=sr&v=20210322
```

Returns `application/json` with **`access-control-allow-origin: *`** — callable from the browser,
no key, no proxy. Fields we rely on: `id`, `name`, `typeName` (localized), `salesPrice.numeral`,
`salesPrice.currencyCode`, `mainImageUrl`, `pipUrl`, `availability`.

Gotchas, all confirmed by probe:
- **Item numbers differ per market.** White 76×56 board = `10321618` (US) but `90321619` (JP).
  → Catalog is keyed on internal slugs; item numbers live in a per-market map.
- **Number lookup fails in non-Latin locales** — `q=10321618` returns nothing on `jp/ja`.
  → Always fetch the whole series once per market (`q=skadis&size=100`) and match locally.
- **Results contain noise** (ALEX, SUNNERSTA, VATTENKAR, FLÖNSA…).
  → Filter on `name` starting with `SKÅDIS`, intersected with the curated allow-list.
- Undocumented endpoint, ToS grey area → treat as best-effort, always have the fallback.

### IKEA's own 3D models are unusable

PIP pages embed GLBs at `web-api.ikea.com/dimma/assets/…glb?cn=pip`. Probed: `403` without the
`?cn=pip` param; `200` with it, but **`access-control-allow-origin: https://www.ikea.com`** —
hard-locked to IKEA's origin. Also ~3.1 MB each, copyrighted, and carrying no peg-anchor data.
**Do not spend time trying to make these work.** We build geometry ourselves.

### SKÅDIS geometry constants

- Slot pitch **40 mm** on both axes.
- Slots are **5 × 15 mm vertical ovals**.
- Board thickness **≈4.6 mm** (product listing says 2 cm including mounting).
- Board sizes: **36×56, 56×56, 76×56 cm**, plus a free-standing 56×36.
- **Edge margin = 20 mm**, half the pitch. Measured off IKEA product photography —
  see `findings.md` **F8**, which supersedes the earlier F7 derivation.

```
Lattice A (wide rows):   x = 20 + 40i,  y = 40 + 40j
Lattice B (narrow rows): x = 40 + 40i,  y = 20 + 40j     (B = A + (20, −20))
```

The offset is diagonal in *opposite* senses per axis. Top and bottom rows are always
**B** rows, 20 mm from the edge; A rows are inset 40 mm vertically but 20 mm
horizontally. **The pattern is not symmetric under 90° rotation.**

| Board | Lattice A | Lattice B | Total slots | Rows from top |
|---|---|---|---|---|
| 36×56 | 9 × 13 | 8 × 14 | 229 | 8, 9, 8, 9… |
| 56×56 | 14 × 13 | 13 × 14 | 364 | 13, 14, 13… |
| 76×56 | 19 × 13 | 18 × 14 | 499 | 18, 19, 18… |

⚠️ An earlier revision used `B = A + (20, +20)`. It was self-consistent, matched every
board width with zero remainder, and was **wrong** — it puts 9 slots on the first row of
a 36×56 board where the real product has 8. Do not re-derive this from dimensions; the
photograph is the authority.

**Parity is load-bearing.** An accessory with pegs on 40 mm centres mounts on holes of a
*single* lattice — A and B holes cannot be mixed for one accessory. Every hole must carry its
lattice tag, and the snapper must filter by it. This is what "parity-aware snapping" means.

**Board orientation** (findings F24). A wall board can hang a quarter turn round —
36×56 read as 56×36. Modelled as `PlacedBoard.rotated`, which swaps the board's dimensions
**and exchanges the two lattice origins**:

```
rotated:  A origin (40, 20),  B origin (20, 40)      # upright is A (20,40), B (40,20)
```

Counter-intuitively this moves **no slot** — `A ∪ B` is symmetric under exchanging the
origins, so a turned panel's holes sit exactly where a board of those dimensions would.
What it changes is *which holes share a lattice*, which is what multi-peg accessories and
the custom-part A/B lock depend on. Do not "simplify" this to a plain dimension swap: that
tags a physically different set of holes as lattice A. One boolean is enough — the field is
180°-symmetric, so clockwise and anticlockwise are the same thing.

Rotating **clears that board's placements**, like resizing does, and is undoable.
`BoardItem.rotatable` is false for the free-standing board (it stands on its bottom edge).
Turned slots are drawn horizontal, in the 3D view and on the print sheet; standard SKÅDIS
accessories cannot actually hang in those, which is noted in Help rather than blocked.

**Placement rules** (findings F9, F10):
- Snap by the accessory's **body centre**, never its first peg — anchoring on the first
  peg makes wide items unplaceable anywhere a user would naturally aim.
- The only hard constraint is that **every peg lands on a real slot**. The body may
  overhang a board edge: that is physical, and a boundary-mounted hook is a real use case.
- Accessories rotate in quarter turns; `rotatePattern` transforms peg offsets and the
  body rect together.
  - **Peg spans follow the width, and photographs are the authority.** Hooks land on 40 mm
  multiples, so where a body's width IS an exact multiple of 40 the hooks sit at its *ends*
  and the span is `w / 40` pitches with zero overhang; where it is not, the span is the
  largest multiple that fits and the remainder overhangs. The display shelf was inset one
  pitch too far until it was measured off IKEA's own straight-on photography — same class of
  error as the F7→F8 lattice correction. See findings **F35**; `shelf` at 280 mm is the
  open case (**F35d**) and is deliberately left alone until there is a photo that settles it.

### Traditional Chinese has no live price source

IKEA Taiwan (`ikea.com.tw`) and Hong Kong are a different franchisee on a separate platform.
Every zh-Hant locale code (`tw/zh`, `hk/zh`, `hk/en`, `mo/zh`, `tw/zh_TW`) returns **404** on the
API above. Their search runs on Algolia behind a key bundled in their JS — **we do not build on
that.** Resolved by decoupling language from market plus user price overrides (see below).

## Decisions

| Decision | Choice |
|---|---|
| Stack | Vite + React 19 + TypeScript (plain HTML is insufficient) |
| 3D | `@react-three/fiber` + `@react-three/drei`, procedural low-poly geometry at true mm dimensions |
| State | `zustand` |
| Styling | Three global stylesheets (`tokens.css`, `global.css`, `app.css`) with BEM classes + CSS custom properties — no framework, no CSS Modules |
| i18n | `react-i18next`; **en / ja / zh-Hant** |
| Markets | **US/en** and **JP/ja** live; plus a **Custom** market with user-entered prices |
| Language ≠ market | Two independent selectors. Changing language must NOT change prices. |
| Price overrides | Every row editable in every market; persisted. Covers zh-Hant, second-hand buys, and any market we can't see. |
| Catalog | Official SKÅDIS accessories only (~30 SKUs) |
| Board orientation | Per-board `rotated` flag; lattice origins swap, dimensions swap |

## Architecture

```
src/
  data/
    catalog.ts            # curated SKÅDIS catalog — source of truth
    customParts.ts        # user-defined placeholders → synthetic AccessoryItem
    price-snapshot.json   # the prices the app ships with + capture date
    support.ts            # optional BMC link — a plain URL, never the widget
  lib/
    analytics.ts          # counter.dev tracker + opt-out — the ONLY load-time fetch
    grid.ts               # hole lattice math, snapping, occupancy
    geometry/             # one builder per archetype
    pricing.ts            # resolution chain + pack-aware cost model
    marketPrices.ts       # on-request live fetch + localStorage cache
    priceSnapshot.ts      # snapshot merge + the no-shrink guard
    boot.ts               # dismisses the pre-React splash in index.html
  state/store.ts          # zustand: config, market, language, overrides
  components/             # Scene, Board, AccessoryMesh, Palette, CostTable, Toolbar,
                          #   Help, CustomPartForm, ShoppingList, PrintSheet
  state/drag.ts           # drag state, separate from the persisted store
  i18n/                   # en.json, ja.json, zh-Hant.json
public/
  favicon.svg             # the boot splash's SKÅDIS mark; hexes mirrored by hand
scripts/
  refresh-prices.ts       # regenerate price-snapshot.json
  refresh-visit-count.ts  # read counter.dev over SSE → .github/badges/visits.json
  verify-api.ts           # contract check against the live endpoint
```

### Catalog model

Keyed by **stable internal slug**, never by item number (they differ per market):

`CatalogItem` is a **discriminated union on `kind`**. Peg data is not spread across the item;
it lives in a single `PegPattern` from `lib/grid.ts`.

```ts
type CatalogItem = BoardItem | AccessoryItem

interface BaseItem {
  key: string;                                 // 'hook-large', 'board-76x56-white'
  itemNos: Partial<Record<MarketId, string>>;  // { us: '50335618', jp: '30321617' }
  packQty: number;                             // units per pack — often > 1
  kitKey?: string;                             // sold only inside another item's pack
  names: Record<LanguageId, string>;           // total: every language or it renders blank
}

interface AccessoryItem extends BaseItem {
  kind: 'accessory';
  archetype: Archetype;                        // dispatches buildAccessoryParts()
  dims: { w: number; d: number; h: number };   // millimetres — note the w/d/h order
  placeable: boolean;
  pattern?: PegPattern;                        // required when placeable
  patternEstimated: boolean;
  dimsVerified: boolean;
}

interface PegPattern {                         // from lib/grid.ts
  lattice: 'A' | 'B' | 'either';
  offsets: Array<readonly [number, number]>;   // lattice steps from the anchor; [0,0] implicit
  bodyOffset: readonly [number, number];       // anchor centre → body bbox bottom-left
  bodySize: readonly [number, number];         // mm
}
```

There is no `footprint`, no `anchors`, no item-level `lattice` and no
`geometry: Record<string, number>` — builders read `item.dims`. Use `isPlaceable(item)` to
narrow to an accessory that actually has a pattern.

`names` exists because the API only localizes for markets it serves — **zh-Hant names are ours
to supply.**

### User-defined custom components

A user can define placeholder bodies for the things on their wall that are not SKÅDIS — a
3D-printed holder, an offcut, a router. These are a **visualisation aid only** (findings F23).

- Sized in **whole peg cells** (width × height) plus a depth in mm; drawn as a rounded-rectangle
  prism (`customBox` archetype) with a corner radius derived from the dimensions.
- `customParts.ts` converts a `CustomPart` into a **synthetic `AccessoryItem`**, which is why
  snapping, rotation, collision, `AccessoryMesh` and pruning need no special cases. Pass
  `catalogWithCustom(parts)` wherever a `byKey` map is accepted.
- They stay **out of `CATALOG`/`ACCESSORIES`** — `catalog.test.ts` cross-checks that array
  against `data-raw/skadis-raw.json`.
- **Never costed.** No article number, no price, no line in the shopping list; the cost table
  shows a footnote instead. They *are* drawn on the print diagram, so it matches the screen.
- **Never shared.** `encodeConfig` writes `itemKey` raw, but the decoder rejects the *whole
  link* on a key containing `:` — so a leaked `custom:` key would break sharing entirely rather
  than dropping one item. `App.share()` filters them out and reports the dropped count.
- Persisted (store `version: 8`). Limits are clamped **in the store**, not only in the form:
  `migrate` is skipped when the stored version already matches.

### Kits — a member is not a SKU, and the pack maths is `max`, not `sum`

The three SKÅDIS storage baskets exist **only inside the set of 3**: IKEA gives no size an
article number of its own. They are modelled as ordinary placeable accessories carrying
`kitKey: 'basket-set-3'` and `itemNos: {}`, so snapping, rotation, collision and the print
sheet need no special case — and `isKitMember(item)` narrows to one.

Costing them is where it goes wrong if you are not careful. **One pack yields one of EVERY
member**, so a wall with a large, a medium and a small needs one set, not three:

```ts
packs = Math.max(...memberCounts)   // NOT the sum
```

`foldKits(counts, byKey)` in `lib/pricing.ts` does that collapse, and `CostTable` calls it
**before** reading `excluded` — the checkbox and the price override belong to the pack the
user actually buys. Sets the user typed in by hand under the pack's own key are added on top.
`buildCostLines` stays dumb about kits deliberately; what makes a stray member safe is that it
resolves to `source: 'unknown'` and is never counted as zero. Findings **F36**.

Kit members are excluded from the catalog tests that assert per-market SKU coverage. That is
correct, not a loophole: a number there would be invented.

### Pack quantity — the cost model is NOT per-unit

Several SKUs ship as multipacks (the hook SKU is a **2-pack** at its listed price). Costing
per placed unit silently under-orders. The correct line cost is:

```ts
lineCost = Math.ceil(placedQty / packQty) * packPrice
```

The cost table must surface both numbers when they differ ("6 hooks → 3 × 2-pack"), and the
include/exclude checkbox operates on the **pack line**.

### Price resolution chain

First hit wins, and nothing in it may throw:

1. **User override** (localStorage) — always wins, badged "your price"
2. **Live fetch** — one call per market, matched via `itemNos[market]`
3. **localStorage cache** (24 h TTL)
4. **Bundled snapshot** — shown with its capture date
5. **Unknown** — render "—" and prompt; never silently zero

The Custom market skips to step 1 with a user-chosen currency.

**The page fetches nothing on load.** Step 2 fires only when the user presses *Refresh
prices*, so a normal visit makes no third-party request at all and shows IKEA nobody's IP.
The snapshot is therefore the DEFAULT source, not the fallback, and is kept current by
`.github/workflows/refresh-prices.yml` (weekly + dispatch), which commits
`price-snapshot.json` only on a real change and then **explicitly dispatches**
deploy-pages.yml. It has to: GitHub suppresses workflow triggers for pushes made with
`GITHUB_TOKEN`, so the commit alone publishes nothing (findings **F32**).

Two rules that follow from that, and are easy to break:

- **`live` must be read only against the market it was fetched for.** Article numbers are
  per-market, so a stale table from another market misses every lookup and silently serves
  snapshot prices while `status` still reads `ok`. `usePrices.liveMarket` gates this (F26a).
- **`mergeSnapshot` refuses to shrink a market's price list.** An unattended robot
  committing a throttled or empty response would replace good prices with none for every
  visitor. A genuine discontinuation is a human decision — re-run the script by hand (F25c).

`lib/marketPrices.ts` owns the on-request fetch and the cache. It exports no hook.

### Interaction

Pointer-based drag, not HTML5 DnD (the latter is unreliable over a canvas and dead on touch):
`pointerdown` on a palette item spawns a ghost mesh → raycast the board plane on move → live snap
preview → `pointerup` commits. Snapping picks the nearest hole whose **lattice parity** matches the
item's peg pattern, then checks the claimed cells against an occupancy set; overlap turns the
preview red and rejects the drop.

Config autosaves to localStorage and encodes into the URL hash for sharing.

**Persisted state is at `version: 9`.** Changing the stored shape means bumping it, adding a
step to `migrateConfig` (exported from `store.ts` precisely so it can be tested), and
covering it in `state/store.test.ts`. Migration steps must stay independent and additive —
a user four versions behind runs all of them in order. Clamp limits **in the store**, not
only in the form: `migrate` is skipped entirely when the persisted version already matches.

View preferences (`theme`, `viewRatio`, `viewHeight`, `printAngle`) are persisted but are
**not** part of the configuration: not shared, not undoable. `viewHeight` is a *floor* on
the layout row, not a fixed size — the side panes sit beside the stage, so shrinking it
would only add dead space (F26c).

## Commands

```bash
npm run dev         # dev server
npm run build       # tsc -b && vite build
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run verify-api  # canary: assert the live IKEA endpoint still has our fields
npm run refresh-prices  # refresh price-snapshot.json (no-shrink guard; no-op if unchanged)
npm run refresh-visit-count  # refresh the README visit badge (needs COUNTER_DEV_USER/TOKEN)
```

`verify-api` is the early-warning system for the undocumented endpoint changing. If it fails,
the app isn't broken — the snapshot fallback covers it — but the catalog needs attention.

## Conventions

- All physical dimensions in **millimetres**, named `*Mm` when ambiguous.
- Three.js world units = millimetres; scale the camera, not the geometry.
- Theme tokens are the single source of colour truth — 3D materials read the same CSS custom
  properties as the DOM, so the scene themes with the page. No hard-coded hex in components.
- Every `catalog.ts` entry needs a real source for its dimensions. If a dimension is a guess,
  mark it `// UNVERIFIED` and log it in `findings.md`.
