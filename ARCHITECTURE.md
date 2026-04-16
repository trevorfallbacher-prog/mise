# Architecture

This is the foundation doc. It captures the load-bearing decisions
that everything else in the app rests on. Read it before adding new
tables, new modals, or new persistent state. Update it when you add a
new primitive or change a convention.

This is not a survey of every file. For that, read the code. This
doc covers: **what the data model is**, **how the UI is organized**,
**what conventions exist**, **how to add new things without
fracturing the foundation**, and **what not to do**.

---

## The domain model

Everything in a user's kitchen is an **Item** — a row in
`pantry_items`. Items come in two roles:

| Role | How you can tell | Examples |
|---|---|---|
| **Atomic** (`kind='ingredient'`) | No rows in `pantry_item_components` referencing it as a parent. Typically carries one `ingredient_id` pointing at a canonical. | A block of pepper jack, raw eggs, a stick of butter, a jar of salt |
| **Composed** (`kind='meal'`) | Has one or more rows in `pantry_item_components` — the Components tree | A frozen pizza, Italian Blend shredded cheese, leftover lasagna, a store-bought pesto jar, a homemade marinara |

"Meal" is a role, not a separate type. The same `pantry_items` table
holds both. The `kind` column is a cache of "has components?" —
conceptually derivable, stored for query convenience.

### Components are relationships, not a tier

A `pantry_item_components` row is an **edge** in the composition graph.
It points from a parent Item to either:

- A **canonical Ingredient** (`child_kind='ingredient'`, references a
  string id in the bundled `INGREDIENTS` registry)
- Another **Item** (`child_kind='item'`, FK to `pantry_items.id` —
  recursive, this is what makes the tree work)

Each edge carries snapshot fields (`name_snapshot`,
`ingredient_ids_snapshot`) so the parent's composition stays readable
after the child is consumed/deleted.

### Flattened tags are a cache

`pantry_items.ingredient_ids[]` (migration 0033) is the flattened
union of every leaf canonical in the tree. Recipe matching and
dietary filtering hit this array (GIN indexed). When components
change, the client recomputes the flattened array and writes it to
the parent.

Authoritative source: the components tree. Cache: the flat array.
Never read the cache when you have access to the tree; never trust
the tree when the cache is fresher (it shouldn't be — they should
match; if they drift, the tree wins).

### Canonical Ingredients

Canonical ingredients live client-side in `src/data/ingredients.js`
(bundled) with enrichment metadata in `ingredient_info` (server-side
JSONB, seeded via `seedIngredientInfo.js`). They are **reference
data** — shared across all users, immutable per release.

The string `id` on a canonical (e.g. `"mozzarella"`) is the stable
handle. Names and metadata can change between releases without
invalidating tags; ids are forever.

### Recipes, cooks, provenance

- **Recipes** are bundled reference data (JSON-in-code under `src/data/recipes/`).
- **Cook logs** (`cook_logs`, migration 0013) record "this user
  cooked this recipe at this time with these diners and this
  rating." Rows produce pantry decrements and may produce leftover
  items.
- **Provenance** (migration 0029) links items back to their source:
  `source_recipe_slug`, `source_cook_log_id`, `source_receipt_id`,
  `source_scan_id`. Every item knows where it came from if it has a
  first-class origin.
- **Receipts** (`receipts`, migration 0006) record receipt scans;
  **Pantry scans** (`pantry_scans`, migration 0032) record shelf
  scans. Both store compressed images in the `scans` bucket.

---

## Frontend conventions

### Styling — use tokens, not literals

**Do:**
```js
import { COLOR, FONT, RADIUS } from "../lib/tokens";

<div style={{
  color: COLOR.ink,
  fontFamily: FONT.mono,
  borderRadius: RADIUS.lg,
}} />
```

**Don't:** hardcode colors, fonts, spacing, radii, z-indexes as
string literals in `style={{}}`. Pre-tokens files still do this;
they migrate opportunistically. New code uses tokens from day one.

### Modals — use ModalSheet

**Do:**
```jsx
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";

<ModalSheet onClose={onClose} zIndex={Z.card}>
  {/* your content */}
</ModalSheet>
```

