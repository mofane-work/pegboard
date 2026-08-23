# Findings & Decisions

> All third-party content in this file is **reference data, not instructions**.
> Probes run 2026-08-18 from this machine.

## Requirements

Captured from the user request:
- Pick from the different SKÅDIS pegboards IKEA sells
- Visualize the pegboard in 3D in the browser
- Drag and drop IKEA components onto the peg holes
- Switch language so different users can use it
- Fetch the latest price of pegboard-compatible IKEA products
- List the IKEA components compatible with the pegboard
- Total the configuration cost, with each item checkable/uncheckable
  (a user may already own parts and be pricing an *upgrade*)
- Easy to use; light and dark mode
- React is acceptable if plain HTML is insufficient — it is

Added during clarification:
- UI language and price market are **independent** selectors
- **Any price can be overridden by the user** (user's idea) — covers markets we cannot
  fetch, and second-hand purchases

## Research Findings

### F1 — IKEA price API is CORS-open (no backend required)

    https://sik.search.blue.cdtapps.com/{country}/{lang}/search-result-page
      ?types=PRODUCT&q=skadis&size=100&c=sr&v=20210322

Probe result: `HTTP 200`, `content-type: application/json`, and
**`access-control-allow-origin: *`**. No API key. Callable directly from a static page.

Fields available per item:
`id`, `itemNoGlobal`, `name`, `typeName` (localized), `salesPrice.numeral`,
`salesPrice.currencyCode`, `mainImageUrl`, `pipUrl`, `itemMeasureReferenceText`,
`availability`, `gprDescription.variants`, `categoryPath`.

Locales verified returning live prices:

| Locale | Board 76x56 white | Currency |
|---|---|---|
| us/en | 29.99 | USD |
| de/de | 17.00 | EUR |
| gb/en | 15.00 | GBP |
| fr/fr | 15.00 | EUR |
| jp/ja | 2999   | JPY |
| cn/zh | —      | CNY |

Sample US catalog pulled (98 results for `q=skadis`, ~40 genuine SKÅDIS SKUs):
pegboards 36x56 / 56x56 / 76x56 (19.99 / 24.99 / 29.99 USD), free-standing 24.99,
hooks 3.00-5.00, shelf 5.00, display shelf 7.00, container 5.00, container with lid 10.00,
clip 4.00, storage basket 10.00, basket set of 3 11.00, elastic cord 3.00,
connector 7.00, hook rack 4.00, 7-piece accessory set 15.00.

**Gotchas (each cost a probe to find):**
1. Item numbers are **not** globally stable. White 76x56 board is `10321618` in US/DE/GB
   but `90321619` in JP. Catalog must key on our own slug.
2. Searching by item number **fails in non-Latin locales** — `q=10321618` on `jp/ja`
   returns nothing. Fetch the whole series per market and match locally instead.
3. The result set includes non-SKÅDIS noise: ALEX, SUNNERSTA, VATTENKAR, FLÖNSA,
   PÅLYCKE, VARIERA, FÖRSÄSONG. Filter by `name` starting with `SKÅDIS` AND an allow-list.
4. Wrong path `/search?...` returns 404 — it must be `/search-result-page` with
   `c=sr&v=20210322`.

### F2 — IKEA's official 3D models cannot be used

PIP pages embed real GLB assets, discovered in a `schema.org/3DModel` JSON-LD block:

    https://web-api.ikea.com/dimma/assets/1.2/10321618/PS01_S01_NV01/rqp3/glb_draco/...glb

- Without `?cn=pip` → **403**
- With `?cn=pip` → **200**, `content-type: model/gltf-binary`, `content-length: 3176320`,
  but **`access-control-allow-origin: https://www.ikea.com`**
- Re-probed with `Origin: http://localhost:5173` → **403**

So: origin-locked, 3.1 MB per product, copyrighted, and no peg-anchor metadata.
**Decision: author procedural three.js geometry ourselves.** KBs not MBs, licensing-clean,
and each accessory carries the hole-footprint data we actually need.

### F3 — SKÅDIS geometry constants

Source: `franpoli/OpenSCADutil` → `libraries/ikea_skadis_pegboard_accessories/ikea_skadis.scad`
(GPL-3.0 — constants read for reference only, **no code copied**), corroborated by
community makers and dimensions.com.

    peg_default_width     = 5      // mm
    peg_default_thickness = 4.6    // mm (board thickness)
    distance_between_pegs = 40     // mm pitch, both axes

- Slots are **5 x 15 mm vertical ovals** (radius 2.5, ~1 mm fillet)
- Lattice is **staggered**: a second 40 mm grid offset **20 mm in X and Y**
- Board sizes: 36x56, 56x56, 76x56 cm; plus free-standing 56x36
- dimensions.com confirms 56x56 board: 560 x 560 x 20 mm overall, 1.9 kg,
  powder-coated steel / fibreboard

**UNRESOLVED — must calibrate in Phase 2:** exact hole counts per board size and the
edge margin from board edge to first hole. dimensions.com explicitly does not publish
hole size, pitch, count, or margin. Do **not** invent these; verify against product
photographs and community CAD, then record the confirmed numbers here.

### F4 — Traditional Chinese has no live price source

IKEA Taiwan and Hong Kong are operated by a different franchisee on a separate platform.

Probes, all **404** on the F1 API: `tw/zh`, `hk/zh`, `hk/en`, `mo/zh`, `tw/zh_TW`, `tw/en`, `hk/zh_HK`.

`www.ikea.com.tw/zh/search?q=skadis` returns 200 HTML with results, but the search is
powered by **Algolia with credentials bundled inside their JS**. Extracting another
party's search key is not something to build a product on — **not pursued.**

**Resolution (user's suggestion, adopted):** decouple UI language from price market and
let the user override any price. A Taiwanese user gets a fully zh-Hant UI, selects a
Custom (TWD) market, and enters their own prices. This is strictly more useful than the
market coverage it replaces — it also serves second-hand buyers and any unavailable SKU.

### F5 — Prior art

`nmattia/skapa` (skapa.build) — vanilla JS + three.js + Vite, generates 3D-**printable**
SKÅDIS accessories, MIT-ish open source. Confirms browser three.js suits this domain but
solves a different problem (STL export, not shopping). Also: `skadisgen.com`, `Skrädda`,
and `legna-namor/IKEA-Skadis-Pegboard-Mount-Generator` (OpenSCAD).
**No open-source SKÅDIS shopping/pricing configurator found** — this is a real gap.

## Manual verification checklist (Phase 7)

1. Pick 56x56 board → correct hole count renders; orbit and front-reset work
2. Drag hook onto board → snaps to a hole. Drag container onto same hole → red, rejected
3. Market US → JP → all prices and currency change (USD → JPY) via the JP number map
4. Language → 繁體中文 → all strings and product names translate, **prices unchanged**
5. Market → Custom (TWD) → rows show "—"; type a price → total updates, survives reload
6. Uncheck the board row → total drops by exactly the board price (upgrade-pricing case)
7. Toggle dark mode → page *and* 3D scene change; reload → preference persists
8. Block `sik.search.blue.cdtapps.com` in devtools → app loads on snapshot prices with a
   visible staleness notice, no crash

## Risks

| Risk | Mitigation |
|---|---|
| IKEA endpoint changes or blocks us | Snapshot fallback + `verify-api` canary; app never hard-fails |
| Hole counts/margins wrong | Phase 2 calibration against photos, recorded here |
| Per-market item numbers drift | Mapping isolated in `catalog.ts`; unmapped items degrade to override |
| Accessory dimension entry is tedious | Front-loaded in Phase 1; ~10 archetypes cover ~30 SKUs |

### F6 — Product dimensions ARE extractable, and pack quantity changes the cost model

PIP pages embed two different measurement blobs. The obvious one is a trap:

- `"measurementGroups":[...]` → **package** dimensions. The 56x56 board reports
  Width 57 / Length 61 / Height 2 cm here. Wrong data for our purposes.
- `"measurements":[{"measure":"...","name":"...","type":"..."}]` → **product** dimensions.
  Same board reports Width 56 / Height 56 cm. **This is the one to parse.**

Use a metric locale (`gb/en` or `de/de`) so values arrive in cm; `us/en` returns inches.
Item numbers are shared between `us/en` and `gb/en`, so one metric fetch serves both.

Verified extraction (regex `"measurements":(\[\{"measure".*?\])` then `json.loads`):

| SKU | Product dims | Note |
|---|---|---|
| 00320803 Pegboard | W 56 x H 56 cm | matches known board size |
| 00320799 Shelf | W 28 x D 9 x H 3 cm | |
| 20320798 Container | W 7.5 x D 9 x H 8 cm | |
| 50335618 Hook | D 9.5 x H 6 cm | **"Package quantity: 2 pack"** |

**F6a — pack quantity is a real requirement, not a detail.** The hook SKU is sold as a
2-pack for its listed price. A user who places 6 hooks needs **3 packs**, not 6 units.

Therefore the cost model is:

    lineCost = ceil(placedQty / packQty) * packPrice

not `placedQty * unitPrice`. The cost table must show both the placed count and the
pack count when they differ (e.g. "6 hooks → 3 x 2-pack"), otherwise the total is wrong
and the user under-orders. `packQty` becomes a required field on `CatalogItem`.

This also means "uncheck an item" operates on the **pack line**, and unchecking a
partially-owned quantity needs the user to adjust the placed count, not just the checkbox.

### F7 — Hole lattice SOLVED: 20 mm edge margin, derivation verified on all board sizes

This was flagged as the riskiest unknown. It is now resolved by derivation, not by guessing.

`pegboardly.com/skadis/skadis-sizes-and-dimensions` publishes slot counts for three
layouts with their hole spans:

| Layout | Slot span |
|---|---|
| 14 x 14 | 520.0 x 520.0 mm |
| 22 x 14 | 840.0 x 520.0 mm |
| 36 x 14 | 1400.0 x 520.0 mm |

Each is consistent with pitch 40 mm and `span = (n - 1) * 40`:
13x40=520, 21x40=840, 35x40=1400. All three check out.

**Deriving the margin:** the square board is 560 mm wide and carries 14 columns spanning
520 mm, leaving 40 mm total → **20 mm margin on each edge**, i.e. exactly half the pitch.

**This margin then predicts every board size exactly, with zero remainder:**

| Board | Width | Primary cols | Span | Margin check |
|---|---|---|---|---|
| 36x56 | 360 mm | 9  | 320 mm | 320 + 2x20 = **360** ✓ |
| 56x56 | 560 mm | 14 | 520 mm | 520 + 2x20 = **560** ✓ |
| 76x56 | 760 mm | 19 | 720 mm | 720 + 2x20 = **760** ✓ |
| all    | 560 mm high | 14 rows | 520 mm | 520 + 2x20 = **560** ✓ |

Three independent widths landing on exact integers is strong evidence the model is correct.

**Final lattice model:**

    Primary lattice (A):   x = 20 + 40i,  y = 20 + 40j
    Secondary lattice (B): x = 40 + 40i,  y = 40 + 40j     (A offset by +20, +20)

Union gives columns every 20 mm horizontally with alternate columns shifted 20 mm
vertically — which matches the community description of the pattern exactly.

Resulting hole counts:

| Board | Lattice A | Lattice B | Total slots |
|---|---|---|---|
| 36x56 | 9 x 14 = 126 | 8 x 13 = 104 | **230** |
| 56x56 | 14 x 14 = 196 | 13 x 13 = 169 | **365** |
| 76x56 | 19 x 14 = 266 | 18 x 13 = 234 | **500** |

**Parity matters for snapping.** An accessory whose pegs sit on 40 mm centres can only
mount on holes of a single lattice — you cannot mix A and B holes for one accessory.
So `grid.ts` must tag every hole with its lattice (`'A' | 'B'`) and the snapper must only
consider holes of the lattice matching the item's peg pattern. This is the "parity-aware
snapping" requirement.

**Confidence: high, but still worth one physical check.** Source is community-measured and
self-declares as unconfirmed against a physical board; our derivation is what raises the
confidence. Slot span numbers are exact, board widths land exactly. If a real board ever
disagrees, only the `MARGIN_MM = 20` constant in `grid.ts` needs to change.

### F8 — CORRECTION to F7: the two lattices are offset (+20, −20), not (+20, +20)

F7's margin of 20 mm was right, but the **vertical phase was wrong**. User reported the
36×56 board should read 8 slots on odd rows and 9 on even rows; our model produced the
opposite. Verified against IKEA's own product photography by pixel analysis
(`board36.jpg` = item 50320805, `board56.jpg` = item 00320803, both `?f=xxl`, 1100²).

Method: inside the board's bounding box the slots read as background-white (255) against
the off-white panel (~241), so slot runs are directly detectable per scanline.

**36×56 board** — 685 × 1054 px for 360 × 560 mm:

| Measured | mm | Reading |
|---|---|---|
| Wide rows (9 slots) | first at y = 39.3 mm from top, first slot x = 22.6 mm | 40 / 20 |
| Narrow rows (8 slots) | first at y = 19.1 mm from top, first slot x = 42.0 mm | 20 / 40 |
| Row pitch | 37.5 px = 19.9 mm between adjacent rows | half-pitch ✓ |

**56×56 board** — independent confirmation, 1047 × 1053 px:

| Row | mm from top | Slots | First slot x |
|---|---|---|---|
| wide | 40.4, 80.3, 120.2 … 519.6 | **14** | 20.9 mm |
| narrow | 60.1, 100.0, 139.9 … 539.8 | **13** | 40.6 mm |

Every measurement lands within ~1 mm of a 20 mm multiple across 26 rows on two different
boards. The corrected lattice, in board space with y measured from the bottom:

    Lattice A (wide rows):   x = 20 + 40i,  y = 40 + 40j
    Lattice B (narrow rows): x = 40 + 40i,  y = 20 + 40j

So B = A + (20, −20). The topmost and bottommost rows are **narrow** rows sitting 20 mm
from the edge; wide rows are inset 40 mm vertically but only 20 mm horizontally. The
pattern is deliberately not symmetric under 90° rotation.

Corrected slot counts (F7's figures were wrong and are superseded):

| Board | Lattice A | Lattice B | Total | F7 said |
|---|---|---|---|---|
| 36×56 | 9 × 13 = 117 | 8 × 14 = 112 | **229** | ~~230~~ |
| 56×56 | 14 × 13 = 182 | 13 × 14 = 182 | **364** | ~~365~~ |
| 76×56 | 19 × 13 = 247 | 18 × 14 = 252 | **499** | ~~500~~ |

Lesson worth keeping: F7's derivation was internally consistent and matched three board
widths exactly, which made it *feel* verified. It fixed the pitch and the margin
correctly but left the phase underdetermined, and nothing in the derivation could have
caught that. The product photo could, and did.

### F9 — Wide accessories were nearly unplaceable (anchor was the left peg)

Reported: the hook rack could not be placed. Root cause was not the catalog — it was
that snapping anchored an item by its **first peg**, so the body extended entirely to the
right of the cursor. On a 360 mm board a 280 mm rack has only 3 valid anchor columns out
of 9, all at the far left, so dragging anywhere natural failed silently.

Fix: snap by the item's **body centre**. The cursor position maps to where the middle of
the accessory should sit, and the anchor hole is derived from that. This also makes every
other wide item (shelf, display shelf, basket, elastic cord) behave the way a user expects.

The catalog test that claimed "every placeable accessory fits" was true but tested the
wrong thing — it asked whether *any* anchor works, not whether the anchor a user would
naturally aim for works.

### F10 — Body-within-board was a wrong constraint

Rejecting placements whose body crosses the board edge is not physical. What actually
holds an accessory up is its pegs being in real slots; a shelf may legitimately overhang
the edge, and a hook mounted at the boundary is a normal way to hang something on the
adjacent wall. Constraint is now: **pegs must all land on real slots** (hard), body
overhang allowed, collision with other items still enforced.

### F11 — Mesh and collision box disagreed by up to 160 mm (root cause of two reported bugs)

User reported (a) a dead zone where nothing could be placed toward the right of the board,
and (b) components not visibly pegging into the slots. Both are the same defect.

Two frames were being used for the same accessory and nobody reconciled them:

- **`archetypes.ts`** builds every part centred on `x = 0`, i.e. centred on the
  **anchor peg**.
- **`catalog.ts`** `hanging()` sets `bodyOffset.x = -(width − pegSpan) / 2`, which puts
  the body centred on the **peg span** — for a 2-peg item that is `pegSpan / 2` to the
  right of the anchor.

Measured mismatch (mm the collision rect sits right of the drawn mesh):

| Item | Peg span | Body width | Mismatch |
|---|---|---|---|
| hook-large | 0 | 40 | 0 |
| container | 40 | 75 | **20** |
| shelf | 240 | 280 | **120** |
| hook-rack | 240 | 280 | **120** |
| display-shelf | 280 | 320 | **140** |
| basket | 320 | 345 | **160** |
| elastic-cord | 240 | 270 | **120** |

Single-peg items were correct, which is why hooks looked fine and everything wider
did not. The invisible collision box hanging off to the right is exactly the "vertical
line past which nothing can be placed", and the mesh drawn away from its pegs is why
items looked like they were not engaging the slots.

Fix: one canonical local frame for accessory geometry — **origin at the body's top
centre**, with the mesh group translated from the anchor by
`[bodyOffset.x + bodySize.x / 2, bodyOffset.y + bodySize.y]`. The translation is applied
*inside* the rotated group so it stays correct at every rotation (verified: for the shelf
at 90° both the mesh and the pattern rect put the body centre at `(15, 120)` from the anchor).

### F12 — Snapping should pick the nearest VALID hole, not the nearest hole

Even with F11 fixed, wide accessories still die near an edge: the anchor is the leftmost
peg, so when the ideal anchor has no room for the remaining pegs the drop is simply
rejected. The user reads that as a wall partway across the board.

`nearestHole` picked the geometrically nearest hole and then `evaluatePlacement` judged it.
Snapping now searches for the nearest hole **that yields a valid placement**, so dragging a
shelf toward the right edge slides it to the rightmost position it actually fits instead of
turning red. Rejection is reserved for cases with no valid hole at all (e.g. every candidate
overlaps something already placed).

### F13 — Physical review of every peg pattern

Checked each placeable item against how the real part hangs:

| Item | Pegs | Verdict |
|---|---|---|
| hook-large, hook-small, hook-round, clip | 1 | Correct — these insert into a single slot |
| container, container-lid | 2 @ 40 mm | Correct — tabs one pitch apart |
| shelf, hook-rack | 2 @ 240 mm | Plausible for a 280 mm part; still `patternEstimated` |
| display-shelf | 2 @ 280 mm | Plausible for 320 mm |
| basket | 2 @ 320 mm | Plausible for 345 mm |
| elastic-cord | 2 @ 240 mm | Correct in kind — the cord spans between two slots |

Rules now enforced in geometry, not just in the collision box:
- Body top sits at the peg line and hangs downward (`bodyOffset.y = −height`), matching how
  every SKÅDIS accessory actually hooks in from above.
- Multi-peg items engage two slots in the **same row of the same lattice**; rotated 90° they
  engage the same lattice vertically, which is also 40 mm apart, so rotation stays physical.
- Board front face is `z = 0` and all accessory parts extrude to `+z`, so nothing is drawn
  behind the panel.

Peg spans remain `patternEstimated: true` — IKEA publishes no peg spacing, so these are
derived from product width against the 40 mm pitch.

### F14 — Review pass: four defects found by probing rather than re-reading

**F14a — Invisible items were still charged for.** The 3D scene skipped placements whose
hole id did not resolve; the cost table counted every placement regardless. A configuration
saved before the F8 lattice correction can hold e.g. `A:0,13`, which no longer exists
(lattice A now has 13 rows). Result: you paid for an item you could not see and could not
delete. Both views now go through one resolver, `lib/placements.ts`, and unresolvable
placements are pruned on load.

The pruning first lived inside `Scene`, which meant it only ran if the canvas mounted —
writing the test exposed that, and it moved up to `App`.

**F14b — `detectLanguage` was dead code.** It was written, exported, and never called; the
store hard-coded `'en'`. A Japanese or Taiwanese visitor got English despite the detection
existing. Now the store's initial language calls it (moved to `i18n/detect.ts` so it carries
no i18next runtime and is directly testable).

Detection also had a latent bug: the old regex `!/hans|cn|sg/i` rejected any tag containing
those letters anywhere. Now anchored to `-cn` / `-sg` / `hans`, so Simplified locales fall
through to English rather than being served the Traditional bundle.

**F14c — Rotating mid-drag did not re-validate.** `R` rotated the ghost, but `valid` still
held the answer for the previous orientation, so a drop could commit a placement that did
not fit in its new orientation. The last cursor position is now remembered and the snap
re-runs when rotation changes.

**F14d — No keyboard path to place an accessory.** The palette entries were buttons whose
only affordance was `onPointerDown`; keyboard and switch users could not place anything.
Enter/Space now places at the middle of the board using the same `snapPlacement` the pointer
uses, so the two paths cannot disagree about what is legal.

### F15 — Known limitations, deliberately not fixed

- **Bundle is ~1.17 MB** (three.js dominates). Fine for a desktop planning tool on a static
  host; would matter on mobile data. Code-splitting the 3D view is the fix if it ever does.
- **Changing board size clears the board.** Hole ids are board-relative, so placements
  cannot be carried across sizes without re-solving each position. Re-solving is possible
  (snap each item to its nearest valid hole on the new board) but silently moving a user's
  layout is worse than clearing it, so this stays explicit.
- **Peg spans remain estimates** (`patternEstimated`), since IKEA publishes no peg spacing.
- **Free-standing board lattice is unverified** — its stated height includes the stand, so
  the slot field may not be centred. Flagged as `latticeVerified: false` in the catalog.

### F16 — Shopping-list export: three constraints found before writing any code

**F16a — Article numbers must be derived, and it is safe to do so.** Store staff look items up
by IKEA's dotted form, never raw digits. Product pages carry both
(`itemNo: "10321618"`, `visibleItemNo: "103.216.18"`) but our search endpoint returns only the
raw one. Verified across all 44 item numbers in our markets: every id is 8-digit numeric, and
`XXX.XXX.XX` grouping reproduces IKEA's own value exactly. Leading zeros survive because ids
are strings (`00320803` → `003.208.03`).

**F16b — `String.padEnd` cannot align the CJK output.** Monospace CJK glyphs are double-width,
so `.length` is not the printed width:

| Name | `.length` | Printed width |
|---|---|---|
| `Hook, large` | 11 | 11 |
| `フック 大` | 5 | **9** |
| `掛鉤 大` | 4 | **7** |

Padding by `.length` would leave ragged columns in exactly the languages this feature serves.
Needs East-Asian-width-aware padding (Unicode `W`/`F` count as 2).

**F16c — The Clipboard API is unavailable on the user's own test URL.**
`navigator.clipboard` requires a secure context. `https`, `localhost` and `127.0.0.1` qualify;
**`http://nuc-server.tailaac302.ts.net:3001` does not.** A modern-only copy button would
silently do nothing on the setup used to test it. Requires a `document.execCommand('copy')`
fallback, and the button must never report success it did not achieve.

**F16d — No new data plumbing needed.** `buildCostLines()` already returns `item`, `quantity`
(pieces), `packs`, `packQty`, resolved `price` with `source`, `lineTotal` and `included`; the
export is a pure formatter over `CostLine[]` and inherits pack-aware maths and the
"unknown is never zero" rule for free.

**Dropped from scope:** stock/availability lookup. `product.availability` returns empty from the
search endpoint, and the user considers checking stock outside this app's responsibility —
people can look it up themselves.

### F17 — Print diagram projection (research for Phase 15)

User suggested the printed diagram wants a tilt of "around 45 degrees". That is correct, and
it is specifically the **azimuth** half of the standard isometric setup. The full convention:

    rotate 45° about the vertical axis, then tilt 35.264° about the horizontal axis

35.264° is not arbitrary — it is `arcsin(1/√3)` = `arctan(1/√2)`, the angle at which all three
coordinate axes foreshorten equally and appear 120° apart. Sources state it as "35° 16'
elevation and 45° azimuth".

**IKEA's own assembly manuals use exploded axonometric projection**, which is the strongest
precedent available for this feature: axonometric avoids the spatial distortion perspective
introduces, so parts stay comparable in size across the page. Directly applicable — this app's
output is read the same way an assembly sheet is.

Implications for Phase 15:
- Use an **orthographic** camera for the print diagram, not the perspective camera the
  interactive view uses. Perspective makes near slots larger than far ones, which is wrong on
  paper where someone may be counting hole positions.
- Default print angle: azimuth 45°, elevation 35.264°. Worth offering a straight-on elevation
  (0°, 0°) as an alternative, since for a flat wall-mounted board a front view is often the
  most legible thing to hold up next to the real board.
- Rendering as 2D SVG from `generateHoles` is likely better than rasterising the WebGL canvas:
  crisp at any print DPI, tiny file, and it themes with the page.

Sources: Wikipedia "Isometric projection"; PTC IsoDraw axis documentation; general axonometric
drawing references on IKEA-style manuals.

### F18 — European markets share the US article number; two SKUs we do not carry

Added DE, GB and FR. Verified independently rather than trusting the extraction:

```
market SKU counts: us 22 · gb 23 · de 24 · fr 24 · jp 21
us ⊆ gb ? True    us ⊆ de ? True    us ⊆ fr ? True
```

**Every US article number we carry also exists in GB, DE and FR** — all 22 catalog items
resolve in all three. So the catalog declares them once via a `shared()` helper rather than
repeating each number four times, and a test asserts the equality holds so a future divergence
fails loudly instead of silently mispricing.

This corrected a wrong assumption too: DE and FR `pipUrl` slugs are **not** English
(`skadis-haken-weiss`, `skadis-crochet-blanc`), so the slug-matching that works for Japan finds
nothing for them. Item-number identity is the reliable join for European markets.

**Two SKUs exist in Europe that we do not carry**, deliberately left out of scope:

| Item no | Markets | What |
|---|---|---|
| `50569933` | gb, de, fr | SKÅDIS hook in **black** — a colour variant of `hook-large` |
| `90569945` | de, fr only | A tool holder absent from us/gb |

Adding them means new catalog entries with dimensions and peg patterns, which is product work
rather than market work. Recorded so it is a decision rather than an oversight.

### F19 — Share links carry the configuration, not a reference to one

Sharing is a URL fragment and nothing else: no backend, no stored entries, no short-link
service. A link therefore works from a static host indefinitely and nothing has to be kept
alive to honour it. Format is versioned and deliberately readable rather than base64, so a
malformed link is something a person can inspect:

    v1~board-56x56-white~us~USD~A*5*5*hook-large*0!B*3*2*shelf*90~shelf~hook-large*3.5~connector-wall*2

A shared link is **untrusted input** — it arrives from outside the app entirely — so the
decoder validates every field against a pattern and returns `null` rather than casting. 15
rejection cases are tested, including injection-shaped item keys, illegal rotations, negative
prices and structurally short input.

Two behavioural decisions worth recording:
- **A link beats stored state.** Someone opening a link expects that build, not their own
  previous one.
- **The fragment is cleared after loading**, so a later reload does not silently revert edits
  the user has made since opening it.
- **Applying a link clears undo history.** A link is a starting point, not a step you can undo
  past into someone else's configuration.

### F20 — Multi-board walls: the least invasive model

Three ways to represent a wall of boards were possible. Chosen: **hole ids stay
board-relative, each board carries an offset.** A placement gains a `boardIndex`.

This leaves every function in `grid.ts` — the lattice maths that took two rounds of
correction to get right (F7, F8) — completely untouched. Only collision and snapping learn
to translate between board space and wall space, in `lib/wall.ts`. The alternative,
namespacing hole ids as `0#A:5,5`, would have rewritten the ids stored in every saved
configuration and every share link for no functional gain.

Two decisions worth recording:

- **Board offsets are derived, never stored.** `layoutBoards()` recomputes positions from
  the board sizes on every read. Storing them invites a stale offset that silently overlaps
  two boards; deriving makes that state unrepresentable. The share format carries only the
  board keys for the same reason.
- **Connectors are added automatically, one per seam.** Joining boards needs hardware, and
  forgetting it is the classic way to get home from IKEA with a wall you cannot assemble.
  It appears as a normal cost line, so it can still be unchecked by someone who already owns
  the connectors.

Share format moved to **v2**. v1 links predate walls and are rejected as superseded rather
than guessed at — silently reinterpreting an old link as a one-board wall would be a
plausible-looking wrong answer.

### F21 — Multi-board drag was broken by a world-vs-wall coordinate mix-up

User reported that after adding a third board, dragging onto it "jumps to the very end".
Root cause found by reading the conversion rather than guessing.

`BoardPlane` reported `event.point`, which three.js gives in **world** space, but the code
then added the hit board's own half-width *and* that board's wall offset:

```
wallX = event.point.x + board.widthMm / 2 + board.offsetX   // wrong
wallX = event.point.x + wallWidthMm / 2                     // right
```

For three 560 mm boards (wall 1696 mm):

| Board | Offset | Correct term | Actual term | Error |
|---|---|---|---|---|
| 0 | 0 | +848 | +280 | **−568 mm** |
| 1 | 568 | +848 | +848 | 0 |
| 2 | 1136 | +848 | +1416 | **+568 mm** |

The middle board is accidentally correct, which is why the problem only became obvious at
three boards. An error of ±568 mm puts the cursor clear off the wall, and `snapPlacement`
clamps to the nearest valid hole — landing the item at the far edge. **Two-board walls were
wrong too** (±284 mm), just less visibly.

Fix: `BoardPlane` reports the raw world point and `worldToWall()` in `lib/wall.ts` is the only
conversion. It depends solely on the wall size, so it cannot be right for one board and wrong
for the others. Tested three ways: the conversion itself, that it is board-independent, and
end-to-end that aiming at each board lands on that board.

### F22 — Double-sided boards removed

Dropped `board-36x56-multi` and `board-76x56-multi`. We render one face and offer no way to
show or choose the other, so listing them advertised a feature that does not exist.

What is lost is small and recoverable: their slot lattice is **identical** to the white board
of the same size, so the layout work is unaffected, and someone who owns one can select the
same size and use the existing price override to enter what they actually paid. A persist
migration points saved walls at the white board of the same size rather than letting them
fall back to a different size.

Also capped walls at **3 boards** (`MAX_BOARDS`) at the user's request — three 56 cm boards is
already a 1.7 m wall.

### F23 — Custom components: three stale CLAUDE.md sections, and the share-link hazard

Planning Phase 18 surfaced that `CLAUDE.md` documents code that does not exist:

| Documented | Reality |
|---|---|
| `CatalogItem` has `footprint`, `anchors`, `lattice`, `geometry` | Union on `kind`; peg data is a `PegPattern` from `lib/grid.ts` |
| "Plain CSS Modules" | Zero `*.module.css`; three global stylesheets with BEM classes |
| A `DragLayer` component | No such file; drag state is `state/drag.ts`, ghost is inline in `Scene.tsx` |

**Design.** A `CustomPart` is converted to a synthetic `AccessoryItem` and merged into the
key→item map. Snapping, rotation, collision, `AccessoryMesh` and pruning then need no changes;
the only signature change is an injected `byKey` on `resolvePlacements`. Custom parts stay out
of `CATALOG`/`ACCESSORIES` because `catalog.test.ts` cross-checks that array against
`data-raw/skadis-raw.json`.

**Share-link hazard.** `encodeConfig` writes `itemKey` raw and unvalidated, but `decodeConfig`
returns `null` for the *whole link* on a key failing `/^[a-z0-9-]+$/`. A leaked `custom:` key
would therefore not drop one item — it would silently break sharing entirely. Custom placements
are filtered before encoding; the `:` in the key is the second line of defence.

**Lattice.** Pegs derived along the top edge sit on 40 mm centres, so they are always on one
lattice by construction. Locking to A or B halves the legal positions with no physical
justification — a peg row fits both equally. Implemented locked (default A, user-visible
toggle) because the user asked for strict limits; relaxing to `'either'` is a one-line change.

**Geometry.** Rounded-rectangle prism via `Shape` + `Path.absarc` + `ExtrudeGeometry`, the same
idiom as the board's obround slots. Not drei's `RoundedBox`: no new dependency surface, and the
corner radius is derived from dims so `buildAccessoryParts(item)` keeps its one-argument shape.

## F24 — Rotating a board regroups the lattices; it does not move a slot

A board hung the other way round (36×56 → 56×36) is modelled by swapping `widthMm` and
`heightMm` **and exchanging the two lattice origins**. Worked through explicitly, and the
first version of this note got the reason wrong — the tests corrected it.

Native origins (mm from bottom-left): `A = (20, 40)`, `B = (40, 20)`.

Rotate the 360×560 panel a quarter turn — `(x, y) → (H − y, x)` with `H = 560` — and map
each lattice through it:

| Lattice | Native | Image after rotation | Reads as origin |
|---|---|---|---|
| A | `x = 20+40i` (i≤8), `y = 40+40j` (j≤12) | `x' = 40+40k` (k≤12), `y' = 20+40i` (i≤8) | **(40, 20)** |
| B | `x = 40+40i` (i≤7), `y = 20+40j` (j≤13) | `x' = 20+40k` (k≤13), `y' = 40+40i` (i≤7) | **(20, 40)** |

So the rotated field is the upright generator for the swapped dimensions with the two
origins exchanged. Counts are preserved, as they must be: A stays 117 holes (9×13 becomes
13×9), B stays 112 (8×14 becomes 14×8).

**What I expected to find, and did not.** I assumed the exchange would produce a different
*hole field* from a board that merely has those dimensions, and wrote a test asserting the
totals would differ. It failed: they are the same, on every board. The union of the two
lattices is symmetric under exchanging their origins —

```
A ∪ B  =  {20+40i} × {40+40j}  ∪  {40+40i} × {20+40j}
```

— and swapping the origins just swaps the two terms. **A turned panel presents slots in
exactly the positions a board of those dimensions would.** Nothing moves.

**What rotation does change is which holes share a lattice**, and that is the part worth
getting right. Pegs on 40 mm centres can only engage holes of one lattice (F8), so the
tagging decides which sets of holes a multi-peg accessory may span. Physically, holes that
were mutually engageable before the turn stay mutually engageable — it is one rigid panel.
On a turned 36×56 that means lattice A must remain the same 117 holes, now reading 13
columns × 9 rows. The naive dimension swap would instead tag a *different* 14 × 8 set as A,
letting an accessory span two holes that are not on one lattice in reality. Pinned by
`grid.test.ts` → "regroups the lattices rather than the slots".

The practical bite is small — most catalog patterns are `lattice: 'either'` — but
user-defined custom parts expose an explicit A/B lock (F23), so it is reachable from the UI.

Two more consequences:

- **Direction does not matter.** Turning clockwise gives the same field, because 180° maps
  each lattice onto itself (`x → W−x` sends `20+40i → 20+40k`; `y → H−y` sends
  `40+40j → 40+40k`). One boolean is enough — no need for four board orientations.
- **The square board is very nearly a no-op.** Positions and row phase are identical; only
  the tags swap, so the top row is a B row upright and an A row turned. The rotate control
  is still offered there: the slots themselves do turn, which is visible.

**Physical caveat (inference, not probed).** SKÅDIS slots are 5 × 15 mm *vertical* obrounds
and every accessory hooks in from above and hangs down (F13). Turn the panel and the slots
become 15 × 5 mm *horizontal* obrounds, which standard SKÅDIS pegs cannot seat in — the tab
has no downward travel to drop into. This is reasoning from the slot geometry, not something
probed against a real board, so the feature ships with the geometry drawn honestly (rotated
slots really are drawn horizontal) plus a note in Help, rather than being blocked. The
free-standing 56×37 board is excluded outright (`rotatable: false`): its stated height
includes a stand, so there is no sideways to hang it.

**Placements are cleared on rotation.** The lattice tags underneath them change, so a
placement's meaning does not survive — and turning the accessories with the panel would be
wrong anyway, because gravity does not rotate. Same rule as changing a board's size, and
undoable.

---

## F25 — Round 2 groundwork (2026-08-22)

Read of the existing code before planning Phases 20–25. Everything below was verified by
reading the files named, not assumed.

**F25a — The price chain already tolerates having no live table.** `CostTable.tsx:82` builds
its own `PriceContext` and calls `readCache(market)` itself; `App.tsx:52` calls
`useMarketPrices(market)` purely for its side effect on the `usePrices` store. So dropping the
automatic fetch is a *deletion at one call site*, not a refactor of `pricing.ts`. With `live`
undefined, `resolvePrice` falls through to cache → snapshot exactly as designed, and every
existing pricing test keeps passing unchanged. This is why Phase 23 is safe despite touching
the path every visitor sees.

**F25b — The cache rung survives a manual-only fetch.** `readCache` is a plain localStorage
read, independent of whether a fetch ran this session. A user who pressed refresh yesterday
still gets `source: 'cache'` today for 24 h (`CACHE_TTL_MS`). Removing the auto-fetch
therefore removes requests, not capability.

**F25c — `refresh-prices.ts` has no floor.** It writes whatever `fetchMarketPrices` returns,
including `{}` (`scripts/refresh-prices.ts`). Run by hand that is visible; run weekly by a
robot that commits and deploys, a throttled or partial response would silently replace good
prices with none for every visitor. Hence the shrink guard in Phase 23. Note `verify-api.yml`
does *not* cover this — it checks the field contract, not the row count.

**F25d — Snapshot staleness UI already exists.** `cost.stale` with the capture date renders
from `total.usesStalePrices` (`CostTable.tsx:142`). Post-Phase-23 it becomes the default state
rather than a failure state, so the wording needs a re-read: it should read as "captured on
<date>", not as an error.

**F25e — `viewRatio` is the exact template for `viewHeight`.** Store field clamped in the
setter (`store.ts:343`), default in the initial state (`store.ts:190`), migration guard
(`store.ts:423`), consumed as a CSS custom property on the layout element (`App.tsx:189`) and
driven by a range input (`Toolbar.tsx:170`). Mirroring it is five small edits with a known
shape. One trap: `.layout__stage` hard-codes `min-height: 60vh` inside the ≤900px media query
(`app.css`), which would override the new control on a phone.

**F25f — There is no first-paint content at all.** `index.html` contains only the theme boot
script and `<div id="root">`. Nothing paints until the JS bundle, React, i18n and the store
rehydration have all resolved. The splash must therefore be inline HTML+CSS in the document,
not a React component — a React loading state cannot render before React does.

**F25g — Buy Me a Coffee's official embed is a third-party `<script>`.** Loading it would
reintroduce exactly the outbound third-party request Phase 23 exists to remove, and would put
a tracker on a page whose privacy note (6.6) claims there is none. A plain `<a>` to
`buymeacoffee.com/<user>` has no such cost. The user asked for no widget independently; the
privacy story is the second reason.

**F25h — `.github/` has workflows only.** No issue templates, no PR template, no
`CONTRIBUTING.md`, no `CODE_OF_CONDUCT.md` (`find .github -type f`). `LICENSE` exists at the
root. So 6.9 is all-new files, nothing to reconcile.

**Not researched, deliberately:** whether IKEA's endpoint rate-limits a weekly CI runner IP.
Phase 23's failure mode is designed to make it not matter — a failed refresh leaves the
committed snapshot in place and exits clean.

## F26 — Two defects found while implementing Round 2 (2026-08-22)

**F26a — `live` prices had no market tag.** `usePrices.live` was a `PriceTable` keyed by
IKEA article number, with nothing recording which market it was fetched for. That was safe
only because the fetch was automatic and re-ran on every market change. The moment fetching
became a button (Phase 23), a user could refresh in the US market, switch to Japan, and have
the US table read against Japanese article numbers: every lookup misses, the chain quietly
degrades to the snapshot, and `status` still says `ok`. Fixed with a `liveMarket` field that
`CostTable` checks before passing `live` into the `PriceContext`. Worth noting the failure
mode — **not a crash, not a wrong number, just silently worse data with a healthy status** —
which is the kind that survives a test suite.

**F26b — `cost.stale` was worded as a failure.** "Prices from {date} — live prices
unavailable." was right when the snapshot was a fallback. Post-Phase-23 the snapshot is the
*normal* source and that string would have shown to nearly every visitor, reading as though
something were broken. Reworded in all three languages to state the capture date and point
at the refresh button.

**F26c — the pane-height control has no useful "smaller" direction.** The palette and cost
table are grid columns *beside* the stage, not stacked above and below it, so shrinking the
stage's height reclaims space nothing can use — it just leaves a gap. Hence the control is a
floor (`grid-template-rows: minmax(var(--stage-height), 1fr)`) rather than a fixed size: the
row always fills what is available, and the slider only raises it past the bottom of the
window. The default sits below the natural fill, so the pre-control layout is reproduced
exactly and an existing saved configuration reopens looking identical. On the stacked
≤900px layout the stage does own a row, so there the control applies directly — above a
60vh floor, which is what that layout shipped with.

**F26d — the project had no persist-migration tests.** Nine store versions, a `migrate`
chain handling all of them, and nothing exercising it: `migrate` is unreachable from the
running app, since it only fires against a blob written by a build that no longer exists.
`migrateConfig` is now exported and `src/state/store.test.ts` walks a v1 configuration
through every step to v9. This was pre-existing, not introduced by Round 2.

## F27 — Visit counting: what it costs, and why the opt-out is not decoration (2026-08-22)

Phase 23 removed every load-time third-party request and `help.pv1` promised, in three
languages, that there were none. This adds exactly one back — counter.dev — on the owner's
decision, to answer "does anyone actually use this". Everything below is what the decision
turned out to involve. Probed and read on 2026-08-22.

**F27a — "Cookieless" is a claim about cookies, not about the law.** counter.dev counts
uniques with "`sessionStorage` facilities, the browser's cache mechanism and inspecting the
referrer" (its own README). The EDPB's **Guidelines 02/2023 on the technical scope of
Art. 5(3) ePrivacy** (final, adopted 16 Oct 2024) are explicit that the rule is
technology-neutral and that Web Storage — `localStorage` and `sessionStorage` both — is in
scope, along with tracking pixels, URL identifiers and cache-based techniques. So the
tracker *is* terminal-equipment access; dropping cookies changed the mechanism, not the
obligation.

Worth recording that **counter.dev itself does not claim otherwise.** Its FAQ, verbatim:
"Can I avoid the cookie banner when using counter.dev? I don't know. … it seems that due to
the ePrivacy Directive all SaaS Web Analytics — including counter.dev — needs consent. Even
though most providers might claim the contrary." A vendor declining to claim an exemption
is the most honest signal available here, and it is why the opt-out shipped with the feature
rather than after it.

**F27b — The exemptions that do exist all require a working objection mechanism.**
- **UK:** the Data (Use and Access) Act 2025 added a statistical-purposes exemption to PECR,
  in force 5 Feb 2026 — first-party analytics used solely to improve the service, provided
  users get clear information *and* a simple, free way to object. The ICO confirmed on
  29 Apr 2026 that GA4 does **not** qualify, because Google processes for its own purposes.
- **France:** CNIL Sheet 16 exempts audience measurement on six conditions — inform and
  allow objection, audience/A-B testing only, no cross-referencing with other processing,
  single-publisher scope, truncate the last byte of the IP, 13-month tracker lifetime. It
  does permit a third-party processor if data is siloed per publisher.
- **Germany:** TDDDG §25 has no analytics carve-out. A German visitor is the weakest case in
  our own market list (us/gb/de/fr/jp), and that is a known, accepted gap rather than an
  oversight.

Two things follow directly into the code: the **Count my visit** checkbox is the objection
mechanism, and it sits inside the privacy section rather than in the toolbar because the
refusal has to be as findable as the statement it refuses.

**F27c — The opt-out must outlive the store.** `state/store.ts` is at `version: 9`, runs a
migration chain, and is overwritten wholesale by `applyShared` when someone opens a share
link. Any of those resetting a privacy choice would be a silent re-opt-in. Hence
`pegboard.analytics-opt-out` as a standalone localStorage key that nothing else reads or
writes — no store field, no migration step, no version bump. A storage read that *throws*
(strict privacy modes do this rather than returning null) is treated as opted out, never as
consent.

**F27d — The privacy text has to be conditional, or it becomes false in forks.** The tracker
only loads when a token is configured, which no local build and no fork has. If `pv1`
unconditionally described counting, every one of those builds would display a false privacy
statement in three languages — the exact failure the section exists to prevent. So there are
two strings, `pv1` (counts) and `pv1off` (the original wording, still true), and `Help.tsx`
selects on `analyticsConfigured()`. The opt-out control renders only in the counting case,
where it means something.

**F27e — counter.dev has no badge and no public count endpoint.** Reading a count needs
authentication. Its only non-session credential is the share token (`?user=&token=`, via
`GetSessionlessUserId` in `backend/lib/ctx.go`), which grants read access to the whole
dashboard — so it cannot go in a README URL. `/dump` is also **Server-Sent Events**, not
JSON: it holds the connection open and pushes a new dump on every visit, so
`await response.text()` never resolves. `scripts/refresh-visit-count.ts` therefore streams
the body, takes the first `dump` frame, and aborts. The count is committed to
`.github/badges/visits.json` and rendered by shields.io's endpoint API.

It carries the **same no-shrink guard as `mergeSnapshot`** (F25c), for the same reason: an
unattended robot committing a throttled or partial response would otherwise make a public
badge count backwards. Visits are cumulative; a smaller number is bad data, not fewer
visitors. `deploy-pages.yml` now ignores `.github/badges/**`, so the daily badge commit does
not trigger a Pages redeploy — without that, a number that never reaches the bundle would
rebuild and redeploy the whole site every morning.

**Not researched, deliberately:** whether counter.dev offers an Art 28 DPA. Its repo
documents none, and no hosting country is stated. For a free, non-commercial tool the
practical exposure is negligible, but this is the open item if the project ever takes money —
noted here rather than silently assumed away.

## F28 — Two bugs found by using the app, not by reading it (2026-08-22)

Both were reported by the user and both were invisible to the test suite, for the same
reason: jsdom has no layout engine and no wall clock, so neither CSS track sizing nor a
`setTimeout` that never fires can fail a test. Reproduced and fixed against a headless
Chromium driving the real stylesheets.

**F28a — The pane-height slider did nothing, and F26c explains why it looked right.**
The control set `--stage-height`, which fed `grid-template-rows: minmax(var(--stage-height),
1fr)` on `.layout__main`. That is a genuine floor, and it never bound. `.layout__main` was
`flex: 1` — i.e. `flex-basis: 0` — inside an auto-height flex column, so the row was sized by
its tallest **content**, and the tallest content is the palette. `overflow-y: auto` does not
stop a grid item contributing its full content height: without an explicit `min-height: 0` a
grid item's automatic minimum *is* its content, so the palette both set the row height and
never scrolled internally.

Measured at 1280×813 with the real CSS, before the fix — palette length is the only variable:

| palette items | 40dvh | 80dvh | 100dvh | 150dvh |
|---|---|---|---|---|
| 3  | 717 | 717 | 813 | 1220 |
| 30 | 1066 | 1066 | 1066 | 1220 |
| 80 | 2816 | 2816 | 2816 | 2816 |

So the control worked perfectly on a nearly empty palette and not at all on a real one. The
full SKÅDIS catalog is the 80-item row. **This is why "it works on my machine" was never
going to catch it** — and why F26c's reasoning ("the slider only raises it past the bottom of
the window") was correct about the intent and wrong about the mechanism.

Two fixes, both needed:
- the floor moves onto **flex-basis** (`flex: 1 1 var(--stage-height, 40vh)`), so the row's
  height comes from the window and the slider rather than from content;
- `.palette` and `.cost` get `min-height: 0`, so they stop dictating that height and their
  `overflow-y: auto` finally does something.

After the fix the numbers are identical for a 3-, 30- and 80-item palette. **A visible
consequence, deliberate:** on desktop the side panes now scroll in place instead of the
whole page scrolling. That is what the two `overflow-y: auto` rules were always for, and the
slider cannot work without it.

The **≤900px layout is explicitly excluded** (`flex: 1 1 auto`, `min-height: auto`). Stacked,
the three panes each own a row and the page is supposed to scroll; applying the desktop
basis there would crush all three into one screen. Mobile already worked, through
`.layout__stage { min-height: max(60vh, var(--stage-height, 60vh)) }`, and still does —
verified at 500×713.

**F28b — The Share button never came back.** `share()` set `shareState` to `'copied'` or
`'failed'` and nothing ever set it back to `'idle'`, so the button read "Link copied" for the
rest of the session: a second share gave no feedback, the dropped-custom-parts notice stayed
on screen forever, and a later *failure* could never be seen because the label was already
claiming success. Now a `SHARE_FEEDBACK_MS` timer returns it to idle and clears the notice.

The non-obvious part is the `shareNonce`. Resetting on a `[shareState]` effect alone is
broken for the repeat case: sharing twice leaves `shareState` on `'copied'` **unchanged**, so
the effect does not re-run and the second click silently inherits the first click's
already-expiring timer. A counter bumped on every attempt makes each share start its own
window. Both cases are now covered in `App.test.tsx`.

**F27f — `data-id` is a UUID alias, not the username, and the share token does not exist
until you make it.** Confirmed in counter.dev's source rather than its docs, because the
three values the setup needs are presented in three different places:
- `data-id` in the tracking snippet is a UUID (`counter-trackingcode.js` renders
  `data-id="${uuid}"`; `track.go` resolves it via `UserByCachedUUID`). It is the only value
  the signup flow hands over, and it is what `VITE_COUNTER_DEV_ID` wants.
- The `/dump` share credentials are the **username** and a separate token. The token is
  absent by default: `share-account.js` shows "This account has no guest access" until
  **Share** POSTs `/resettoken`, after which "Copy url" yields
  `?user=<username>&token=<token>`. "Remove" POSTs `/deletetoken` and invalidates it.
- Guest access is **account-wide**, not per-site, which is the second reason the token is a
  GitHub secret rather than a README URL.

Also: one account has one `data-id`, and sites are separated by the **Origin header**
(`Origin2SiteId` in `track.go`), so a Pages project site reports as `<user>.github.io` and
shares a bucket with anything else on that domain. `refresh-visit-count.ts` therefore sums
every site by default, logs the keys it found, and takes `COUNTER_DEV_SITE` to narrow to one.

**F27g — the token has one source, and a hardcoded constant was the wrong second one
(2026-08-23).** `analytics.ts` used to carry `const CONFIGURED_ID = ''` with a TODO inviting
whoever deployed it to paste the token in, with `VITE_COUNTER_DEV_ID` overriding. Both
sources worked; keeping both was the mistake. A token committed to source is inherited by
**every fork**, so anyone who forked a configured build and deployed it would silently
report their visitors into our counter.dev account — their users tracked by a third party
they never chose, our numbers polluted with traffic that isn't ours, and neither side able
to tell. Removed the constant: `VITE_COUNTER_DEV_ID` is now the only source, supplied at
build time by `deploy-pages.yml` from the `COUNTER_DEV_ID` repository variable. GitHub does
not copy repository variables or secrets into forks, so *unconfigured* is what a fork gets
by construction rather than by the forker remembering to blank a line — and F27d's `pv1off`
wording, which is what those builds display, stays true without anyone maintaining it.
`resolveCounterDevId` drops to one argument and the test that pinned "an unset build is
unconfigured" is now a real assertion instead of the tautology it had to be while a
hardcoded value could be baked in behind it.

## F29 — What moving a control teaches you about the code under it (2026-08-22)

Phase 27 was meant to be a pure reshuffle of the top bar. Four things fell out of it that
were not cosmetic.

**F29a — `.cost__refresh` and `.cost__empty` were printing on the build sheet.** The
`@media print` block hides an *explicit list* of selectors — `.toolbar`, `.palette`,
`.layout__stage`, `.layout__footer`, `.cost__table`, `.cost__footer`, `.cost__hint`,
`.cost__status`, `.export`, `.help` — and forces `.cost` itself to `display: block`. Any
element added inside `.cost` since that list was written prints unless someone remembers to
extend it. Two had been: the *Refresh prices* paragraph printed above the diagram in every
non-custom market, and an empty board printed "Nothing on the board yet." Both are
invisible on screen and only show up in a print preview, which is why they survived. The
allow-list shape is the hazard; the fix is to extend it in the same commit that adds any
`.cost__*` child, and the two new rows (`.cost__source`, `.cost__print`) were added along
with the two old leaks.

**F29b — the market select cannot live inside the market guard, and no test said so.** The
refresh button is correctly wrapped in `market !== 'custom'` — the Custom market has no
upstream. Moving the *selector* next to it makes it very natural to put both inside the same
conditional, and that is a one-way door: choosing Custom removes the only control that can
leave it, and the only recovery is clearing localStorage. Two existing tests touched this
area and neither would have failed. `App.test.tsx`'s Custom test only asserted the refresh
button was *gone*, which stays true if the select goes with it; the multi-market loop never
selected `custom` at all. A regression test now switches into Custom, sets a currency, and
switches back out.

**F29c — `OrbitControls.onStart` fires when you grab a placed accessory.** The obvious
reading of `enabled={dragItemKey === null}` is that no accessory drag can produce a camera
event. That holds for a *palette* drag — `pointerdown` lands on the palette button, so
`dragItemKey` is already set by the time the pointer reaches the canvas. It does **not**
hold for a *move* drag: `pointerdown` lands on the mesh, `startMove` runs, but
`OrbitControls` has its own DOM listener on the same canvas and React has not re-rendered
with the new `enabled` value yet, so `three-stdlib` dispatches `startEvent` anyway. The
orbit hint therefore asks the drag store directly — `useDrag.getState().itemKey === null` —
rather than trusting the prop. `onStart` is also dispatched on wheel and touch-start, which
is why one handler honestly covers "drag to orbit · scroll to zoom".

**F29d — an SVG favicon does not cover Safari, and `theme-color` does not follow the app.**
Two limits worth writing down rather than discovering later:
- Safari does not support `rel="icon" type="image/svg+xml"`. It falls back to
  `/favicon.ico`, which is still not shipped, so Safari keeps 404-ing and shows its generic
  placeholder. Covering it needs binary `.ico`/PNG assets and a regeneration step; the
  README checklist item is ticked with that caveat spelled out rather than silently.
- The two-`<meta media="prefers-color-scheme">` pattern that every favicon guide recommends
  tints the browser chrome from the **OS**, not from the app's own Theme select — so a user
  on a light OS who picks Dark in-app would get a light chrome over a dark page. Driving a
  single meta from `applyTheme`, reading `--color-background` off the root, is correct in
  all three states and keeps tokens.css the one source of colour truth. The residual gap is
  the first paint: the meta carries the light default from `index.html` until React mounts
  and `applyTheme` runs, which is the same instant the boot splash is dismissed.

Also of note: `jsdom` has no `matchMedia`, and nothing in the suite had needed it before,
because the only caller (`useThemeTokens`) lives inside `Scene`, which `App.test.tsx` mocks
out. The moment `App` itself asked the OS for a colour preference, 62 tests went red at
once. It is now polyfilled in `src/test/setup.ts` alongside `ResizeObserver` and
`HTMLDialogElement.showModal`, answering "light" — the default every theme assertion in the
suite is already written against.

## F30 — The desktop grid cannot fit between 900 px and ~1022 px (2026-08-23)

Found by measuring, not reading, while checking the Phase 28 toolbar wrap in a headless
Chromium. **Between the 900 px stacking breakpoint and about 1022 px the page scrolls
sideways.** It is a pre-existing defect, unchanged by Phase 27 or 28 — the same widths
were measured against `HEAD` in a scratch worktree and produced byte-identical
`scrollWidth` values (1016 at 1010 px, 1010 at 1000 px, 988 at 960 px, 966 at 920 px,
956 at 901 px).

The cause is arithmetic in `.layout__main`, not content:

```css
grid-template-columns: minmax(180px, 1fr) var(--stage-width, 55%) minmax(280px, 1.15fr);
```

The two side panes have hard minimums that do not shrink, while the middle pane is a
*percentage of the viewport*. So the row needs `180 + 0.55W + 280`, which exceeds `W`
whenever `460 > 0.45W`, i.e. below **W ≈ 1022 px**. Every measured `scrollWidth` above is
exactly `180 + 0.55W + 280`, which is what proves it is the template and not any element
inside `.cost` — the overflowing node is always `section.cost` itself, with its children
merely carried out with it. Widening the middle pane with the Pane width slider makes it
worse, narrowing it makes it better, and neither can close the gap at the default 55%.

The stacking breakpoint sits at 900 px, so it does not rescue the band above it.

**Resolved 2026-08-23 by lowering the side minimums, plus one thing that turned out to be
necessary as well.** Lowering alone is not sufficient, because `--stage-width` is a slider
that goes to 70 %: at `150 + 240 = 390` px of sides the row still would not fit until
about 1233 px at that setting. So the middle track became `minmax(0, var(--stage-width))`
too, which lets it yield the last few pixels rather than push the cost pane off-screen. It
only gives way when the alternative is overflow — measured at 1600 px / 70 % the middle
track is exactly 1120 px, the full 70 %.

```css
grid-template-columns:
  minmax(150px, 1fr)
  minmax(0, var(--stage-width, 55%))
  minmax(240px, 1.15fr);
```

Verified across the full matrix of 12 widths (600–1600 px) × 3 slider settings (30/55/70 %):
no horizontal page overflow in any of the 36 combinations.

**F30a — the fix for one overflow created a worse, quieter one.** With the cost pane's
minimum down at 240 px, the cost table's own intrinsic minimum (~261 px, and the editable
price field is part of why) no longer fit, so `.cost` — which already carries
`overflow-y: auto`, and therefore a computed `overflow-x: auto` — began scrolling
sideways as a whole, dragging the heading and the market selector out of view with the
table. Wrapping the table in a `.cost__scroll` container scopes the scrolling to the table.

But `overflow-x: auto` makes **`overflow-y` compute to `auto` as well**, and `.cost` is a
flex column, so the new wrapper was a flex item that shrank below its content and *clipped
80 px of table rows out of existence* — silently, with no scrollbar anyone would think to
look for, at 1440 px where nothing else was wrong. `flex: 0 0 auto` on the wrapper hands
vertical scrolling back to `.cost`, where it belongs. Measured after: 0 px clipped at every
width, horizontal scroll present only where it is actually needed (47 px at 1024, 53 px at
901, none at 1280 and above).

The general lesson, twice over in one change: **a fix to an overflow is not done until the
new element's *other* axis has been measured too.**

Worth recording separately: **jsdom cannot catch this class of bug at all.** It has no
layout engine, so every `getBoundingClientRect()` in a `@testing-library` test returns
zeroes; the 367-test suite is green at every viewport because it never has one. A real
browser measurement pass is the only thing that sees it.

## F31 — Two `width: Nch` inputs that could not hold their own content (2026-08-23)

Both reported by the user, and both the same bug. `global.css` sets `box-sizing:
border-box` everywhere, and the shared `select, input, button` rule adds
`padding: var(--space-2) var(--space-3)` — 24 px horizontally — plus 2 px of border. So a
declared `width: 6ch` is not six characters of room; it is six characters *minus 26 px*,
which at `--font-size-sm` leaves about 19 px. Two fields were sized that way:

| | was | actual text room | now |
|---|---|---|---|
| `.cost__currency` | `6ch` | ~19 px, under 3 characters | `calc(5.5ch + var(--space-3) * 2 + 2px)` → 75 px box, 49 px text |
| `.cost__input` (price) | `7ch` | ~26 px | `calc(7ch + var(--space-2) * 2 + 2px)` → 80 px box |

`ch` is also the width of the digit `0`, so it under-measures capitals — which is exactly
what a currency code is. `TWD` needs noticeably more than `3ch`.

The price field got two extra changes. Its side padding is `--space-2` rather than the
shared `--space-3`, because it lives in a table cell that has 240 px to spend; and the
number spinners are removed (`appearance: textfield` plus the `::-webkit-*-spin-button`
rules), because they cost about 15 px of a cramped box to offer stepping a price by one
penny. Verified in a real browser: no clipping at `9.99`, `1299.00` or `129000`, and the
committed override reaches the total (`$129,000.00`, "your price" badge shown).

**Anything else that sizes a control in `ch` in this codebase has the same bug.** The rule
is to add the padding back explicitly, as both of these now do.

**A note on browser-driving as verification.** Under software GL with the r3f canvas
rendering every frame, Playwright's actionability checks ("waiting for element to be
visible, enabled and stable") start timing out on elements its own log reports as resolved
and visible, with a stable bounding box measured across 25 consecutive frames. When that
happens the element is fine and the harness is starved: fall back to
`page.evaluate(() => el.click())` and assert the resulting state. Do not read a Playwright
timeout as a UI defect without measuring the element first.

## F32 — A `GITHUB_TOKEN` push does not trigger a workflow (2026-08-23)

`refresh-prices.yml` committed a new `price-snapshot.json` to the default branch and its
header claimed "a price change reaches the site without anyone doing anything." It does not.
GitHub deliberately suppresses workflow triggers for events created with the automatic
`GITHUB_TOKEN` — the anti-recursion rule that stops a committing workflow from starting
itself forever. `workflow_dispatch` and `repository_dispatch` are the only two exempt
events. So the weekly job pushed prices that `deploy-pages.yml` never picked up, and every
step went green while doing it: the snapshot sat in the repo and the deployed bundle kept
serving whatever prices were current at the last human push.

The failure is entirely silent, which is what makes it worth writing down. Nothing errors,
no badge turns red, and the only symptom is a site that is quietly staler than the repo —
in a project where the snapshot is deliberately the *default* price source rather than a
fallback, so nobody would notice from the UI either.

Fixed by dispatching the deploy explicitly (`gh workflow run deploy-pages.yml`) once the
commit step reports it actually pushed, which needs `actions: write` alongside
`contents: write`. The step is gated on a `changed=true` output rather than run
unconditionally, so a week where IKEA's prices held steady still deploys nothing.

`refresh-visit-count.yml` has the same push and does **not** need the same fix: its commit
is README furniture, and `deploy-pages.yml` explicitly `paths-ignore`s `.github/badges/**`
so the badge never redeploys the site (F27's note above). The suppression rule is doing the
right thing there by accident, but the `paths-ignore` is what actually guarantees it.

## F33 — Research for touch controls on the 3D pane (2026-08-23)

Read of the existing code before designing anything. Everything below is from this
repository, not from outside sources.

**F33a — selection, rotate and delete already exist; only movement is missing.**
`ConfigState` already carries `selectedId` with `select(id)`, and `Scene.tsx` already sets it
from `onPointerDown` on a placed mesh and clears it via the Canvas's
`onPointerMissed={() => select(null)}`. `AccessoryMesh` already takes a `selected` prop and
renders differently. The store already exposes `rotate(id)` and `remove(id)`, both routed
through `remember()` so both are undoable. `App.tsx`'s `keydown` handler already binds
`R` → rotate and `Delete`/`Backspace` → remove **against `selectedId`**.

So the touch gap is narrower than it looks: rotate and delete need a *button*, not a
feature. Arrow movement is the only new behaviour, and there is no keyboard equivalent
today either — adding one is a free side effect worth taking.

**F33b — a nudge should be exact, not a re-snap.** The tempting implementation is "take the
body centre, add 40 mm, call `snapOnWall`". It is wrong. `snapPlacement` returns the nearest
*valid* hole to the target, so when the intended neighbour is occupied it silently slides to
some other hole the same distance away — a nudge that moves the item sideways when you press
up. Holes carry `col`/`row` and ids are `holeId(lattice, col, row)`, so the exact neighbour is
a map lookup: `byId.get(holeId(anchor.lattice, col + dc, row + dr))`. Then `evaluatePlacement`
decides. Miss = do nothing. Predictable beats clever here.

**F33c — one lattice step is one `col`/`row` step, and that is already parity-correct.**
Both lattices have 40 mm pitch, so a ±1 step in `col`/`row` stays on the same lattice by
construction. This sidesteps the whole A/B problem: a nudge cannot land a multi-peg accessory
on a mixed-lattice position because it never changes lattice. Rotation is a separate axis and
`rotate()` already handles it.

**F33d — board hopping needs the wall-space fallback, and only there.** Hole ids are
board-relative, so `col ± 1` cannot cross the 8 mm seam between boards. A wall can hold up to
three (`MAX_BOARDS`), so a nudge that dead-ends at a seam would read as broken. Fallback: when
the neighbour id does not exist on this board, convert the intended point to wall space and
call `snapOnWall`, accepting the result **only if** its anchor is within half a pitch of where
we aimed. That keeps F33b's predictability while letting the item cross.

**F33e — the overlay must be DOM, not in-scene.** `.layout__stage` is already
`position: relative`, and `.orbit-hint` is existing precedent for an absolutely-positioned
overlay in it. Real `<button>`s give focus, `aria-label`, theme tokens and 44 px hit targets
for free, and cost the render loop nothing. drei's `Html` would inject the same DOM but
through the scene graph, and a sprite would have to fight `OrbitControls` for the same
pointer. Fixed cluster, not one that follows the object: screen-space tracking would need a
3D→2D projection every frame and would move under the user's thumb as the camera orbits.

**F33f — RISK, must be tested first: `onPointerMissed` may deselect on every button press.**
`Scene.tsx` clears the selection from the Canvas's `onPointerMissed`. If R3F's listener sits
on the container rather than the canvas element, a pointerdown on an overlay button that is a
DOM sibling *inside* that container could clear `selectedId` — which would make every control
in the cluster a one-shot that disables itself. This decides the DOM structure (sibling of
`<Canvas>` vs. outside the R3F container), so it has to be settled before any code is
written, not after.

**F33f-resolved — it is safe, for two independent reasons.** Read of
`@react-three/fiber@9.7.0` (`events-156d8d12.esm.js`, `react-three-fiber.esm.js`):

1. `onPointerMissed` fires **only for click-type events** (`onClick` / `onContextMenu` /
   `onDoubleClick`) that hit nothing, and only when the pointer moved 2 px or less. It does
   not fire on `pointerdown` at all.
2. `<Canvas>` renders its own two nested `<div>`s around the `<canvas>`, and R3F attaches its
   listeners to the inner container — "events to the target's parent ... not on the canvas
   itself", per its own comment. A DOM sibling of `<Canvas>` inside `.layout__stage` is
   therefore outside R3F's listener subtree entirely, and its clicks never reach the handler.

So the overlay goes where `.orbit-hint` already goes: a sibling of `<Canvas>`, not a child.
No `stopPropagation` gymnastics needed. Worth keeping the structural rule in mind though — an
overlay moved *inside* `<Canvas>` (e.g. via drei `Html`) would land inside that subtree and
the deselect-on-tap bug would appear, which is the failure this note exists to prevent.

Second detail from the same read: the `style` prop passed to `<Canvas>` lands on the **outer
wrapper div**, not on the `<canvas>` element — so `touchAction: 'none'` is set on the wrapper,
and `.layout__stage canvas { touch-action: none }` in `app.css` is what covers the element.
The overlay is a sibling of that wrapper and inherits neither.

**F33g — collision data must exclude the item being nudged.** `occupiedRects(wall, placements,
excludeId)` already takes an exclusion argument, used today for `dragMovingId`. A nudge must
pass the selected id, or the item collides with the rect it is currently standing in and every
nudge fails.

**F33h — what a nudge costs in undo.** `move`/`rotate`/`remove` each push a snapshot and
`HISTORY_LIMIT` is 50. Ten taps of an arrow is ten undo steps, so a user who nudges across a
board loses the rest of their history. Worth deciding deliberately rather than discovering:
either accept it, or coalesce consecutive nudges of the same placement into one history entry.

**F33i — the overlay must live in `App.tsx`, not `Scene.tsx`, and the test suite is what
decides it.** `App.test.tsx` does `vi.mock('./components/Scene', ...)` — the whole 3D
component is replaced, because jsdom has no WebGL. Anything rendered inside `Scene.tsx` is
therefore untestable at the app level. `.orbit-hint` already sits in `App.tsx` as a sibling
of `<Scene>` inside `.layout__stage` for the unrelated reason that Reset view remounts the
canvas; the same slot gives the new controls real coverage in the existing suite and means
`Scene.tsx` is not edited at all, so the drag/snap path carries zero risk.

**F33j — touch selection already works; only the verbs were missing.** Tapping a placed mesh
fires `onPointerDown` → `select(id)` + `startMove(...)`. A tap that never moves leaves
`hoverHoleId` null, so `handleDrop` falls through to `endDrag()` and commits nothing — the tap
reads as a pure select. Tapping the background is a click that hits nothing, which is exactly
what `onPointerMissed` wants. So no new selection mechanism is needed for touch.

**F33k — no persisted-state change, so no store version bump.** A nudge is
`move(id, holeId, rotation, boardIndex)`, which already exists and is already undoable.
Rotate and delete already exist too. Nothing new is persisted, `Placement` keeps its shape,
and `migrateConfig` is untouched — `version: 9` stands. This is the single biggest reason the
change is low-risk: it adds a new way to call three existing, tested actions.

## F34 — Why the palette is unusable on a phone (2026-08-23)

Two complaints from real touch use, both traced to code rather than guessed at.

**F34a — `touch-action: none` on `.palette__item` is what stops the page scrolling.**
`app.css:353` sets it, which tells the browser "this element handles every touch gesture
itself". It is there so a finger drag onto the board produces `pointermove` instead of a
scroll. The cost is total: a finger that lands on a palette item can never scroll, and since
the items are a dense list filling most of the pane, most of the pane is unscrollable.

Worse on a phone than the desktop reasoning assumed. Under `@media (max-width: 900px)` the
palette is `min-height: auto` and **the page** scrolls, not the pane — so the dead zone is not
a pane that refuses to scroll, it is the whole document refusing to scroll while your finger
is over the list.

**F34b — and on a phone the drag it protects cannot work anyway.** The same media query sets
`.layout__stage { order: -1 }`, putting the board *above* the palette. So dragging an
accessory to the board is a drag upward — a vertical gesture, exactly the one that has to
become a scroll if the page is to scroll at all. The two requirements are in direct conflict
on a stacked layout, and `touch-action: none` resolves it in favour of a drag that is already
awkward on a small screen.

The resolution: `touch-action: pan-y`. The browser owns vertical panning, so the page scrolls;
horizontal movement still produces pointer events, so drag survives wherever the board is
*beside* the palette (desktop and landscape tablets). `touch-action` does not affect mouse
input at all, so desktop is untouched. On a phone, dragging to the board is given up
deliberately, and replaced by F34c.

**F34c — the auto-place path already exists; it has no button.** `App.quickPlace(itemKey)`
snaps the item to the middle of the wall and slides to the nearest free slot with the same
`snapOnWall` the pointer uses, then calls `place()`. It is wired only to `Enter`/`Space` on a
palette item, for keyboard users. Exposing it as a visible **+** is nearly free, and gives
touch users a placement path that needs no drag at all.

Two gaps to close while doing it:
- It fails **silently** when nothing fits — `if (snap?.result.ok)` and no else. Fine as an
  invisible keyboard affordance, not fine as a button someone taps twice and then wonders about.
- The **+** must be a sibling button, not part of the draggable item, or its `pointerdown`
  starts a drag. `.palette__custom-row` already has exactly that shape with its Edit button.

**F34d — "allow overlap" is a persisted preference, so it costs a store version.** The
occupancy check is what makes a nudge refuse, so an item can be walled in with no way to move
it past a neighbour to where the user wants it. A permissive mode fixes that. It belongs with
`theme` / `viewRatio` / `viewHeight` / `printAngle`: persisted, **not** shared, not undoable —
a share link must never hand a recipient a relaxed rule set. Adding it means `version: 10`, a
`migrateConfig` step, and a `store.test.ts` case, per the standing rule.

It must relax **only body overlap**. Every peg still has to land in a real slot: that is
physics, not policy, and `evaluatePlacement` treats the two separately already
(`peg-off-board` vs `overlap`), so the split is free.

And it has to apply to **every** placement path — nudge, drag and quick-place — or the rules
differ by input device, which is the exact inconsistency `placements.ts` was written to end
("Same question, one answer"). All three already compute an occupied list; the flag chooses
between that list and an empty one.

**F34e — the toggle goes in the Palette, not the Toolbar.** The toolbar's second row was the
subject of F30 and F31 — it overflows below ~1022 px and was only just stabilised. Adding a
control there without a browser to measure in would be re-opening a closed bug on a guess. The
palette is a vertically scrolling pane with room to spare, and it is already where the
placement rules are explained (`palette.hint`). Cheaper to move later than to unbreak a layout.

## F35 — The display shelf hangs on eight pitches, not seven (2026-08-23)

Raised as "the display shelf looks like nine pegs wide". Re-checked against IKEA, and the
**published dimensions were already right — the peg pattern was not.**

**F35a — the dimensions are confirmed, twice over.** `sik.search…` gives no measurements
for this article, so the PIP page was read directly. GB (metric) returns
`Width 32 cm, Depth 11 cm`; US returns `12 5/8 "` × `4 3/8 "` = 320.7 × 111 mm. That is
exactly what `catalog.ts` carries, and `data-raw/skadis-raw.json` agrees. **No height is
published in any market** — the 40 mm in `dims` remains a visual estimate, and measures
≈43 mm off the photograph below, which is inside the error of a 46 px/40 mm image.

- `https://www.ikea.com/gb/en/p/skadis-display-shelf-white-20591841/`

**F35b — the product is a tray on two end brackets, and the brackets are at the ends.**
IKEA's straight-on photograph `1359199_pe954114` shows the shelf on a 36×56 board. Detecting
the dark slots by pixel column gives a pitch of 46.06 px = 40 mm, nine hole columns in the
bracket row (622 → 990 px = 320 mm — the A-lattice row of a 36 board, per the table in
CLAUDE.md), and **both brackets hooked into the outermost two**. Eight pitches, hook to hook,
tray running the full 320 mm between them.

The catalog had `hanging(320, 40, 7)`: hooks 280 mm apart with the body overhanging 20 mm at
each end. Self-consistent, wrong, and the same class of error as the F7→F8 lattice
correction — derived from the width instead of read off the photograph.

**F35c — the rule this establishes.** SKÅDIS hooks always land on 40 mm multiples, so where
a body's width **is** an exact multiple of 40 the hooks sit at its ends and the body spans
`w / 40` pitches with zero overhang. Where it is not — the 345 mm storage basket, the 75 mm
container — the span is the largest multiple that fits and the overhang is the remainder.
`hanging()` already encodes that; only the pitch count was wrong.

`display-shelf` is now `patternEstimated: false` — this one is measured, not inferred. Note
that `hanging()` now normalises `-0` out of `bodyOffset[0]`, which only ever appeared once a
body exactly matched its peg span.

**F35d — the plain shelf is NOT resolved.** 280 mm is also an exact multiple of 40, so F35c
predicts seven pitches where the catalog carries six. Every photograph of it is three-quarter
view or too small to separate the two candidates (measured shadow span 286.6 mm against a
361 mm-wide board, which fits both), so it is **left alone**: changing it would be swapping a
guess for a guess. Needs a physical part or a straight-on shot.

## F36 — The storage basket set of 3 is three different sizes (2026-08-23)

`basket-set-3` (US/GB `50517760`, JP `10517762`) was modelled as an unmeasured cost-only
bundle. It is not: IKEA publishes the contents on the product page, under
*Complementary info measurements*, identically in GB and JP:

```
Sizes: 24x8x21 cm, 12x7x13 cm and 12x6x5 cm.
サイズ：24×8×21cm、12×7×13cm、12×6×5cm
```

Width × depth × height, confirmed against the mounted photograph `1120803_pe874450`
(pitch 105.7 px = 40 mm): the large basket measures 632 px = 239 mm across and 560 px =
212 mm tall. The description calls them "organisers in three different sizes… pockets in
metal mesh", which is the `basket` archetype we already have.

**F36a — the large basket's hooks are at its ends, six pitches apart.** Same method as F35b,
on the same photograph: hole columns align with both ends of the 240 mm rim. The two 120 mm
baskets are three pitches by F35c but are too small to read off the image, so they stay
`patternEstimated: true`.

**F36b — none of the three has an article number, so none can be a cost line.** IKEA sells
no size on its own. Modelled as `kitKey: 'basket-set-3'` on `BaseItem`: the member is
placeable, drawn and snapped like any accessory, and carries `itemNos: {}`.

**F36c — the pack maths is `max`, not `sum`.** One set yields one of EVERY size, so a wall
with a large, a medium and a small needs **one** set, not three. `foldKits()` in
`lib/pricing.ts` collapses members into the pack at `max(member counts)`, and adds whatever
the user asked for by hand under the pack's own key on top — that is a separate intent.
Summing would be the F6a pack-quantity bug in reverse: over-ordering by 3× instead of
under-ordering.

The fold happens in `CostTable` **before** `excluded` is read, so the checkbox and the price
override belong to the pack the user actually buys. `buildCostLines` is deliberately left
dumb about kits; what guarantees a member can never be silently costed is that it resolves
to `source: 'unknown'`, never to zero.

**F36d — what this cost in tests.** Three catalog tests assert SKU coverage over the whole
catalog (`carries a number for every item in every Western market`, `names exactly the items
Japan does not sell`) — they now filter kit members out through `isKitMember`, with a new
test asserting the members have no numbers and point at a real, purchasable pack. The
palette gained three rows, which pushed the 12-iteration custom-part cap test past the
default 5 s vitest budget; its timeout is now stated explicitly rather than left to be
tripped by the next catalog addition.
