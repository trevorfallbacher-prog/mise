# mise — development rules

## Supabase egress discipline (LOAD-BEARING — the app dies past free tier)

mise runs on Supabase free tier. We blew through 8.9 GB once and almost
shipped a dead app. Treat every byte that leaves the server as money.
Every new feature must answer: "what does this cost in egress?" before
"what does this look like?"

**Rules:**

1. **No `select("*")` on a public/global table without a WHERE clause.**
   Public-read tables like `brand_nutrition`, `ingredient_info`,
   `off_category_tag_canonicals` accumulate rows from every user
   globally. Fetching all of them on every boot was the single biggest
   egress source we had.
   - Default to a TTL-gated localStorage cache (24h) before falling
     back to a network read. Pattern: `useBrandNutrition` and
     `useIngredientInfo` are the canonical examples — copy that shape.
   - Better: `lazy-load on demand` — a `get(id)` that fetches a single
     row when asked beats a fetchAll. Use this for any data where the
     consumer can tolerate an async lookup.

2. **No realtime subscriptions on global tables.** Realtime broadcasts
   every change to every connected client — that's N×N egress on a
   hot table. Realtime is fine ONLY on user-scoped or family-scoped
   channels (`rt:tablename:${userId}` etc.). When a public-read table
   needs to surface its own writes back to the writing user, do a local
   `setState` injection inside the upsert path — don't subscribe.
   - The `brand_nutrition` global subscription was the worst offender;
     that lesson cost us the free tier. Don't add another.

3. **Compress every image before it crosses the network boundary.** Two
   distinct paths, both required:
   - **Storage uploads** — pipe through `src/lib/compressImage.js` with
     explicit `{ maxDimension, jpegQuality }` options. NEVER upload a
     raw `File`/`Blob` to a Supabase Storage bucket. The cook-photo
     leak (3-5MB raw photos) was a 4-8 GB/month leak in one feature.
   - **Edge-function payloads** — base64 photos sent to
     `categorize-product-photo` / `scan-nutrition-label` / etc. count
     as egress on the request body too. Compress to 800-1100px
     depending on OCR sensitivity; quality 0.65-0.80. Specific
     defaults live in `compressImage.js`.
   - Quality bumps above 0.85 require an explicit comment justifying
     why (typically OCR-critical: receipt thermals, fine-print labels).
     "Just because" is not a reason.

4. **Debounce DB writes from continuous-input controls.** Sliders, drag
   handles, typed search inputs — anything that emits at >5 events/sec
   must batch or debounce before hitting Supabase. Minimum 200ms
   debounce on persistence; ideally `useSyncedList`'s diff path
   coalesces multiple in-flight changes. Without this, dragging a
   pantry-amount slider once fires 30+ realtime broadcasts to every
   family member.

5. **Don't re-fetch in `useEffect` without a dep gate.** Every
   re-render that triggers a fetch is potential 100KB+ of egress per
   user-action. Always check: does the cache cover this? Does my
   `useEffect` actually need to re-run, or can I stage the result in a
   ref/state and short-circuit subsequent runs?

6. **Edge-function inputs count as egress.** Pre-compress, pre-trim,
   pre-summarize anything you put in a request body. Don't paste an
   entire JSON dump if a few fields would do. Don't send the system
   prompt re-statement on every call — Anthropic prompt caching is
   wired (`cache_control: ephemeral`) but only helps if the prompt is
   stable; mutations to the prompt invalidate the cache.

7. **Storage `getPublicUrl` serves are also egress.** Photos uploaded
   to public buckets get downloaded by every viewer. If a photo is
   served back to a user N times, that's N × payload-size egress.
   Compress on the upload path so the served version is also small.
   Cache-Control headers help downstream caches (we already set
   `cacheControl: "3600"` on cook photos — keep that).

8. **Audit on every new feature.** Before shipping any new
   data-fetching pattern, ask:
   - Is the WHERE clause as tight as it can be?
   - Does this paginate / lazy-load / cache?
   - Does this need realtime? Can it be fetched on demand instead?
   - If it's a Storage upload: am I compressing?
   - If it's an edge-function call: am I sending the smallest payload
     that gets the job done?

