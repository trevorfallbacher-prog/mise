# mise — development rules

## Identity-field hierarchy (UNIVERSAL — never reorder)

Every identity stack renders these rows in this exact order, top-down.
Applies to ItemCard, AddItemModal, scan rows, and anywhere else we
surface a pantry item's identity.

1. **CUSTOM NAME** — free-text user input (the big italic title).
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
