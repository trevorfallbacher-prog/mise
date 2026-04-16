-- Spice metadata seed batch 4: powders + blends
-- Run after migration 0028. Safe to re-run (upsert).

INSERT INTO ingredient_info (ingredient_id, info) VALUES

('garlic_powder', '{
  "description": "Dehydrated garlic, ground fine. Delivers garlic flavor without the moisture, texture, or burn of fresh — it dissolves into dry rubs, marinades, and doughs where fresh garlic can''t go. Not a substitute for fresh in sautés; a complement to it.",
  "flavorProfile": "Mellow, sweet, roasted-garlic character. Less sharp and pungent than fresh — the dehydration tames the allicin bite.",
  "prepTips": "Hydrate in a few drops of water before adding to wet dishes — prevents clumping. For dry rubs and spice mixes, use as-is. Blooms well in butter. Do NOT confuse with garlic salt (which is ~75% salt).",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Hygroscopic — absorbs moisture and clumps. Keep the jar tightly sealed. A clumped jar is past its prime."},
  "substitutions": [{"id": "garlic", "tier": "creative", "note": "Fresh garlic — more pungent, adds moisture. ⅛ tsp powder ≈ 1 clove."}, {"id": "garlic_salt", "tier": "caution", "note": "Mostly salt — reduce other salt in the recipe if subbing."}],
  "pairs": ["onion_powder", "paprika", "black_pepper", "cumin", "oregano"],
  "origin": "Dehydrated garlic originated in commercial food processing (mid-20th century US), but garlic itself is Central Asian — cultivated for 5,000+ years.",
  "culturalNotes": "Snobs dismiss garlic powder but professional kitchens use it constantly. It does something fresh garlic literally cannot: distribute evenly in a dry rub, season a burger patty throughout, or flavor bread dough without wet pockets. Different tools for different jobs.",
  "allergens": ["allium"],
  "nutrition": {"per": "1 tsp", "kcal": 10, "protein_g": 0.5, "fat_g": 0, "carb_g": 2}
}'::jsonb),

('onion_powder', '{
  "description": "Dehydrated onion, ground fine. The savory-sweet depth behind spice blends, dry rubs, ranch dressing, and most \"secret\" restaurant seasoning mixes. Like garlic powder — not a substitute for fresh, but a tool that works where fresh can''t.",
  "flavorProfile": "Sweet, savory, mellow onion. The dehydration caramelizes some sugars so it reads slightly sweeter than raw onion.",
  "prepTips": "Dissolves invisibly into sauces, soups, and dressings. Key ingredient in homemade ranch, onion dip, and burger seasoning. Clumps easily — same moisture-management rules as garlic powder.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Keep tightly sealed. Replace when it stops smelling distinctly like onion."},
  "substitutions": [{"id": "onion", "tier": "creative", "note": "Fresh — more moisture and sharper flavor. 1 tbsp powder ≈ ½ medium onion."}, {"id": "onion_salt", "tier": "caution", "note": "Mostly salt. Reduce other salt."}],
  "pairs": ["garlic_powder", "paprika", "black_pepper", "cumin", "chili_powder"],
  "origin": "Commercial dehydration (mid-20th century US). The fresh onion is one of the oldest cultivated crops — Mesopotamia, 5,000 years.",
  "culturalNotes": "Onion powder + garlic powder is the backbone of American convenience seasoning: ranch packets, french onion dip mix, McCormick season-all, Lawry''s, Shake Shack''s ShackSauce. It''s also fundamental to Chinese-American takeout seasoning.",
  "allergens": ["allium"],
  "nutrition": {"per": "1 tsp", "kcal": 8, "protein_g": 0.2, "fat_g": 0, "carb_g": 1.7}
}'::jsonb),

('ginger_powder', '{
  "description": "Dried, ground ginger root. Warmer and spicier than fresh — the drying process converts gingerol into the sharper shogaol, making it a baking and spice-blend ingredient more than a stir-fry one.",
  "flavorProfile": "Sharp, warm, peppery-sweet. More concentrated heat than fresh ginger; less bright and citrusy.",
  "prepTips": "Essential in gingerbread, pumpkin pie spice, chai, and curry powders. Not interchangeable with fresh in stir-fries or dressings — the flavor profile is genuinely different. 1 tsp ground ≈ 1 tbsp fresh grated.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Keeps well. The color fades before the flavor does."},
  "substitutions": [{"id": "ginger", "tier": "creative", "note": "Fresh — brighter, juicier, less concentrated. Swap ratios matter (1:3)."}],
  "pairs": ["cinnamon", "nutmeg", "cloves", "cardamom", "turmeric", "honey", "lemon"],
  "origin": "Southeast Asia — ginger has been cultivated in the tropics for over 3,000 years. China and India produce the most.",
  "culturalNotes": "Ground ginger was one of the most expensive medieval European spices. Gingerbread dates to at least the 10th century — German Lebkuchen, English gingerbread, and Swedish pepparkakor all descend from the same spice-trade tradition.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 6, "protein_g": 0.2, "fat_g": 0.1, "carb_g": 1.3}
}'::jsonb),