If the answer to any of those is "I didn't think about it," stop and
think about it.

**Default tool: `useCachedQuery` (`src/lib/useCachedQuery.js`).** For any
new fetch hook backing slow-changing data (profile, recipes, family
roster, catalog data, aggregates that don't update mid-session), wrap
it in this helper. It hydrates from `localStorage` instantly and only
hits the network on TTL expiry. The pattern is also exported as
standalone helpers (`readCache` / `writeCache` / `cacheFresh`) for
hooks that need finer control. Existing examples: `useProfile`,
`useRelationships`, `useUserRecipes`, `useAvatars`, `useActivityFeed`,
`useMonthlySpend`, `useBrandNutrition`, `useIngredientInfo`.

**Pick TTLs by domain volatility:**
   - 7 days — effectively-static catalogs (avatar catalog, badge
     definitions, recipe registry).
   - 24 hours — public-read enrichment tables (brand_nutrition,
     ingredient_info).
   - 6-12 hours — slow-changing user data (profile, relationships,
     recipes).
   - 30-60 min — moderately-fresh user data (activity feed, monthly
     spend, badge counts).
   - No cache — everything else; relies on realtime + scoped queries.

**Mutations should `writeCache` directly** instead of invalidating —
the user's own writes should appear instantly without a round-trip.
`upsert()` paths in `useProfile`, `useBrandNutrition`, etc. all
follow this pattern.

## Identity-field hierarchy (UNIVERSAL — never reorder)

Every identity stack renders these rows in this exact order, top-down.
Applies to ItemCard, AddItemModal, scan rows, and anywhere else we
surface a pantry item's identity.

1. **HEADER** — big italic title. DERIVED (not free-text) from the
   identity components in this exact composition order:

   ```
   [Brand] [State] [Canonical] [Cut] ([Package size])
   ```

   …falling back to canonical alone when only canonical is set,
   falling back to `item.name` only for free-text / pre-canonical
   rows. Empty axes are skipped (no leading whitespace, no empty
   parens). Brand and Canonical are each a clickable segment of the
   header: brand → inline rename, canonical → opens LinkIngredient
   picker. Examples:
   - `Slim Jim Ground Chicken (12 oz)` — full stack.
   - `Ground Beef Chuck` — no brand, no package size.
   - `Butter (8 oz)` — canonical + size only.
   - `Prosciutto` — canonical only.

   **Implementation rule (single source of truth):** every surface
   that displays an item's title — pantry cards, success overlays,
   shopping rows, scan-draft headers, anything — MUST go through
   `buildDisplayName(row)` from
   `src/experiments/mcm-cooking/helpers.js`. Do NOT hand-roll the
   composition per surface; if you find yourself concatenating
   `${brand} ${name}` or similar, stop and reach for the helper.

   **Two-phase rule** — display-name behavior depends on whether
   the row is in-progress or committed:

   - **In the AddItem flow (in-progress row):** the `name` form
     field MUST pin to the canonical's display name (`findIngredient
     (canonicalId).name`) the moment a canonical resolves — even if
     the user already typed something or OFF returned a long
     marketing productName like "Slim Jim Buffalo Wild Wings Buffalo
     Style." Canonical IS the name; brand / state / package size are
     other axes that compose around it. This is unconditional, not
     a "fill when empty" guard. The lock releases automatically only
     when the user types text that diverges from the canonical's
     name (intent-to-rename signal).
   - **In the pantry (committed row):** the rendered title is
     produced by `buildDisplayName(row)`, which composes the full
     `[Brand] [State] [Canonical] [Cut] ([Package size])` string
     from the row's stored axes. The form field's stored `name`
     value is NOT what gets shown — the composed string is.

   - When brand is unset, render a small `+ ADD BRAND` affordance
     ABOVE the header (never as an inline prefix — empty brand
     slot inline reads as broken).
   - Never let the user's typed `item.name` fossilize as the
     displayed title when a canonical exists. Typo-tolerant by
     design: "Proscuitto" bound to `prosciutto` canonical
     displays as "Prosciutto".
   - Package size in the suffix uses `row.max` (the size as sold),
     not `row.amount` (current remaining). A half-eaten 16oz tub
     still reads `(16 oz)` — partial-remaining is a gauge concern,
     not an identity concern.
2. **CANONICAL** — tan (`#b8a878`). Internal approved naming system,
   commonly-accepted identity.
3. **CUT** — rust (`#a8553a`). Anatomical / butchery slot. Orthogonal
   to STATE: chicken breast, cubed is chicken + cut=breast +
   state=cubed; ground chicken thigh is chicken + cut=thigh +
   state=ground. Grocery-shelf scope only (not full-animal butchery
   yield trees — out of scope for launch). `pantry_items.cut`
   (migration 0122) is the storage. Only renders when the canonical
   has entries in `CUTS_FOR` (meats today — chicken/beef/pork/turkey).
4. **CATEGORIES** — orange (`#e07a3a`). Food-category dropdown
   drilldown.
5. **STORED IN** — blue (`#7eb8d4`). Specific shelf TILE (Dairy &
   Eggs, Produce, Meat & Poultry, Condiments, etc.) — NOT the
   fridge/pantry/freezer location. Those three are the LOCATION
   axis which sits one level above STORED IN and determines which
   tile list (FRIDGE_TILES / PANTRY_TILES / FREEZER_TILES) is in
   scope. The STORED IN chip shows the tile's emoji + label; the
   LOCATION chip renders in a muted blue to signal it's the
   broader container.
6. **SET STATE** — muted purple (`#c7a8d4`). Physical state (loaf /
   slices / crumbs, cubed, ground, minced, etc.). Crucially distinct
   from CUT: state is what you DID to the cut, cut is where on the
   animal it came from.
7. **INGREDIENTS** — yellow (`#f5c842`). Composition tags for
   multi-tag items (burritos, pizzas, blends).

**Canonical-per-animal rule (meat):** one canonical per species —
`chicken`, `beef`, `pork`, `turkey`. NEVER create `chicken_breast` /
`ribeye` / `brisket` style compound slugs; those are the base
canonical with `cut` set. Legacy compound slugs exist in
`CANONICAL_ALIASES` only as a read-compat redirect for rows written
before migration 0122; new writes always split on the axis.

**Brand axis note:** Brand is orthogonal to the six colored axes —
it's NOT a new reserved color, just metadata that rides with the
name in the HEADER position above. Kitchen tile-card browse view
renders brand as a small gray pill next to the name (e.g.
"Butter · Kerrygold"). pantry_items.brand (migration 0061) is
the storage.

## Reserved color hierarchy

| Axis          | Color     | Hex       |
| ------------- | --------- | --------- |
| CANONICAL     | Tan       | `#b8a878` |
| CUT           | Rust      | `#a8553a` |
| FOOD CATEGORY | Orange    | `#e07a3a` |
| STORED IN     | Blue      | `#7eb8d4` |
| STATE         | Purple    | `#c7a8d4` |
| INGREDIENTS   | Yellow    | `#f5c842` |

Never swap these. Never introduce a new axis without picking a color
that doesn't collide with the above.

## Item-reference rows — canonical visual pattern

Every surface that shows a scanned / stocked / committed pantry item
(ItemCard, scan-draft rows, checkout review rows, etc.) MUST follow
the same visual pattern so the app reads as one app. Reference
implementation: `src/components/Kitchen.jsx` lines ~1647–1900
(the scan-draft row) and the ItemCard in the same file.

### Layout skeleton (top-down)

1. **HEADER** — item display name. Fraunces serif italic.
   - Name left-aligned with `whiteSpace: nowrap; textOverflow: ellipsis`
   - Package size as a right-aligned DM Mono chip on the same row
     ("16 oz" in tan `#b8a878`), with the `×N` stacking multiplier
     appended when qty > 1
2. **PAIR / IDENTITY LINE** — one muted 11px line summarizing
   the pair target + brand + canonical. Nowrap + ellipsis.
3. **AXIS CHIP ROW** — horizontal flex, gap 6, flex-wrap.
   One chip per identity axis in reserved color order
   (canonical → category → stored-in → state → ingredients).
4. **UPC / provenance** — DM Mono 10px in `#666`, bottom of the row.

### Chip style (reused everywhere)

```js
const SET_CHIP = (tone) => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  fontFamily: "'DM Mono',monospace", fontSize: 9,
  color: tone.fg, background: tone.bg,
  border: `1px solid ${tone.border}`,
  borderRadius: 4, padding: "2px 6px",
  letterSpacing: "0.08em", cursor: "pointer",
});
const UNSET_CHIP = {
  fontFamily: "'DM Mono',monospace", fontSize: 9,
  color: "#666", background: "transparent",
  border: "1px dashed #2a2a2a",
  borderRadius: 4, padding: "1px 6px",
  letterSpacing: "0.08em", cursor: "pointer",
};
```

- **Set chip label** — `{emoji} {LABEL.toUpperCase()}`, e.g. `🧈 BUTTER`
- **Unset chip label** — `+ set <axis>` (lowercase "set"), e.g. `+ set category`
- **Tone table** — muted tints of the reserved axis colors:
  ```
  canonical:    fg: "#b8a878", bg: "#1a1508", border: "#3a2f10"
  cut:          fg: "#a8553a", bg: "#1a0c07", border: "#3a1a10"
  category:     fg: "#e07a3a", bg: "#1a0f08", border: "#3a1f0e"
  location:     fg: "#7eb8d4", bg: "#0f1620", border: "#1f3040"
  state:        fg: "#c7a8d4", bg: "#16101e", border: "#2f2440"
  ingredients:  fg: "#f5c842", bg: "#1e1a0e", border: "#3a3010"
  ```

### Picker pattern (never use `<select>`)

Every chip is a button. Tapping it opens a `ModalSheet` containing a
searchable list of options. Inside the sheet:

```jsx
<ModalSheet onClose={close} maxHeight="70vh">
  <div style={pickerKicker(toneFg)}>CATEGORY</div>
  <h2 style={pickerTitle}>What category does X belong to?</h2>
  <ul>
    {options.map(opt => (
      <button key={opt.id} onClick={pick}>
        {opt.emoji} {opt.label} {active && "✓"}
      </button>
    ))}
  </ul>
</ModalSheet>
```

- `pickerKicker` = `DM Mono 10px, axisColor, letterSpacing 0.12em`
- `pickerTitle` = `Fraunces serif 20px italic, color #f0ece4`
- Option rows are fullwidth tap targets in DM Sans, with the
  active one tinted in the axis color + ✓ marker
- Long lists add a sticky search input at the top (see
  `LinkIngredient` / `TypePicker` / `IdentifiedAsPicker`)

### Hard rules

- **NEVER `<select>` or `<input type="range">` dropdowns for axes.**
  Always chip → ModalSheet → list.
- **NEVER inline expand a picker into the row.** ModalSheets stack
  vertically; inline expansion shifts surrounding rows and kills
  the user's eye-tracking.
- **ALWAYS reuse `SET_CHIP` / `UNSET_CHIP` styling** — don't
  re-roll button styles per component. If you find yourself writing
  `background: "#e07a3a1a"` or similar, stop and reach for the
  shared style constants.
- **ALWAYS reference Kitchen.jsx's scan-draft row** before building
  a new item-reference surface. Typography, chip order, and modal
  patterns should match; if they drift, the app feels stitched
  together from different design systems.

## Other standing rules

- Pickers open as stacked ModalSheets — never as inline expanders
  that shift surrounding layout (kills eye-tracking).
- Scan-row CANONICAL chip opens `LinkIngredient mode="single"`.
  Multi-tag composition opens `LinkIngredient mode="multi"`.
- Admin auto-approves their own canonical creations (upsert
  `ingredient_info` stub) and the PENDING badge is hidden for admins.
- Bundled canonicals live in `src/data/ingredients.js`. User-created
  slugs live in `pantry_items.canonical_id` (migration 0039) with
  optional `ingredient_info` approval rows.

## File-size discipline (added after the PantryScreen.jsx 5,300-line refactor)

Files in `src/components/` and `src/experiments/**` should not exceed
~1,500 lines. Treat that number as a hard tripwire, not a soft target.

**Before adding any feature to a file approaching that limit:**
1. Identify a logical component or helper group inside the file that
   could live on its own (e.g., a self-contained sheet/modal, a card
   renderer, a primitive used in 2+ places, the file's module-scope
   helpers).
2. Extract it into a sibling file. Keep the original file's exports
   intact via re-export so callers don't break:
   `export { Foo } from "./Foo";`
3. Land the refactor as its OWN commit before the feature commit.
   Commit message: `refactor(<scope>): extract <Component> from <File>`.
4. Then add the new feature to whichever file it actually belongs to.

**Default to a new file for new top-level components.**
When introducing a new sheet, card type, modal pattern, or primitive,
create a new sibling file rather than appending to an existing screen.
The 30 seconds of import wiring saves the giant-file refactor later.

**Closing-commit extraction.**
When a session adds a substantial new top-level surface (a new sheet,
a new card variant, a new picker pattern), the closing commit of that
work should be an extraction if the parent file is at or past 1,000
lines. Same cadence as committing tests or updating CLAUDE.md after a
contract change.

**Periodic audit.**
Once per long session, run:

    wc -l src/components/*.jsx src/experiments/**/*.jsx 2>/dev/null | sort -n | tail

Anything over 1,500 lines is a refactor backlog item, not a "we'll
get to it" — schedule the extraction before the next feature touches
that file.

**Why:** PantryScreen.jsx grew to 5,300 lines because every feature
landed inline ("editing in place is faster"). Each commit looked
reasonable; the cumulative drift was invisible until the file was
unwieldy. The above rules trade a little per-feature friction for
a lot less terminal-scale refactor pain.

## Self-teaching identity resolution — MINIMAL user data entry

North star: **a scan should be enough.** If it isn't, we fall back to
asking the user exactly once — and then we *persist what they
taught us* at the UPC + canonical level so every future user of the
same product gets the answer for free. Every item-list surface (scan
draft, Shop Mode checkout, ItemCard edit, pantry row edit, …) must
follow the same three-layer cascade on both READ and WRITE.

### Three identity axes we resolve per item

1. **CANONICAL** (`canonical_id`) — what the product IS. Drives recipe
   matching, nutrition, storage heuristics.
2. **FOOD CATEGORY** (`type_id`) — the USDA / WWEIA food type
   (`wweia_cheese`, `wweia_yogurt`, etc. — see `src/data/foodTypes.js`).
   Drives the STATE picker, the suggested tile, and broad
   `pantry_items.category` via tile lookup.
3. **STORED IN** (`tile_id`) — the specific shelf tile
   (`dairy`, `meat_poultry`, `frozen_veg`, …) + its LOCATION axis
   (`fridge` / `pantry` / `freezer`).

### READ cascade (every item-list surface, every render)

For each axis, resolve in this order — first hit wins:

1. **User override set on THIS surface** (React state) — the user
   just picked it seconds ago.
2. **Family correction** via `findBarcodeCorrection(upc)` — the
   household has already taught this UPC's placement.
3. **Global correction** — same `findBarcodeCorrection(upc)`, same
   call, global tier inside. Admin-curated, one row per UPC.
4. **Bundled canonical metadata** — `findIngredient(id).category /
   storage.location / …`.
5. **Synthetic canonical info** — `useIngredientInfo.dbMap[id]` for
   family-approved slugs the admin has enriched.
6. **OFF payload** — `tagHintsToAxes(off.categoryHints)` + bundled
   `parsePackageSize(off.quantity)` for package size.
7. **Name inference** — `inferFoodTypeFromName(name)` etc. for
   text-only scenarios.
8. **Reserved-word defaults** — `defaultLocationForCategory(category)`,
   `category = "pantry"`, `unit = "package"`. These satisfy NOT NULL
   but signal "we gave up, ask the user."

NEVER hand-roll this cascade per component. Import the resolvers.
Every new item-list surface should read via these same calls so
the fallback order is identical.

### WRITE cascade (after user override)

Whenever the user edits any identity axis on an item-list surface
(chip pick, picker choice, inline field), fire
`rememberBarcodeCorrection` with whatever axes changed. Signature:

```js
rememberBarcodeCorrection({
  userId, isAdmin,
  barcodeUpc,        // required — the lookup key
  canonicalId,       // optional — only if user re-linked
  typeId,            // optional — CATEGORY chip pick
  tileId,            // optional — STORED IN chip pick
  location,          // optional — LOCATION chip pick
  emoji,             // optional — carries with identity
  ingredientIds,     // optional — composition tags
  categoryHints,     // optional — OFF tags for tag-map seeding
});
```

- **Admins write to the GLOBAL tier** (`barcode_identity_corrections`)
  — one row per UPC, everyone benefits.
- **Non-admins write to the FAMILY tier** (`user_scan_corrections`)
  — household-scoped. Admins later promote via the Admin panel.
- The function does the tier routing; callers just pass `isAdmin`.

Fire-and-forget with a `.catch(console.warn)` — a correction write
failing should never block the user's main flow (commit, checkout,
etc.). On success, the next `findBarcodeCorrection` on the same UPC
returns the taught values.

