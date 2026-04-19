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
3. **CATEGORIES** — orange (`#e07a3a`). Food-category dropdown
   drilldown.
4. **STORED IN** — blue (`#7eb8d4`). Wrap-up tiles (fridge / pantry /
   freezer placement).
5. **SET STATE** — muted purple (`#c7a8d4`). Physical state (loaf /
   slices / crumbs, etc.).
6. **INGREDIENTS** — yellow (`#f5c842`). Composition tags for
   multi-tag items (burritos, pizzas, blends).

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
