#!/usr/bin/env python3
"""
SKÅDIS data extraction tool for the Pegboard project.

Fetches SKÅDIS SKU listings from IKEA's search API for us/en, gb/en, jp/ja,
de/de and fr/fr, fetches real product dimensions (metric, from gb/en PIP
pages), and proposes JP/DE/FR -> US/GB SKU matches.

JP's pipUrl slugs are in English, so JP matches gb by pipUrl slug, disambiguated
by dimensions when a slug maps to more than one gb candidate (see
match_jp_to_gb below -- unchanged from the original us/gb/jp version of this
script).

DE and FR pipUrl slugs are in German/French (NOT English -- e.g. gb's
'skadis-hook-white' is de's 'skadis-haken-weiss'), so slug-string matching
against gb doesn't apply directly. Investigation of the live catalogue (see
data-raw notes) found DE/FR instead share IKEA's global numeric item id with
gb/us for effectively every SKU currently sold in all four markets, so DE/FR
matching uses id-exact matching as the primary (highest-confidence) tier, with
slug-match and a dimension-based full-catalogue fallback (using the
language-independent "type" measurement code, e.g. "00047" = Width) for any
id that doesn't appear in gb -- see match_by_id_then_dims below.

Regenerate the output with:
    python3 data-raw/fetch_skadis_data.py

Writes: data-raw/skadis-raw.json
"""
import json
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import date

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

SEARCH_URL = ("https://sik.search.blue.cdtapps.com/{loc}/search-result-page"
              "?types=PRODUCT&q=skadis&size=100&c=sr&v=20210322")

MARKETS = {
    "us": {"locale": "us/en", "currency": "USD"},
    "gb": {"locale": "gb/en", "currency": "GBP"},
    "jp": {"locale": "jp/ja", "currency": "JPY"},
    "de": {"locale": "de/de", "currency": "EUR"},
    "fr": {"locale": "fr/fr", "currency": "EUR"},
}

MEASUREMENTS_RE = re.compile(r'"measurements":(\[\{"measure".*?\])')
SLUG_ID_RE = re.compile(r'/p/(.+)-(\d{8})/?$')

# JP measurement names come back in Japanese; translate the handful of
# labels IKEA uses for SKÅDIS products so dimension-based matching against
# gb/en (English) measurements works.
JA_MEASUREMENT_NAME_EN = {
    "幅": "Width",
    "高さ": "Height",
    "奥行き": "Depth",
    "長さ": "Length",
    "直径": "Diameter",
    "重さ": "Weight",
    "厚さ": "Thickness",
    "パッケージ個数": "Package quantity",
}


def translate_measure_name(name):
    return JA_MEASUREMENT_NAME_EN.get(name, name)


# DE/FR measurement-name translations, for readability in evidence strings
# only (actual DE/FR<->gb dimension matching uses the language-independent
# "type" code, e.g. "00047", not these names -- see dims_signature_by_type).
# Width/Height/Depth/Length/Package quantity confirmed against live SKÅDIS
# product pages on 2026-08-18; Diameter/Weight/Thickness are best-effort
# (no SKÅDIS product currently published those measurements to verify against).
DE_MEASUREMENT_NAME_EN = {
    "Breite": "Width",
    "Höhe": "Height",
    "Tiefe": "Depth",
    "Länge": "Length",
    "Durchmesser": "Diameter",
    "Gewicht": "Weight",
    "Dicke": "Thickness",
    "Anzahl pro Verpackung": "Package quantity",
}

FR_MEASUREMENT_NAME_EN = {
    "Largeur": "Width",
    "Hauteur": "Height",
    "Profondeur": "Depth",
    "Longueur": "Length",
    "Diamètre": "Diameter",
    "Poids": "Weight",
    "Épaisseur": "Thickness",
    "Quantité/paquet": "Package quantity",
}

MEASUREMENT_NAME_TRANSLATORS = {
    "jp": translate_measure_name,
    "de": lambda name: DE_MEASUREMENT_NAME_EN.get(name, name),
    "fr": lambda name: FR_MEASUREMENT_NAME_EN.get(name, name),
}