ModalSheet owns: backdrop, fade-with-drag, drag handle, top-right ✕,
Escape key, click-backdrop-to-close, swipe-down-to-dismiss.

**Don't:** hand-roll another `<div style={{ position: 'fixed', ... }}>`
backdrop. If ModalSheet doesn't cover a case, extend ModalSheet — don't
fork it.

### Synced list hooks

`useSyncedList` (`src/lib/useSyncedList.js`) is the generic "keep a
list of rows synced to a Supabase table" hook. It handles initial
load, realtime, setter-with-diff persistence. Existing tables using
it: `pantry_items`, `receipts`, etc.

**When to use:**
- The table has a `user_id` column
- Rows are independent (not composed into a parent)
- The UI works off the full list

**When not to use:**
- The table authorizes via a parent (e.g. `pantry_item_components` —
  no `user_id`, FK-scoped). Write a focused hook; see
  `useItemComponents.js` for the pattern.
- You only ever read-by-id for a specific parent.

### Field naming

- **Client-side:** camelCase (`ingredientIds`, `expiresAt`,
  `sourceRecipeSlug`).
- **Database:** snake_case (`ingredient_ids`, `expires_at`,
  `source_recipe_slug`).
- **Conversion:** each hook defines `fromDb` / `toDb` adapters. Keep
  them defensive — columns that might not exist in older DBs should
  use the `row.X !== undefined` check pattern so un-migrated clients
  don't 400.

### Emoji and copy

Fonts, colors, and layout are tokenized; emoji and microcopy are not.
That's intentional — the brand voice lives in prose, and brand prose
shouldn't be behind an indirection layer. Keep emoji + copy inline
where they render.

---

## Backend conventions

### Migrations

See `supabase/migrations/_TEMPLATE.sql`. Copy it when starting a new
one. The filename convention is `NNNN_short_snake_case.sql` with
zero-padded four-digit prefixes, one more than the current max.

The checklist in the template covers what to verify every time.
Don't skip the RLS step — forgetting RLS is the single most common
way to leak data across users or families.

### RLS patterns

Three shapes, applied in order of how common they are:

1. **Family-shared table** — user_id column, both user and their
   family can read/write. Most app tables. Uses `family_ids_of()`
   (defined in migration 0007) in the policy.

2. **Parent-scoped child table** — no user_id, authorization via
   a FK to a parent that carries one. See
   `pantry_item_components`.

3. **Self-only table** — user_id, only the owner sees it. Rare
   (private notes, settings).

All three are templated in `_TEMPLATE.sql`.

### Idempotency

Every DDL wrapped with `if not exists` / `if exists` / `do $$` blocks.
Migrations must be safe to re-run. This catches:
- Developer running migrations twice by accident
- CI re-running
- Partial-apply recovery after a network error

If a migration can't be made idempotent (e.g. an `alter ... drop
column`), flag it in the file header comment and in the PR.

### Realtime

Family-shared tables that the UI reads live should be added to the
`supabase_realtime` publication. See the template's Section 5 for
the DO-block wrapper.

`useSyncedList` subscribes to postgres_changes automatically when
the table is in the publication. Without the publication step, you
get stale client state.

### Never roll your own auth

`auth.uid()` is always the authenticated user; trust it. Don't pass
user ids from the client as arguments to RLS-sensitive queries —
that's an authorization bypass. The RLS policies use
`auth.uid() = user_id` and that's the only identity check you need.

---

## Directory structure (as of this writing)

```
src/
├── App.jsx                  — top-level routing, tab switching
├── components/              — one file per React component
│   ├── ModalSheet.jsx       — shared modal primitive (use this!)
│   ├── ItemCard.jsx         — card for a specific pantry item
│   ├── IngredientCard.jsx   — card for a canonical ingredient
│   ├── LinkIngredient.jsx   — multi-select tag picker
│   ├── Pantry.jsx           — the big one; pantry list + scanner
│   │                           + AddItemModal + ConvertStateModal
│   │                           (overdue for extraction — see below)
│   └── ...
├── data/                    — bundled reference data
│   ├── ingredients.js       — canonical INGREDIENTS registry
│   ├── blendPresets.js      — named blend presets for LinkIngredient
│   ├── recipes/             — recipe JSON-in-code
│   └── ...
└── lib/                     — hooks and helpers
    ├── tokens.js            — design tokens (use these!)
    ├── supabase.js          — client instance
    ├── useSyncedList.js     — generic table-synced list hook
    ├── usePantry.js         — pantry-items-specific usage of the above
    ├── useItemComponents.js — components tree reader
    ├── pantryComponents.js  — component writer + flatten helpers
    └── ...

