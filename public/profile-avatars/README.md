# Profile avatars

Assets for the in-game character avatar catalog (see `supabase/migrations/0117_avatar_catalog.sql`). Users don't upload photos — they unlock these characters through gameplay and display one via random-shuffle or pinned mode.

## File convention

- **Filename:** `<slug>.svg` (matches `avatar_catalog.slug`)
- **Path referenced by DB:** `/profile-avatars/<slug>.svg` (CRA / Vite serves `public/` at the app root)
- **Shape:** 1:1 aspect ratio; render sites apply `border-radius: 50%` and `object-fit: cover`
- **Recommended size:** 256×256 for SVG / vector, or 512×512 for raster (PNG / WebP). Renders at 40–72px so 256 is plenty for SVG, raster needs a bit more headroom for Retina
- **Background:** include a filled background inside the artwork itself — render sites don't add one

## Swapping stubs for real art

Each file in this folder is a placeholder: a colored circle with an emoji glyph centered on it. Replace them in place:

1. Drop the new asset at `public/profile-avatars/<slug>.<ext>` with the same slug as the stub
2. If the extension changes (e.g. stub `chef.svg` → real `chef.png`), update the `image_url` in `avatar_catalog` via a new migration — the column stores the full relative URL including extension
3. No app-code changes needed — the client resolves slugs through the catalog on load

## Adding new avatars

Don't edit this folder in isolation — every file must correspond to a `avatar_catalog` row or the client won't know to surface it.

1. Add an `INSERT … ON CONFLICT DO UPDATE` clause to a new migration (number sequentially after `0117`) with the new slug, rarity, and `unlock_rule`
2. Drop the matching asset file here
3. For non-starter unlocks, add the grant path too (level-up handler, daily-roll payload, etc — those live server-side as work ships)

## Current slugs

| Slug      | Rarity | Glyph |
| --------- | ------ | ----- |
| chef      | common | 🧑‍🍳 |
| fox       | common | 🦊 |
| bear      | common | 🐻‍❄️ |
| panda     | common | 🐼 |
| owl       | common | 🦉 |
| lion      | common | 🦁 |
| octopus   | common | 🐙 |
| frog      | common | 🐸 |
| cat       | common | 🐱 |
| dog       | common | 🐶 |