def http_get(url, retries=1, sleep_between_retries=2.0):
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retries:
                print(f"  ! fetch failed ({e}), retrying...", file=sys.stderr)
                time.sleep(sleep_between_retries)
    raise last_err


def fetch_search(locale):
    url = SEARCH_URL.format(loc=locale)
    raw = http_get(url, retries=1)
    return json.loads(raw)


def extract_skus(search_json):
    """Keep entries where product.name's first word is exactly 'SKÅDIS'
    (handles JP's 'SKÅDIS スコーディス' transliteration suffix), excluding
    combo listings (name contains '/'), and id does NOT start with 's'
    (pre-made combination bundles)."""
    items = search_json["searchResultPage"]["products"]["main"]["items"]
    out = []
    for it in items:
        p = it.get("product", {})
        name = p.get("name", "")
        pid = p.get("id", "")
        if not name or not pid:
            continue
        if "/" in name:
            continue
        first_word = name.split(" ")[0]
        if first_word != "SKÅDIS":
            continue
        if pid.lower().startswith("s"):
            continue
        sales_price = p.get("salesPrice") or {}
        out.append({
            "id": pid,
            "typeName": p.get("typeName", ""),
            "name": name,
            "price": sales_price.get("numeral"),
            "currency": sales_price.get("currencyCode"),
            "pipUrl": p.get("pipUrl"),
            "itemMeasureReferenceText": p.get("itemMeasureReferenceText", ""),
            "colors": p.get("colors"),
        })
    return out


def slug_from_pip_url(pip_url):
    """Return (slug-without-id, id) from a pipUrl, e.g.
    'https://www.ikea.com/gb/en/p/skadis-hook-white-50335618/'
    -> ('skadis-hook-white', '50335618')"""
    if not pip_url:
        return None, None
    m = SLUG_ID_RE.search(pip_url)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def fetch_product_measurements(pip_url, sleep_sec=1.0):
    """Fetch a PIP page and extract the PRODUCT measurements blob
    (NOT the package measurementGroups blob). Returns a list of
    {"name":..., "measure":...} dicts, de-duplicated, or [] if none found."""
    html = http_get(pip_url, retries=1)
    time.sleep(sleep_sec)
    matches = MEASUREMENTS_RE.findall(html)
    seen_blobs = []
    seen_set = set()
    for m in matches:
        if m in seen_set:
            continue
        seen_set.add(m)
        try:
            parsed = json.loads(m)
        except json.JSONDecodeError:
            continue
        if parsed:  # skip empty "measurements":[] occurrences
            seen_blobs.append(parsed)
    # De-duplicate at the (name, measure) pair level across blobs too,
    # in case the same block appears more than once verbatim.
    pair_seen = set()
    result = []
    for blob in seen_blobs:
        for entry in blob:
            key = (entry.get("name"), entry.get("measure"))
            if key in pair_seen:
                continue
            pair_seen.add(key)
            # "type" is IKEA's internal measurement-kind code (e.g. "00047" =
            # Width, "00041" = Height, "00061" = Package quantity) and is the
            # same across every market/language -- it's a more reliable
            # cross-market join key than the localized "name" string.
            result.append({
                "name": entry.get("name"),
                "measure": entry.get("measure"),
                "type": entry.get("type"),
            })
    return result


def dims_signature(measures):
    """Extract a comparable set of (name, measure) pairs, excluding
    Package quantity (which differs by market packaging, not by dimension).
    Names are translated (JA->EN) first so cross-market comparison works."""
    return frozenset(
        (translate_measure_name(m["name"]), m["measure"]) for m in measures
        if m["name"] and translate_measure_name(m["name"]).lower() != "package quantity"
    )


PACKAGE_QUANTITY_TYPE = "00061"


