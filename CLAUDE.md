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
5. **STORED IN** — blue (`#7eb8d4`). Wrap-up tiles (fridge / pantry /
   freezer placement).
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
