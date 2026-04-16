-- Spice metadata seed batch 3: cumin + cinnamon + turmeric + oregano + bay leaves
-- Run after migration 0028. Safe to re-run (upsert).

INSERT INTO ingredient_info (ingredient_id, info) VALUES

('cumin', '{
  "description": "Dried seeds of Cuminum cyminum, used whole or ground. The warm, earthy backbone of Mexican, Indian, Middle Eastern, and North African cooking. If your chili, curry, or falafel tastes flat, it needs more cumin.",
  "flavorProfile": "Warm, earthy, slightly nutty, faintly bitter. Toasting intensifies the nuttiness dramatically.",
  "prepTips": "Toast whole seeds in dry pan for 60 seconds until fragrant before grinding — the flavor difference is enormous. For ground, bloom in oil for 15-30 seconds. Pairs with coriander so often they are practically one spice (the classic 2:1 cumin:coriander ratio).",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Whole seeds last 3-4 years. Ground loses punch within 6 months — buy whole and grind as needed if you can."},
  "substitutions": [{"id": "ground_cumin", "tier": "direct", "note": "Same spice, pre-ground. Less aromatic but fine."}, {"id": "coriander", "tier": "creative", "note": "Different flavor but fills the same warm-earthy role in a blend."}],
  "pairs": ["coriander", "garlic", "chili_powder", "lime", "beans", "onion", "yogurt"],
  "origin": "Eastern Mediterranean — cultivated in Egypt and the Levant for at least 4,000 years. Now grown primarily in India (Rajasthan), Turkey, Iran, and Mexico.",
  "culturalNotes": "Cumin is the second most consumed spice worldwide after black pepper. In Ayurvedic medicine it is considered a digestive aid (jeera water). In Mexican cuisine, comino is the bridge that makes Tex-Mex possible.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 8, "protein_g": 0.4, "fat_g": 0.5, "carb_g": 0.9}
}'::jsonb),

('coriander', '{
  "description": "Dried seeds of the cilantro plant (Coriandrum sativum). Warm, citrusy, and floral — nothing like the fresh leaves. The quiet partner to cumin in almost every spice-blend tradition worldwide.",
  "flavorProfile": "Warm, citrusy (lemon-orange), slightly sweet, floral. Toast it and the citrus pops forward.",
  "prepTips": "Lightly crush or toast whole seeds before adding to curries and braises. The flavor blooms in fat. Classic 2:1 cumin:coriander ratio in most Indian spice mixes.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Whole seeds keep 3+ years. Ground fades within 6 months."},
  "substitutions": [{"id": "cumin", "tier": "creative", "note": "Loses the citrus note but covers the earthy-warm role."}, {"id": "fennel_seed", "tier": "creative", "note": "Different but similarly warm and slightly sweet."}],
  "pairs": ["cumin", "garlic", "ginger", "lemon", "chicken", "carrot"],
  "origin": "One of the oldest cultivated spices — found in Tutankhamun''s tomb (1323 BCE). Native to the eastern Mediterranean. India is now the largest producer.",
  "culturalNotes": "Every culture that uses cumin also uses coriander — Indian, Mexican, Middle Eastern, Ethiopian, Thai. The seed and the leaf (cilantro) taste completely different because the volatile oil profiles diverge as the plant matures.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 5, "protein_g": 0.2, "fat_g": 0.3, "carb_g": 0.9}
}'::jsonb),

('cinnamon', '{
  "description": "Inner bark of Cinnamomum trees, dried into quills and ground. Two species dominate: Ceylon (true cinnamon, delicate and complex) and cassia (the common supermarket version, bold and spicy). Both work; they just work differently.",
  "flavorProfile": "Warm, sweet, woody. Ceylon is lighter and more nuanced; cassia is punchy, almost hot. Both carry cinnamaldehyde — the compound your brain instantly recognizes.",
  "prepTips": "Sticks in braises and mulled drinks (pull out before serving). Ground in baking, oatmeal, coffee, spice rubs. Bloom ground cinnamon in butter for cinnamon rolls — the fat carries the flavor deeper than dry sprinkling.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Sticks last 3-4 years. Ground fades within a year. The sniff test works perfectly — if it doesn''t smell like cinnamon, it won''t taste like it either."},
  "substitutions": [{"id": "ground_cinnamon", "tier": "direct", "note": "Same thing, ground."}, {"id": "nutmeg", "tier": "creative", "note": "Different flavor but fills the same warm-sweet-baking role. Use half the amount."}],
  "pairs": ["sugar", "apple", "chocolate", "nutmeg", "vanilla", "cardamom", "honey"],
  "origin": "Sri Lanka (Ceylon cinnamon) and southern China/Southeast Asia (cassia). The spice trade''s other anchor product alongside pepper — European powers fought wars over access to Ceylon''s cinnamon forests.",
  "culturalNotes": "Ancient Egyptians used cinnamon in embalming. The Romans burned it at funerals — Nero reportedly burned a year''s supply of cinnamon at his wife''s funeral as a display of grief (and wealth). The 90% of cinnamon sold in the US is actually cassia, not true cinnamon.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 6, "protein_g": 0.1, "fat_g": 0, "carb_g": 2.1, "fiber_g": 1.4}
}'::jsonb),

