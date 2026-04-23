# mise — development rules

## Identity-field hierarchy (UNIVERSAL — never reorder)

Every identity stack renders these rows in this exact order, top-down.
Applies to ItemCard, AddItemModal, scan rows, and anywhere else we
surface a pantry item's identity.

1. **HEADER** — big italic title. DERIVED (not free-text) from
   `[Brand] [Canonical]` when both are set, fallback to Canonical
   name alone, fallback to `item.name` only for free-text /
   pre-canonical rows. Brand and Canonical are each a clickable
   segment of the header: brand → inline rename, canonical →
   opens LinkIngredient picker.
   - When brand is unset, render a small `+ ADD BRAND` affordance
     ABOVE the header (never as an inline prefix — empty brand
     slot inline reads as broken).
   - Never let the user's typed `item.name` fossilize as the
     displayed title when a canonical exists. Typo-tolerant by
     design: "Proscuitto" bound to `prosciutto` canonical
     displays as "Prosciutto".
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
