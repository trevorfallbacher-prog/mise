-- Spice metadata seed batch 1: salts + peppers
-- Run after migration 0028. Safe to re-run (upsert).

INSERT INTO ingredient_info (ingredient_id, info) VALUES

('kosher_salt', '{
  "description": "Coarse-grained salt with no additives. The default cooking salt for professionals — the large flakes are easy to pinch and distribute evenly, and the open crystal structure dissolves quickly on contact with moisture.",
  "flavorProfile": "Pure salt, clean, no metallic or bitter aftertaste",
  "prepTips": "Pinch from a bowl, not a shaker. Season from 12 inches above so it distributes. Taste as you go — you can always add, never subtract.",
  "storage": {"location": "pantry", "shelfLifeDays": 9999, "tips": "Indefinite shelf life. Keep in a wide-mouth bowl or cellar near the stove for easy pinching."},
  "substitutions": [{"id": "sea_salt", "tier": "direct", "note": "Slightly different crystal size; adjust by taste."}, {"id": "table_salt", "tier": "caution", "note": "Much denser per volume — use half the amount or measure by weight."}],
  "pairs": ["black_pepper", "garlic", "lemon", "butter"],
  "origin": "Historically produced for the kosher meat-curing process (koshering), not because the salt itself is kosher. Diamond Crystal and Morton are the two dominant brands in the US, with meaningfully different densities.",
  "culturalNotes": "Diamond Crystal vs Morton is the great kitchen schism. Diamond is ~40% less dense per teaspoon — recipes that just say kosher salt usually mean Diamond. If you use Morton, scale down by about a third.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 0, "sodium_mg": 1120},
  "sourcing": "Diamond Crystal for cooking (hollow flakes, dissolves fast, easy to pinch). Morton for baking where you need consistent weight-per-volume."
}'::jsonb),

('sea_salt', '{
  "description": "Evaporated seawater crystals. Ranges from fine table-salt texture to coarse flakes depending on the source and process. Carries trace minerals that give each origin a subtle character.",
  "flavorProfile": "Clean salt with faint mineral complexity — varies by origin (Maldon is bright and crunchy, sel gris is earthy and moist, Hawaiian black is mineral-forward)",
  "prepTips": "Use as a finishing salt — sprinkle on completed dishes where the texture and flavor can be appreciated. Cooking with it wastes the nuance.",
  "storage": {"location": "pantry", "shelfLifeDays": 9999, "tips": "Keep dry. Flaky varieties clump in humidity — a few grains of rice in the container help."},
  "substitutions": [{"id": "kosher_salt", "tier": "direct", "note": "Loses the mineral character but salts identically."}, {"id": "flaky_salt", "tier": "direct", "note": "Maldon is technically a sea salt — interchangeable for finishing."}],
  "pairs": ["chocolate", "caramel", "tomato", "olive_oil"],
  "origin": "Every coastal culture has produced sea salt for millennia. Fleur de sel from Guérande, Maldon from Essex, sel gris from Brittany, black lava salt from Hawaii.",
  "culturalNotes": "The salt wars of history were literally about this product. Roman soldiers were sometimes paid in salt — the word salary derives from salarium.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 0, "sodium_mg": 1200}
}'::jsonb),

('flaky_salt', '{
  "description": "Thin, flat crystal flakes (Maldon is the archetype). Designed to be a finishing salt — the delicate crunch and burst of salinity on top of a completed dish is the whole point.",
  "flavorProfile": "Bright, clean, crunchy. The texture IS the flavor — it pops between your teeth.",
  "prepTips": "Never cook with this — heat dissolves the flakes and you lose the crunch. Pinch over steak, chocolate, salads, eggs, avocado toast.",
  "storage": {"location": "pantry", "shelfLifeDays": 9999, "tips": "Keep bone-dry. The flakes are hygroscopic — a damp container turns them into a solid block."},
  "substitutions": [{"id": "sea_salt", "tier": "direct", "note": "Coarse sea salt has similar impact but different texture."}],
  "pairs": ["chocolate", "caramel", "steak", "avocado", "eggs"],
  "origin": "Maldon, Essex, England — the Maldon Crystal Salt Company has been making flaky salt since 1882.",
  "culturalNotes": "Maldon became a chef shorthand for finishing quality. Every restaurant kitchen has a box. The pyramid-shaped crystals form naturally during slow evaporation in broad shallow pans.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 0, "sodium_mg": 980}
}'::jsonb),