('turmeric', '{
  "description": "Ground dried rhizome of Curcuma longa. Earthy, warm, slightly bitter — and powerfully golden-yellow. The color is the main event in many dishes; the flavor is supporting cast. Curcumin (the pigment) stains everything it touches.",
  "flavorProfile": "Warm, earthy, slightly bitter, peppery. Almost musky raw — blooming in oil or cooking for a few minutes tames the bitterness and brings out the warmth.",
  "prepTips": "ALWAYS bloom in oil or fat — raw turmeric in water tastes bitter and dusty. A pinch of black pepper increases curcumin absorption by 2000% (piperine effect). Stains cutting boards, clothes, countertops, and fingers — use stainless steel and wipe immediately.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Loses color (and therefore potency) faster than most spices. If it looks pale tan instead of deep gold, replace it."},
  "substitutions": [{"id": "saffron", "tier": "emergency", "note": "Completely different flavor but provides the golden color. Expensive overkill for a curry."}, {"id": "paprika", "tier": "emergency", "note": "Orange instead of gold, different flavor — only works for color matching."}],
  "pairs": ["black_pepper", "ginger", "cumin", "coconut_milk", "garlic", "rice"],
  "origin": "India and Southeast Asia. India produces ~80% of the world''s turmeric. Erode, Tamil Nadu is the turmeric trading capital.",
  "culturalNotes": "Sacred in Hindu culture — turmeric paste (haldi) is central to wedding ceremonies. Ayurveda has used it medicinally for 4,000 years. Golden milk (turmeric + milk + honey) went from Indian grandmother remedy to global wellness trend in the 2010s.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 9, "protein_g": 0.3, "fat_g": 0.1, "carb_g": 2, "fiber_g": 0.7}
}'::jsonb),

('oregano', '{
  "description": "Dried leaves of Origanum vulgare (Mediterranean) or Lippia graveolens (Mexican). The pizza herb — robust, slightly bitter, and earthy. Mexican oregano is citrusy and works better with chili; Mediterranean is more floral and pairs with tomato.",
  "flavorProfile": "Pungent, earthy, slightly bitter, warm. Mexican oregano adds a lemony brightness. Dried oregano is actually MORE concentrated than fresh — the drying process intensifies the essential oils.",
  "prepTips": "Crush between your palms before adding to release the oils. Goes in early for braises and sauces (it needs time to mellow). For pizza and salads, add at the end or even as a garnish. One of the few herbs that is genuinely better dried than fresh in many applications.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Keeps potency well. Still — the sniff test tells all. No aroma = no flavor."},
  "substitutions": [{"id": "dried_marjoram", "tier": "direct", "note": "Milder, sweeter cousin — works 1:1 in Italian dishes."}, {"id": "dried_thyme", "tier": "creative", "note": "Different character but fills the same Mediterranean dried-herb role."}],
  "pairs": ["tomato", "garlic", "olive_oil", "basil", "lemon", "beans", "chicken"],
  "origin": "Mediterranean basin — the name means ''joy of the mountain'' in Greek (oros + ganos). Mexican oregano is a different plant entirely from a different family (Verbenaceae).",
  "culturalNotes": "The herb that defines Italian-American pizza and Greek salad. Also foundational in Mexican cooking (pozole, chili) — but that''s Mexican oregano, and the distinction matters. They''re not interchangeable in critical recipes.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 5, "protein_g": 0.2, "fat_g": 0.1, "carb_g": 1.2}
}'::jsonb),

('bay_leaves', '{
  "description": "Dried leaves of Laurus nobilis. The aromatic backbone of stocks, braises, soups, and beans. The flavor is subtle and works over time — you won''t taste bay in a 10-minute sauce, but after 30 minutes of simmering it adds a complex herbal-eucalyptus depth that''s impossible to replicate.",
  "flavorProfile": "Herbal, slightly floral, faint eucalyptus/menthol, woody. Works below conscious perception — you don''t taste ''bay leaf,'' you taste a soup that has depth vs one that''s flat.",
  "prepTips": "Add at the start of cooking. Snap in half to release more oil surface area. ALWAYS remove before serving — they don''t soften and are a choking hazard. Turkish bay leaves are milder and more common; California bay is much more potent (use half).",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Keep sealed and dry. Hold a leaf up to light — if it''s brown and brittle with no visible oil spots, it''s done."},
  "substitutions": [{"id": "dried_thyme", "tier": "emergency", "note": "Different but fills a similar background-herbal role."}, {"id": "dried_oregano", "tier": "emergency", "note": "Adds herbal depth but a noticeably different character."}],
  "pairs": ["onion", "garlic", "chicken_stock", "tomato", "beans", "potato", "beef"],
  "origin": "Mediterranean — the laurel tree was sacred to Apollo in Greek mythology. Bay laurel wreaths crowned victors and poets (laureate comes from laurus).",
  "culturalNotes": "The eternal debate: ''do bay leaves actually do anything?'' They do. Cook a beef stew side-by-side with and without a bay leaf and the one without tastes flatter. The effect is architectural — you don''t taste the leaf, you taste the space it filled.",
  "allergens": [],
  "nutrition": {"per": "1 leaf", "kcal": 2, "protein_g": 0, "fat_g": 0, "carb_g": 0.5}
}'::jsonb)

ON CONFLICT (ingredient_id) DO UPDATE SET info = EXCLUDED.info, updated_at = now();