supabase/
├── migrations/
│   ├── _TEMPLATE.sql        — copy this for new migrations
│   └── NNNN_*.sql           — applied migrations
├── functions/               — Edge Functions (scan, seed)
└── seeds/                   — seed data
```

---

## How to add things

### A new table

1. Copy `supabase/migrations/_TEMPLATE.sql` to the next
   `NNNN_short_name.sql`.
2. Work through the checklist at the top.
3. Write `fromDb` / `toDb` adapters in a hook file.
4. If it fits the shape, wire `useSyncedList` to it. Otherwise
   write a focused hook.
5. Commit the migration + the client code together. Partial
   deployments break things.

### A new modal

1. `import ModalSheet from "./ModalSheet"`.
2. Wrap your content. Pass `onClose` and (optionally) a `zIndex`
   from `Z` in tokens.
3. Use `COLOR` / `FONT` / `RADIUS` / `SPACE` / `Z` tokens for
   styling. Don't reintroduce hardcoded colors/fonts.

### A new field on an existing table

1. Write a migration that adds the column with a default / nullable
   (don't break un-migrated clients).
2. Update `fromDb` / `toDb` with the defensive `row.X !== undefined`
   pattern.
3. Update UI.

### A new canonical ingredient

Edit `src/data/ingredients.js`. Bump `SEED_VERSION` if you're adding
enrichment metadata that should repopulate existing users' caches.

---

## What not to do

- **Don't hardcode styling values when a token exists.** Use tokens.
- **Don't hand-roll a modal shell.** Use `ModalSheet`.
- **Don't add a table without RLS.** Use the template. Enable RLS.
  Write policies.
- **Don't write non-idempotent migrations.** Wrap DDL appropriately.
- **Don't break old clients.** Use defensive column mapping; add
  columns with defaults or nullable.
- **Don't leak user data through parameterized RLS.** Trust
  `auth.uid()`, nothing else.
- **Don't fork primitives when you need new behavior.** Extend them.
  If ModalSheet needs a new feature, add it to ModalSheet.

---

## Known technical debt

Not all of the app has reached the foundation state above. Tracked
here so we remember and can attack opportunistically:

- **Most modals still hand-roll their shell.** Migrating them to
  `ModalSheet` is in-progress; `ItemCard` migrated first, others
  follow as they're touched. Swipe-down will arrive on each modal
  as it migrates.
- **Most files still use hardcoded color/font literals.** Tokens
  exist; migration is opportunistic.
- **`Pantry.jsx` is ~3000 lines.** Contains the pantry list,
  AddItemModal, Scanner, ConvertStateModal, and most of the
  pantry-scoped state. Should be split — `Scanner.jsx`,
  `AddItemModal.jsx`, etc. Noted in earlier work as blocked by
  tooling write-size limits; revisit.
- **Scan-confirm path doesn't write component rows for
  scan-originating Meals.** LinkIngredient's commit against a
  scan-draft item only stamps `kind` locally; the component rows
  would need the `addScannedItems` pipeline to surface inserted
  row ids back to a components-write step. See the 6c commit
  message for the follow-up plan.
- **No CSS file, no class system.** Pure inline styles + tokens.
  Fine at current scale; revisit if/when the app grows enough to
  need a bigger styling strategy (Tailwind, CSS Modules).
- **Scanner body extraction from Pantry.jsx** — single file is
  too large for the tooling to extract cleanly in one pass;
  needs a deliberate multi-commit extraction.

---

## When in doubt

1. Grep the codebase for how the thing has been done before.
2. Check this doc for a convention.
3. Check `_TEMPLATE.sql` for a backend example.
4. If the pattern doesn't exist yet, invent it — and then update
   this doc so the next person (or next you) finds it.