('italian_seasoning', '{
  "description": "A dried herb blend representing the baseline of Italian-American cooking. Not traditional to any specific Italian region — it''s an American pantry shortcut that combines the herbs you''d find in a Neapolitan nonna''s garden into one shaker.",
  "flavorProfile": "Herbal, warm, earthy, slightly floral. The oregano-basil-thyme trio does most of the work; the others add nuance.",
  "prepTips": "Crush between your palms to wake up the oils. Add to marinara, pizza dough, roasted vegetables, garlic bread, vinaigrettes. Goes in early for cooked dishes (the flavors need heat to meld), or late as a finishing sprinkle on bruschetta.",
  "storage": {"location": "pantry", "shelfLifeDays": 730, "tips": "Blends age faster than single spices because each herb degrades at a different rate. Replace yearly."},
  "substitutions": [{"id": "oregano", "tier": "direct", "note": "Oregano alone covers 60% of the blend''s job."}, {"id": "herbs_de_provence", "tier": "creative", "note": "French counterpart — adds lavender and savory but similar overall character."}],
  "blendOf": ["oregano", "dried_basil", "dried_thyme", "dried_rosemary", "dried_marjoram", "dried_sage"],
  "pairs": ["garlic", "tomato", "olive_oil", "mozzarella", "pasta", "bread"],
  "origin": "American invention, mid-20th century. McCormick and other spice companies popularized it as a convenience product. Traditional Italian cooks use individual herbs.",
  "culturalNotes": "Italian grandmothers do not use ''Italian seasoning'' — they use what''s growing outside. But for a weeknight garlic bread or a quick marinara, a pre-mixed blend of these six herbs is genuinely practical and not worth being precious about.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 3, "protein_g": 0.1, "fat_g": 0.1, "carb_g": 0.6}
}'::jsonb),

('curry_powder', '{
  "description": "A BLEND invented by the British to approximate Indian spice mixes (masalas) without the knowledge to build them from scratch. Typically turmeric + coriander + cumin + fenugreek + chili. No Indian cook uses ''curry powder'' — they build each dish''s masala from whole spices.",
  "flavorProfile": "Warm, earthy, slightly bitter (turmeric), complex. The turmeric dominates the color; the cumin and coriander dominate the flavor.",
  "prepTips": "Bloom in oil for 30-60 seconds before adding liquid — raw curry powder in water tastes dusty and flat. For a better result, toast and grind your own from whole cumin, coriander, turmeric, mustard seed, fenugreek, and chili.",
  "storage": {"location": "pantry", "shelfLifeDays": 365, "tips": "Shortest shelf life of any common blend — the turmeric and fenugreek fade fast. Replace every 6-12 months."},
  "substitutions": [{"id": "garam_masala", "tier": "creative", "note": "Warmer and more aromatic, no turmeric — add turmeric separately for the color."}],
  "blendOf": ["turmeric", "coriander", "cumin", "fenugreek", "cayenne", "ginger_powder", "black_pepper"],
  "pairs": ["coconut_milk", "onion", "garlic", "ginger", "chicken", "chickpeas", "rice"],
  "origin": "British India, 18th century. British merchants and returning colonial officers wanted to recreate Indian flavors at home — curry powder was the mass-market answer.",
  "culturalNotes": "The word ''curry'' itself is a British-colonial simplification of Tamil kari (sauce). Indian cuisine has hundreds of distinct masala compositions for different dishes — reducing them to one yellow powder is like reducing French cooking to ''French seasoning.'' That said, Madras curry powder (with extra chili heat) and Japanese curry roux (which uses curry powder as a base) are legitimate culinary traditions in their own right.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 7, "protein_g": 0.3, "fat_g": 0.3, "carb_g": 1.2}
}'::jsonb),

('garam_masala', '{
  "description": "North Indian warming spice blend — literally ''hot spice mix'' (garam = warm/hot). Unlike curry powder, garam masala is an actual Indian kitchen tradition. Every family has a different ratio; the blend is as personal as a signature.",
  "flavorProfile": "Warm, aromatic, complex, slightly sweet. Dominated by cardamom, cinnamon, and cloves — it smells like a spice bazaar. Less earthy than curry powder, more perfumed.",
  "prepTips": "Add at the END of cooking — the aromatics are volatile and heat destroys them. Sprinkle into a finished curry, dal, or biryani and stir once. For maximum depth, also add some at the start (for the base notes) and more at the end (for the top notes).",
  "storage": {"location": "pantry", "shelfLifeDays": 365, "tips": "Volatile aromatics fade fast. Buy small quantities. Making your own from whole spices is genuinely transformative and keeps 2-3 months."},
  "substitutions": [{"id": "curry_powder", "tier": "emergency", "note": "Different character entirely (earthy vs aromatic) but covers the same cuisine. Not a real substitute for a finishing garam masala."}],
  "blendOf": ["cardamom", "cinnamon", "cloves", "cumin", "coriander", "black_pepper", "nutmeg", "bay_leaves"],
  "pairs": ["cumin", "garlic", "ginger", "onion", "yogurt", "chicken", "rice", "lentils"],
  "origin": "North India — Punjab, Uttar Pradesh, and Kashmir each have distinct traditions. The blend concept dates back to Ayurvedic medicine (warming spices for cold-weather health).",
  "culturalNotes": "Every Indian household has ''their'' garam masala, often passed down from grandmothers. Some families toast and grind weekly. The Mughal court versions included saffron, rose petals, and mace — the blend has always been personal and regional. Store-bought is a compromise; homemade is a revelation.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 7, "protein_g": 0.3, "fat_g": 0.3, "carb_g": 1.3}
}'::jsonb)

ON CONFLICT (ingredient_id) DO UPDATE SET info = EXCLUDED.info, updated_at = now();
