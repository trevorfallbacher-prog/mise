-- mise — fix the Smitty badge icon_path (no space in the filename)
--
-- Paste into Supabase SQL Editor and Run. Safe to re-run.
--
-- 0021 assumed the SVG was saved as "Smitty WerbenJagerManJensen.svg"
-- with a space. The actual file committed to public/badges/ has no
-- space: "SmittyWerbenJagerManJensen.svg". Points icon_path at the
-- correct filename so the <img src> resolves without a browser 404
-- fallback to the 🏅 glyph.

update public.badges
   set icon_path = '/badges/SmittyWerbenJagerManJensen.svg'
 where slug = 'cacio-e-pepe-first-ever';