def dims_signature_by_type(measures):
    """Like dims_signature, but keyed on IKEA's language-independent "type"
    code instead of a translated name. Used for DE/FR matching, where the
    market's own measurement names are in German/French and slug strings
    aren't in English (so translation tables would be the weak link;
    the type code isn't). Falls back to skipping entries with no type."""
    return frozenset(
        (m["type"], m["measure"]) for m in measures
        if m.get("type") and m["type"] != PACKAGE_QUANTITY_TYPE
    )


# Minimum number of overlapping (type, measure) dimension pairs required
# before trusting a dimension-only match found via the tier-C fallback below.
# Requiring >=2 avoids treating an accidental single-dimension coincidence
# (e.g. two unrelated products both being "6 cm" in one axis) as a match.
MIN_DIMENSION_OVERLAP_FOR_LOW_CONFIDENCE = 2


def match_by_id_then_dims(market_key, market_skus, gb_skus, gb_by_slug, gb_ids, us_ids, dimensions):
    """Match a market's SKUs to gb (and, transitively, us) SKUs.

    Tier A: identical numeric IKEA item id present in gb -- this is the
    strongest possible signal (same global item number) and is how nearly
    every DE/FR SKU maps to gb/us, since IKEA's item numbers are shared
    globally for currently-sold SKÅDIS products (verified against live
    us/gb/de/fr data on 2026-08-18; see report).

    Tier B: pipUrl slug matches a gb slug (works if the market's pipUrl
    happens to be in English, as JP's is; for DE/FR this tier will
    typically find zero candidates since DE/FR slugs are localized, but is
    kept for robustness/free coverage of any future English-slug case).

    Tier C: no id or slug hit -- fall back to a full-catalogue dimension
    search across ALL gb SKUs, matched via the language-independent "type"
    measurement code. Only ever yields "low" confidence, and only when the
    best candidate clears MIN_DIMENSION_OVERLAP_FOR_LOW_CONFIDENCE; anything
    weaker is left "unmatched" rather than guessed.
    """
    gb_by_id = {s["id"]: s for s in gb_skus}
    translator = MEASUREMENT_NAME_TRANSLATORS.get(market_key, lambda name: name)
    dims_cache = {}
    matches = []
    matched_gb_ids = set()

    for i, s in enumerate(market_skus):
        mid = s["id"]
        slug, _sid = slug_from_pip_url(s["pipUrl"])
        print(f"[{i+1}/{len(market_skus)}] {market_key.upper()} {mid} slug={slug!r} typeName={s['typeName']!r}")

        chosen = None
        confidence = "unmatched"
        evidence = ""

        if mid in gb_ids:
            chosen = gb_by_id[mid]
            confidence = "high"
            evidence = (f"identical global item id '{mid}' present in gb catalogue "
                        f"(id-exact match; strongest available signal)")
        else:
            candidates = gb_by_slug.get(slug, [])
            if len(candidates) == 1:
                chosen = candidates[0]
                confidence = "high"
                evidence = f"no id match, but unique pipUrl slug match '{slug}' against gb catalogue"
            elif len(candidates) > 1:
                try:
                    m_measures = fetch_product_measurements(s["pipUrl"], sleep_sec=1.0)
                except Exception as e:  # noqa: BLE001
                    print(f"  ! {market_key} fetch failed: {e}", file=sys.stderr)
                    m_measures = []
                for m in m_measures:
                    m["nameEn"] = translator(m["name"])
                dims_cache[mid] = {"measures": m_measures}
                m_sig = dims_signature_by_type(m_measures)
                best = None
                best_overlap = -1
                for cand in candidates:
                    cand_sig = dims_signature_by_type(dimensions.get(cand["id"], {}).get("measures", []))
                    overlap = len(m_sig & cand_sig)
                    if overlap > best_overlap:
                        best_overlap = overlap
                        best = cand
                if best is not None and best_overlap >= MIN_DIMENSION_OVERLAP_FOR_LOW_CONFIDENCE:
                    chosen = best
                    confidence = "high"
                    evidence = (f"slug '{slug}' ambiguous ({len(candidates)} gb candidates), "
                                f"disambiguated by {best_overlap} matching dimension pair(s)")
                else:
                    confidence = "low"
                    evidence = (f"slug '{slug}' ambiguous ({len(candidates)} gb candidates: "
                                f"{[c['id'] for c in candidates]}), insufficient dimension overlap "
                                f"(best={best_overlap}); NOT auto-resolved")
            else:
                # No id and no slug candidates: fall back to a full-catalogue
                # dimension search. Only used for SKUs IKEA didn't reuse a
                # global id for (rare in practice for DE/FR).
                try:
                    m_measures = fetch_product_measurements(s["pipUrl"], sleep_sec=1.0)
                except Exception as e:  # noqa: BLE001
                    print(f"  ! {market_key} fetch failed: {e}", file=sys.stderr)
                    m_measures = []
                for m in m_measures:
                    m["nameEn"] = translator(m["name"])
                dims_cache[mid] = {"measures": m_measures}
                m_sig = dims_signature_by_type(m_measures)
                if m_sig:
                    best = None
                    best_overlap = -1
                    for cand in gb_skus:
                        cand_sig = dims_signature_by_type(dimensions.get(cand["id"], {}).get("measures", []))
                        overlap = len(m_sig & cand_sig)
                        if overlap > best_overlap:
                            best_overlap = overlap
                            best = cand
                    if best is not None and best_overlap >= MIN_DIMENSION_OVERLAP_FOR_LOW_CONFIDENCE:
                        chosen = best
                        confidence = "low"
                        evidence = (f"no id or slug match for '{slug}'; best-effort full-catalogue "
                                    f"dimension search found gb id {best['id']} with {best_overlap} "
                                    f"matching dimension pair(s) -- verify manually before trusting")
                    else:
                        evidence = (f"no gb SKU shares id or slug '{slug}'; full-catalogue dimension "
                                    f"search found no adequately-confident candidate (best overlap={best_overlap})")
                else:
                    evidence = (f"no gb SKU shares id or slug '{slug}'; no measurement data available "
                                f"to attempt dimension matching -- likely a SKU gb/us don't currently sell")

        gb_id = chosen["id"] if chosen else None
        if gb_id:
            matched_gb_ids.add(gb_id)
        us_id = gb_id if gb_id in us_ids else None

        matches.append({
            f"{market_key}Id": mid,
            "gbId": gb_id,
            "usId": us_id,
            "confidence": confidence,
            "evidence": evidence,
            f"{market_key}TypeName": s["typeName"],
            f"{market_key}PipUrl": s["pipUrl"],
        })

    return matches, dims_cache, matched_gb_ids