### The rule

Every item-list surface that accepts user input on an identity axis
MUST call `rememberBarcodeCorrection` on that input. If you're
building a new picker / editor and it doesn't teach the memory,
you're adding a data-entry tax that compounds: the user will pay
it AGAIN the next time they scan that UPC.

### Package size + name

Same principle for less-structured data:

- **Package size** (`amount`, `unit`) — taught via
  `popular_package_sizes` (RPC `fetch_popular_packages`). Shop Mode
  writes an observation on commit; the next scan of the same
  (`canonical_id`, `brand`) pair surfaces the most-used size as a
  suggestion.
- **Product name** (for red scans with no OFF data) — the user's
  typed name writes into `trip_scans.product_name` AND gets
  associated with the UPC via `rememberScanCorrection` (raw text
  tier). Next user scanning the same dead-end UPC sees the name
  pre-filled.

### Sanity check before shipping a new item surface

Before merging anything that shows / edits an item row, run through:

- [ ] On mount, does it read the three-layer cascade (override →
      correction → canonical → OFF → default)?
- [ ] When the user picks / edits ANY axis, does the write land in
      `rememberBarcodeCorrection` (or `rememberScanCorrection` for
      text)?
- [ ] Does the NEXT scan of that UPC land with the pick pre-filled?
      (Test end-to-end — pick, commit, re-scan, observe.)
