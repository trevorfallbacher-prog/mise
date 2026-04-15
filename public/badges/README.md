# Badges

SVGs that back the in-app award system. Served directly by Create React App as
static assets — URLs are `/badges/<slug>.svg`.

## Adding a badge

1. Drop the SVG into this directory. The filename base MUST match the badge's
   `slug` in `public.badges` (DB table). For example:

   ```
   public/badges/cacio-e-pepe.svg   →  slug: 'cacio-e-pepe'
   public/badges/first-scan.svg     →  slug: 'first-scan'
   ```

2. In a migration, either seed a new row into `public.badges` or point an
   existing row's `icon_path` at `/badges/<slug>.svg`. See
   `supabase/migrations/0019_badges.sql` for the canonical insert shape.

3. That's it — the client renders whatever is at `icon_path` via a plain
   `<img>` tag. Missing files fall back to a 🏅 glyph so a half-committed
   badge doesn't render broken.

## Design notes

- Square viewBox, ideally 128×128 or 256×256. They're rendered in tiles at
  ~72px and in a detail modal at ~128px.
- Keep them readable desaturated — locked badges render with a
  `grayscale(1) brightness(0.35)` filter as silhouette placeholders.
- Avoid external font references — everything should ship inline in the SVG
  so there's no flash-of-unstyled-badge while fonts load.
