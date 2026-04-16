-- Spice metadata seed batch 2: paprika family + chili peppers
-- Run after migration 0028. Safe to re-run (upsert).

INSERT INTO ingredient_info (ingredient_id, info) VALUES

('paprika', '{
  "description": "Dried, ground red peppers — the baseline paprika. Ranges from sweet and mild (Hungarian édesnemes) to moderately warm depending on the variety and country of origin. The workhorse behind goulash, deviled eggs, and anything that needs a warm red color without serious heat.",
  "flavorProfile": "Sweet, warm, mildly earthy, fruity. Almost no heat — the sweetness of dried pepper is the point.",
  "prepTips": "Bloom in hot oil or butter for 15-30 seconds to activate the fat-soluble pigments and deepen the flavor. Never add to screaming-hot oil — it scorches instantly and turns bitter. Sprinkle on deviled eggs, potato salad, hummus for color.",
  "storage": {"location": "pantry", "shelfLifeDays": 730, "tips": "Loses color and potency faster than most spices. Replace every 1-2 years. If it smells like nothing, it IS nothing."},
  "substitutions": [{"id": "smoked_paprika", "tier": "direct", "note": "Adds smokiness — great for some dishes, overpowering for others."}, {"id": "cayenne", "tier": "caution", "note": "10-20x hotter. Use a pinch where you would use a teaspoon."}],
  "pairs": ["garlic", "onion", "chicken", "potato", "eggs", "sour_cream"],
  "origin": "Central Mexico (the peppers), brought to Spain and Hungary by the 16th century. Hungary made it the national spice — Szeged and Kalocsa are the two great paprika regions.",
  "culturalNotes": "Hungary classifies paprika into eight grades from különleges (delicate, bright red) to erős (hot). Hungarian goulash is unthinkable without it. The Nobel Prize for Vitamin C was awarded for work on Hungarian paprika — it has more C per gram than citrus.",
  "allergens": ["nightshade"],
  "nutrition": {"per": "1 tsp", "kcal": 6, "protein_g": 0.3, "fat_g": 0.3, "carb_g": 1.2}
}'::jsonb),

('smoked_paprika', '{
  "description": "Pimentón de la Vera — peppers dried over smoldering oak for two weeks, then ground. The smokiness is deep and real (not liquid smoke). Spanish cuisine''s secret weapon.",
  "flavorProfile": "Intensely smoky, sweet-warm, complex. Transforms anything it touches — a half teaspoon makes a bean soup taste like it simmered over a campfire.",
  "prepTips": "A little goes far — start with ¼ tsp and build. Bloom in oil for maximum impact. Pairs insanely well with roasted vegetables, aioli, and anything tomato-based.",
  "storage": {"location": "pantry", "shelfLifeDays": 730, "tips": "Keep sealed tightly — the smoke compounds are volatile. Tin containers (the traditional Spanish packaging) preserve better than glass."},
  "substitutions": [{"id": "paprika", "tier": "direct", "note": "Loses the smoke; add a drop of liquid smoke to compensate (or don''t — sometimes you just want the color)."}, {"id": "chipotle", "tier": "creative", "note": "Smoked jalapeño powder — adds smoke + significant heat."}],
  "pairs": ["chickpeas", "potato", "tomato", "aioli", "eggs", "chorizo"],
  "origin": "La Vera valley, Extremadura, Spain. The peppers are exclusively oak-smoked — the method is protected by D.O. Pimentón de la Vera designation.",
  "culturalNotes": "The three grades: dulce (sweet), agridulce (bittersweet), picante (hot). Dulce is the most common export. Spanish chorizo gets its character from pimentón, not chili heat — it''s a fundamentally different sausage from Mexican chorizo because of this one spice.",
  "allergens": ["nightshade"],
  "nutrition": {"per": "1 tsp", "kcal": 6, "protein_g": 0.3, "fat_g": 0.3, "carb_g": 1.2}
}'::jsonb),