- [ ] Does admin-promotion propagate to everyone? (Admin-flip on an
      `isAdmin` account → global row written → non-admin account
      sees it on next scan.)

Missing any of these = the user will type the same thing twice.
That violates the minimal-data-entry goal.

## Classification weights — three-tier curated/derived/bridge cascade

The pattern that turns a string like "Slim Jim Buffalo Wild Wings
Buffalo Cheddar Beef Stick" into `primary=Slim Jim, secondary=BWW`
is the same shape we want for any future "which of these is most
likely the right one" classification problem (brand priority today;
canonical resolution, recipe match, etc. tomorrow).

**The cascade — every classifier that resolves an identity axis
should follow this tier order:**

1. **Curated tier** — hand-tuned data committed to the repo. Small,
   high-confidence, opinionated. Lives in `src/data/<axis>.js`.
   Example: `BRAND_EXPERTISE` in `src/data/brandExpertise.js`.
2. **Derived tier** — auto-generated from a known-shape data source
   (USDA, OFF, ingested corrections). Re-runnable script writes a
   stub-default file in `src/data/<axis>Derived.js`. Coverage is
   broad but coarser than curated. Example:
   `BRAND_EXPERTISE_FROM_USDA` in `src/data/brandExpertiseDerived.js`,
   regenerated by `scripts/derive_brand_expertise.mjs`.