def main():
    print("=== Step 1: fetching search results per market ===")
    markets_out = {}
    raw_skus = {}
    for key, info in MARKETS.items():
        print(f"Fetching {key} ({info['locale']})...")
        sj = fetch_search(info["locale"])
        skus = extract_skus(sj)
        raw_skus[key] = skus
        markets_out[key] = {
            "locale": info["locale"],
            "currency": info["currency"],
            "skus": [
                {
                    "id": s["id"],
                    "typeName": s["typeName"],
                    "price": s["price"],
                    "pipUrl": s["pipUrl"],
                    "itemMeasureReferenceText": s["itemMeasureReferenceText"],
                    "colors": s["colors"],
                }
                for s in skus
            ],
        }
        print(f"  -> {len(skus)} SKÅDIS SKUs")
        time.sleep(1)

    print("\n=== Step 2: fetching gb/en product dimensions ===")
    dimensions = {}
    gb_skus = raw_skus["gb"]
    for i, s in enumerate(gb_skus):
        pip_url = s["pipUrl"]
        print(f"[{i+1}/{len(gb_skus)}] {s['id']} {s['typeName']!r} -> {pip_url}")
        try:
            measures = fetch_product_measurements(pip_url, sleep_sec=1.0)
        except Exception as e:  # noqa: BLE001
            print(f"  ! FAILED after retry: {e}", file=sys.stderr)
            measures = []
        if not measures:
            print("  ! no product-level measurements found (only package-level, or none published)")
        dimensions[s["id"]] = {"measures": measures}

    print("\n=== Step 3: matching JP SKUs to US/GB SKUs ===")
    jp_skus = raw_skus["jp"]

    # Build slug index for gb (source of truth for matching, since gb has
    # metric dims and pipUrl slugs are in English on all locales).
    gb_by_slug = {}
    for s in gb_skus:
        slug, _id = slug_from_pip_url(s["pipUrl"])
        gb_by_slug.setdefault(slug, []).append(s)

    us_by_id = {s["id"]: s for s in raw_skus["us"]}
    # us doesn't share ids with gb necessarily -- check overlap
    us_ids = set(us_by_id.keys())
    gb_ids = set(s["id"] for s in gb_skus)
    print(f"us/gb id overlap: {len(us_ids & gb_ids)} of us={len(us_ids)} gb={len(gb_ids)}")

    jp_dimensions_cache = {}
    jp_matches = []
    matched_gb_ids = set()

    for j, s in enumerate(jp_skus):
        jp_id = s["id"]
        jp_slug, _jid = slug_from_pip_url(s["pipUrl"])
        print(f"[{j+1}/{len(jp_skus)}] JP {jp_id} slug={jp_slug!r} typeName={s['typeName']!r}")

        candidates = gb_by_slug.get(jp_slug, [])
        chosen = None
        confidence = "unmatched"
        evidence = ""

        if len(candidates) == 1:
            chosen = candidates[0]
            # still worth confirming via itemMeasureReferenceText if present
            if s["itemMeasureReferenceText"] and chosen["itemMeasureReferenceText"]:
                if s["itemMeasureReferenceText"].strip() == chosen["itemMeasureReferenceText"].strip():
                    confidence = "high"
                    evidence = f"unique slug match '{jp_slug}', itemMeasureReferenceText matches ({s['itemMeasureReferenceText']})"
                else:
                    confidence = "high"
                    evidence = (f"unique slug match '{jp_slug}' (itemMeasureReferenceText differs: "
                                f"jp={s['itemMeasureReferenceText']!r} gb={chosen['itemMeasureReferenceText']!r}, "
                                f"likely unit/format difference, slug uniqueness is strong evidence)")
            else:
                confidence = "high"
                evidence = f"unique slug match '{jp_slug}' (no reference-text to cross-check, but slug is unique in gb catalogue)"
        elif len(candidates) > 1:
            # Need to disambiguate via measurements. Fetch JP product page.
            try:
                jp_measures = fetch_product_measurements(s["pipUrl"], sleep_sec=1.0)
            except Exception as e:  # noqa: BLE001
                print(f"  ! JP fetch failed: {e}", file=sys.stderr)
                jp_measures = []
            for m in jp_measures:
                m["nameEn"] = translate_measure_name(m["name"])
            jp_dimensions_cache[jp_id] = {"measures": jp_measures}
            jp_sig = dims_signature(jp_measures)

            best = None
            best_overlap = -1
            for cand in candidates:
                cand_measures = dimensions.get(cand["id"], {}).get("measures", [])
                cand_sig = dims_signature(cand_measures)
                overlap = len(jp_sig & cand_sig)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best = cand
            if best is not None and best_overlap > 0:
                chosen = best
                confidence = "high"
                evidence = (f"slug '{jp_slug}' ambiguous ({len(candidates)} gb candidates), "
                            f"disambiguated by {best_overlap} matching dimension pair(s): "
                            f"{sorted(jp_sig & dims_signature(dimensions.get(best['id'], {}).get('measures', [])))}")
            elif s["itemMeasureReferenceText"]:
                # fall back to itemMeasureReferenceText match among candidates
                for cand in candidates:
                    if cand["itemMeasureReferenceText"].strip() == s["itemMeasureReferenceText"].strip():
                        chosen = cand
                        confidence = "high"
                        evidence = (f"slug '{jp_slug}' ambiguous ({len(candidates)} gb candidates), "
                                    f"disambiguated by matching itemMeasureReferenceText "
                                    f"'{s['itemMeasureReferenceText']}'")
                        break
                if chosen is None:
                    confidence = "low"
                    evidence = (f"slug '{jp_slug}' ambiguous ({len(candidates)} gb candidates: "
                                f"{[c['id'] for c in candidates]}), no dimension or reference-text overlap found; "
                                f"jp measures={jp_measures}")
            else:
                confidence = "low"
                evidence = (f"slug '{jp_slug}' ambiguous ({len(candidates)} gb candidates: "
                            f"{[c['id'] for c in candidates]}), no distinguishing dimension data; "
                            f"jp measures={jp_measures}")
        else:
            confidence = "unmatched"
            evidence = f"no gb SKU shares slug '{jp_slug}'"

        gb_id = chosen["id"] if chosen else None
        if gb_id:
            matched_gb_ids.add(gb_id)

        # Map gb id -> corresponding us id if the catalogues share ids;
        # otherwise report the gb id (us often shares ids with gb for skadis).
        us_id = gb_id if gb_id in us_ids else None

        jp_matches.append({
            "jpId": jp_id,
            "gbId": gb_id,
            "usId": us_id,
            "confidence": confidence,
            "evidence": evidence,
            "jpTypeName": s["typeName"],
            "jpPipUrl": s["pipUrl"],
        })

    gb_all_ids = set(s["id"] for s in gb_skus)
    unmatched_gb = sorted(gb_all_ids - matched_gb_ids)
    unmatched_us = sorted(set(us_ids) & set(unmatched_gb))
    unmatched_jp = sorted(m["jpId"] for m in jp_matches if m["confidence"] == "unmatched")

    print("\n=== Step 4: matching DE/FR SKUs to US/GB SKUs ===")
    de_matches, de_dimensions_cache, de_matched_gb_ids = match_by_id_then_dims(
        "de", raw_skus["de"], gb_skus, gb_by_slug, gb_ids, us_ids, dimensions)
    fr_matches, fr_dimensions_cache, fr_matched_gb_ids = match_by_id_then_dims(
        "fr", raw_skus["fr"], gb_skus, gb_by_slug, gb_ids, us_ids, dimensions)

    unmatched_de = sorted(m["deId"] for m in de_matches if m["confidence"] == "unmatched")
    unmatched_fr = sorted(m["frId"] for m in fr_matches if m["confidence"] == "unmatched")
    gb_only_vs_de = sorted(gb_all_ids - de_matched_gb_ids)
    gb_only_vs_fr = sorted(gb_all_ids - fr_matched_gb_ids)

    output = {
        "capturedAt": str(date.today()),
        "markets": markets_out,
        "dimensions": dimensions,
        "jpDimensions": jp_dimensions_cache,
        "jpMatches": jp_matches,
        "deDimensions": de_dimensions_cache,
        "deMatches": de_matches,
        "frDimensions": fr_dimensions_cache,
        "frMatches": fr_matches,
        "unmatched": {
            "jpOnly": unmatched_jp,
            "usOnly": unmatched_us,
            "gbOnly": unmatched_gb,
            "deOnly": unmatched_de,
            "frOnly": unmatched_fr,
            "gbOnlyVsDe": gb_only_vs_de,
            "gbOnlyVsFr": gb_only_vs_fr,
        },
    }

    out_path = "/home/ai-runner/pegboard/data-raw/skadis-raw.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {out_path}")

    # ---- summary table ----
    print("\n=== US SKU summary ===")
    header = f"{'id':<10} {'typeName':<20} {'price':<10} {'pack':<10} dims"
    print(header)
    print("-" * len(header))
    for s in raw_skus["us"]:
        dim_entry = dimensions.get(s["id"])
        pack = "-"
        dims_str = "NO DIMS"
        if dim_entry:
            measures = dim_entry["measures"]
            dims_parts = []
            for m in measures:
                if m["name"] and m["name"].lower() == "package quantity":
                    pack = m["measure"]
                else:
                    dims_parts.append(f"{m['name']}={m['measure']}")
            dims_str = ", ".join(dims_parts) if dims_parts else "(none)"
        else:
            dims_str = "NO gb ID MATCH (us id not present in gb dataset)"
        price = f"{s['price']} {s['currency']}" if s["price"] is not None else "-"
        print(f"{s['id']:<10} {s['typeName']:<20} {price:<10} {pack:<10} {dims_str}")

    def confidence_counts(match_list):
        return (
            sum(1 for m in match_list if m["confidence"] == "high"),
            sum(1 for m in match_list if m["confidence"] == "low"),
            sum(1 for m in match_list if m["confidence"] == "unmatched"),
        )

    n_high, n_low, n_unmatched = confidence_counts(jp_matches)
    print(f"\nJP matches: {len(jp_matches)} total -> high={n_high} low={n_low} unmatched={n_unmatched}")
    de_h, de_l, de_u = confidence_counts(de_matches)
    print(f"DE matches: {len(de_matches)} total -> high={de_h} low={de_l} unmatched={de_u}")
    fr_h, fr_l, fr_u = confidence_counts(fr_matches)
    print(f"FR matches: {len(fr_matches)} total -> high={fr_h} low={fr_l} unmatched={fr_u}")

    # ---- counts table (matched against gb/us as applicable) ----
    print("\n=== Per-market SKU counts and match confidence ===")
    counts_header = f"{'market':<8} {'SKUs':>6} {'high':>6} {'low':>6} {'unmatched':>10}"
    print(counts_header)
    print("-" * len(counts_header))
    print(f"{'us':<8} {len(raw_skus['us']):>6} {'-':>6} {'-':>6} {'-':>10}")
    print(f"{'gb':<8} {len(raw_skus['gb']):>6} {'-':>6} {'-':>6} {'-':>10}")
    print(f"{'de':<8} {len(raw_skus['de']):>6} {de_h:>6} {de_l:>6} {de_u:>10}")
    print(f"{'fr':<8} {len(raw_skus['fr']):>6} {fr_h:>6} {fr_l:>6} {fr_u:>10}")
    print(f"{'jp':<8} {len(raw_skus['jp']):>6} {n_high:>6} {n_low:>6} {n_unmatched:>10}")

    # ---- GB/DE/FR vs US item-number cross-check ----
    print("\n=== Item-number-vs-US cross-check ===")
    gb_shares_all_us = gb_ids == us_ids
    print(f"gb ids == us ids exactly: {gb_shares_all_us} (gb={len(gb_ids)} us={len(us_ids)} "
          f"shared={len(gb_ids & us_ids)}, gb-only={sorted(gb_ids - us_ids)}, us-only={sorted(us_ids - gb_ids)})")

    de_ids = set(s["id"] for s in raw_skus["de"])
    fr_ids = set(s["id"] for s in raw_skus["fr"])
    for label, ids in (("de", de_ids), ("fr", fr_ids)):
        shared = ids & us_ids
        print(f"{label} ids vs us: shared={len(shared)}/{len(ids)}, "
              f"{label}-only (no us id match)={sorted(ids - us_ids)}, "
              f"us-only (us SKU absent from {label})={sorted(us_ids - ids)}")

    # ---- sample rows per market ----
    print("\n=== Sample SKUs per market (5 each) ===")
    for mkey in ("us", "gb", "de", "fr", "jp"):
        print(f"-- {mkey} --")
        sample_header = f"{'id':<10} {'typeName':<28} price"
        print(sample_header)
        for s in raw_skus[mkey][:5]:
            price = f"{s['price']} {s['currency']}" if s["price"] is not None else "-"
            print(f"{s['id']:<10} {s['typeName']:<28} {price}")


if __name__ == "__main__":
    main()