('cayenne', '{
  "description": "Finely ground dried cayenne peppers. Pure, clean heat (30,000-50,000 Scoville) with minimal flavor complexity — it''s a heat delivery mechanism, not a flavor spice. The kitchen equivalent of a volume knob for spiciness.",
  "flavorProfile": "Sharp, biting heat with a slight fruity undertone. No smokiness, no sweetness — just capsaicin punch.",
  "prepTips": "Start with ⅛ tsp and taste. You can always add more; you cannot remove heat. Dissolves into liquids invisibly — great for soups, sauces, mac and cheese, bloody marys. For a slow-build warmth, add early; for a sharp bite, add at the end.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Potent for years. Replace when the color fades from bright red to dull brown."},
  "substitutions": [{"id": "red_pepper_flakes", "tier": "direct", "note": "Coarser texture, slightly different heat distribution (flakes give bursts, cayenne gives even heat)."}, {"id": "chili_powder", "tier": "caution", "note": "Chili powder is a BLEND with cumin, garlic, oregano — much more complex, much less hot."}],
  "pairs": ["garlic", "lemon", "butter", "chocolate", "honey", "lime"],
  "origin": "Named after Cayenne, French Guiana, but cultivated worldwide in tropical and subtropical regions.",
  "culturalNotes": "The capsaicin in cayenne triggers endorphin release — the pain-pleasure loop that makes spicy food addictive. Medicinally, capsaicin is used in topical pain creams. Cayenne in hot chocolate dates to Aztec xocolatl traditions.",
  "allergens": ["nightshade"],
  "nutrition": {"per": "1 tsp", "kcal": 6, "protein_g": 0.2, "fat_g": 0.3, "carb_g": 1}
}'::jsonb),

('chili_powder', '{
  "description": "A BLEND, not a single spice. Typically ground dried chili peppers + cumin + garlic powder + oregano + sometimes paprika, onion powder, and cocoa. The all-in-one seasoning behind Tex-Mex chili con carne.",
  "flavorProfile": "Warm, earthy, mildly spicy, savory. Complex because it IS multiple spices. Much less hot than cayenne — the other ingredients buffer the heat.",
  "prepTips": "Bloom in oil with onions and garlic at the start of chili, taco meat, or enchilada sauce. The cumin and oregano in the blend need heat to open up. Toast 30-60 seconds until fragrant.",
  "storage": {"location": "pantry", "shelfLifeDays": 730, "tips": "Blends lose potency faster than single spices because the volatile oils from each component degrade at different rates. Replace yearly."},
  "substitutions": [{"id": "cayenne", "tier": "caution", "note": "Pure heat, no depth — add cumin + garlic powder + oregano separately to reconstruct."}, {"id": "paprika", "tier": "emergency", "note": "Color but almost no heat or cumin earthiness."}],
  "pairs": ["cumin", "garlic", "onion", "beef", "beans", "tomato", "corn"],
  "blendOf": ["cayenne", "cumin", "garlic_powder", "oregano", "paprika"],
  "origin": "American Southwest / Tex-Mex invention, 19th century. Not traditional to Mexican cuisine — Mexican cooks use individual dried chili varieties.",
  "culturalNotes": "Gebhardt''s Eagle Chili Powder (San Antonio, 1890s) is credited as the first commercial blend. The idea was to make chili con carne accessible without sourcing individual dried peppers. Every brand has a different ratio — some hotter, some sweeter, some heavier on cumin.",
  "allergens": ["nightshade"],
  "nutrition": {"per": "1 tsp", "kcal": 8, "protein_g": 0.3, "fat_g": 0.4, "carb_g": 1.3}
}'::jsonb),

('red_pepper_flakes', '{
  "description": "Crushed dried red chili peppers — usually cayenne-type but varies by brand. The seeds are left in, which is where most of the heat lives. The universal pizza-shop condiment and the lazy cook''s heat shortcut.",
  "flavorProfile": "Sharp, fruity heat with textural crunch from the seeds. Less uniform than ground cayenne — you get bursts of heat where a flake lands.",
  "prepTips": "Bloom in olive oil at the start of a pasta sauce (aglio e olio, arrabbiata) for 30-60 seconds — the oil carries the capsaicin into every bite. For finishing, sprinkle on pizza, salads, avocado toast. The seeds toast beautifully in a dry pan.",
  "storage": {"location": "pantry", "shelfLifeDays": 1095, "tips": "Long-lasting. The coarser grind protects the volatile oils better than fine powder."},
  "substitutions": [{"id": "cayenne", "tier": "direct", "note": "Finer texture, more even heat distribution. ½ tsp cayenne ≈ 1 tsp flakes."}],
  "pairs": ["olive_oil", "garlic", "pasta", "pizza", "honey"],
  "origin": "Italian-American condiment culture — the shaker on every pizzeria table. Calabrian peppers (peperoncino) are the Italian original.",
  "culturalNotes": "In Italian cooking, peperoncino (fresh or dried) is fundamental to Southern cuisine — aglio, olio e peperoncino is three ingredients and one of the best pastas ever made. The American crushed red pepper flake is a simplified descendant.",
  "allergens": ["nightshade"],
  "nutrition": {"per": "1 tsp", "kcal": 6, "protein_g": 0.2, "fat_g": 0.3, "carb_g": 1}
}'::jsonb)

ON CONFLICT (ingredient_id) DO UPDATE SET info = EXCLUDED.info, updated_at = now();