3. **Bridge tier** — the resolver's "I don't know this exact entity
   but I know its category" fallback. Translates external taxonomies
   (USDA WWEIA, OFF tags) into our internal axes via static maps.
   Example: `subtypeForTypeId()` in `src/data/subtypeMap.js` and the
   subtype emission in `tagHintsToAxes()`.

**The merge rule — curated wins on conflict, derived fills coverage,
bridge handles unknowns:**

```js
function expertiseFor(brandDisplay) {
  const slug = brandSlugify(brandDisplay);
  return mergeRecords(
    BRAND_EXPERTISE[slug] || null,    // curated
    DERIVED[slug] || null,            // derived
  );
  // Bridge tier (subtype/category from typeId/categoryHints) is
  // applied separately at scoring time in axesForCanonical().
}
```

**Three properties that have to hold for this to keep working:**

- **One read entry point.** Every consumer of the classifier reads
  through one function (`expertiseFor`, `findIngredient`,
  `findBarcodeCorrection`). Never let a caller bypass and read the
  underlying tier directly — that breaks the merge contract.
- **The derived file is regenerable.** Stale data is fine; lossy
  data isn't. The script that produces it must be re-runnable from
  scratch any time, with no manual edits in between. If you're
  hand-editing a derived file, you're either editing the wrong tier
  (move to curated) or breaking the regen pipeline.