('black_pepper', '{
  "description": "Dried unripe berries of Piper nigrum, the most traded spice in human history. The piperine compound delivers the heat; volatile oils deliver the aroma. Freshly ground is non-negotiable — pre-ground loses potency within weeks.",
  "flavorProfile": "Sharp, warm, piney, slightly floral. Tellicherry peppercorns (left to ripen longer on the vine) are fruitier and more complex.",
  "prepTips": "Always grind fresh — a pepper mill is the single biggest upgrade for a new cook. Add early for background warmth, add at the end for aromatic punch. Toast whole peppercorns in a dry pan to bloom the oils before crushing for a cacio e pepe.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Whole peppercorns last 3+ years. Ground pepper loses potency in 3-6 months. Keep in a mill, not a shaker."},
  "substitutions": [{"id": "white_pepper", "tier": "direct", "note": "Same plant, different processing — hotter, less aromatic, no dark specks in light sauces."}],
  "pairs": ["salt", "lemon", "garlic", "steak", "eggs", "pasta", "butter"],
  "origin": "Native to Kerala, India (Malabar Coast). The spice that launched the Age of Exploration — Europeans sailed around Africa and across oceans to bypass the Arab spice monopoly.",
  "culturalNotes": "Pepper was literally worth its weight in gold in medieval Europe. Rent, taxes, and dowries were paid in peppercorns. The phrase peppercorn rent (a token payment) survives in English law.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 6, "protein_g": 0.2, "fat_g": 0.1, "carb_g": 1.5}
}'::jsonb),

('white_pepper', '{
  "description": "Ripe berries of the same Piper nigrum vine, soaked to remove the outer skin, then dried. Hotter than black pepper but with less aromatic complexity — chosen for flavor and aesthetics in light-colored dishes.",
  "flavorProfile": "Sharp, hot, slightly fermented/musty, earthy. Less fruity-floral than black pepper, more directly pungent.",
  "prepTips": "Use in cream sauces, mashed potatoes, white gravies, and Chinese stir-fries where black specks would look wrong. The fermented note intensifies with heat — add toward the end.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Same rules as black — buy whole, grind fresh. The aroma is more volatile than black pepper."},
  "substitutions": [{"id": "black_pepper", "tier": "direct", "note": "Adds visible black specks but equivalent heat. Most recipes don't care."}],
  "pairs": ["cream", "potato", "fish", "eggs", "ginger", "garlic"],
  "origin": "Same origin as black pepper (Kerala, India; now also Sarawak, Malaysia and Muntok, Indonesia). Muntok white pepper is considered the benchmark.",
  "culturalNotes": "Essential in Chinese, Thai, and French cuisine. Hot and sour soup, tom kha gai, and béchamel all depend on white pepper specifically. The slight funk is a feature, not a bug.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 7, "protein_g": 0.3, "fat_g": 0.1, "carb_g": 1.6}
}'::jsonb),

('peppercorns', '{
  "description": "Whole dried Piper nigrum berries, unground. The base material for both black and white pepper. Buying whole and grinding fresh is the single biggest spice-quality upgrade in any kitchen.",
  "flavorProfile": "Complex — piney, citrusy, warm, slightly floral. Tellicherry (larger, riper) are sweeter; Malabar are sharper; Sarawak are mild and aromatic.",
  "prepTips": "Keep a good mill loaded at all times. For cacio e pepe and steak au poivre, toast in a dry pan 30 seconds then crack coarsely with the flat of a knife or a mortar.",
  "storage": {"location": "pantry", "shelfLifeDays": 1825, "tips": "Whole peppercorns last 5 years easily in a sealed container away from light. The longest-lasting spice in your rack."},
  "substitutions": [{"id": "black_pepper", "tier": "direct", "note": "Pre-ground — same thing, less fresh."}],
  "pairs": ["salt", "steak", "pasta", "cheese"],
  "origin": "Kerala, India — the Malabar Coast has been the epicenter of pepper production for 4,000+ years.",
  "culturalNotes": "Tellicherry peppercorns are graded by size — only the largest 10% of Malabar berries earn the Tellicherry designation. They ripen longer on the vine, developing more sugar and complexity.",
  "allergens": []
}'::jsonb)

ON CONFLICT (ingredient_id) DO UPDATE SET info = EXCLUDED.info, updated_at = now();