- **Bridge maps are STATIC.** They translate one taxonomy to another.
  No counts, no probabilities, no "this looks kinda like a cookie."
  When a bridge starts wanting weights, that's the signal it should
  graduate to a derived tier sourced from real data.

### When to add to which tier

| Signal | Tier |
| --- | --- |
| You hand-curated 3 brands' subtype lists for a launch demo | Curated |
| USDA released a new Branded Foods dataset, you want all brand counts refreshed | Derived (re-run the script) |
| OFF added a new `en:vegan-cheeses` tag and we need to handle it | Bridge (`tagHintsToAxes` branch) |
| User corrected "M&M's" from secondary → ingredient on a cookie SKU | Phase 2 — DB-tier learning loop (TODO) |

### Phase 2 — DB-tier learning (planned, not yet built)

When users correct a classification, the next person scanning the
same brand on a similar product should benefit. The plan:

- Migration adds `brand_classification_observations(brand_slug,
  product_subtype, role, count, last_seen_at)` where `role ∈
  {primary, secondary, ingredient}`.
- Every user correction (manual primary↔secondary, ingredient
  promote/demote) writes one row.
- `expertiseFor` merges curated + derived + observed, with observed
  weights eventually overtaking the static seed data as scan volume
  grows.

Build this once two conditions hold: (1) the curated table is stable
enough that we know the right axes, (2) we have non-trivial scan
volume worth learning from. Don't build it speculatively — premature
learning loops on sparse data produce bad weights faster than no
weights at all.

### Subtype taxonomy — the load-bearing finer axis

Brand-expertise lives across (canonical, hub, category, subtype).
Subtype is what distinguishes "cookie" from "candy" within the
"pantry" category — without it, the picker can't tell M&M's-on-a-
cookie from M&M's-on-a-candy-bar, since both share `category:
pantry`.

**Rules for subtype:**

- New canonicals in `src/data/ingredients.js` SHOULD set `subtype` if
  they fall under a known bucket (cookie, candy, sauce, deli, cheese,
  yogurt, ice_cream, sausage, snack_meat, etc.).
- New brands in `BRAND_EXPERTISE` MUST list `subtypes: [...]` —
  picking is what brand-expertise is FOR.
- The full subtype list lives implicitly across the codebase today.
  When adding a new subtype, grep
  `src/data/brandExpertise.js src/data/subtypeMap.js src/lib/tagHintsToAxes.js`
  to make sure the bridge tiers also recognize it.
- A brand's `subtypes` array is the brand's EXPERTISE CLAIM — list
  every subtype the brand credibly co-brands on, even if they don't
  manufacture it (BWW lists `snack_meat` because they collab on
  snack-meat SKUs even though their product line is wings).

### Tripwires — when to refactor this pattern

- **Static derived file > 1 MB.** Move to a Supabase table with
  `useCachedQuery` (24h TTL).
- **Subtype taxonomy hits ~30 unique values.** Promote to a constant
  `SUBTYPES = [...]` in a dedicated file, type-check brand records
  against it.
- **Magic numbers in scoring (`100/50/10/1`) need tuning per
  customer/region.** Promote to a `SCORING_WEIGHTS` constant, then
  later to a config table.
- **Three+ classifiers exist with the same cascade shape.** Extract
  a generic `cascadeResolver({ tiers, mergeFn, bridgeFn })` helper.
  Don't extract before you have three; one is hard-coded, two is
  duplication, three is a pattern.
