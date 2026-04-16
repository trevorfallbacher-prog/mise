-- Spice metadata seed batch 5: warm spices (cardamom, cloves, nutmeg, allspice, star anise, fennel seed)
-- Run after migration 0028. Safe to re-run (upsert).

INSERT INTO ingredient_info (ingredient_id, info) VALUES

('cardamom', '{
  "description": "Green pods of Elettaria cardamomum — the third most expensive spice after saffron and vanilla. Intensely aromatic, floral, and complex. A little goes a very long way. Used whole (pod) or ground (seeds only, hull discarded).",
  "flavorProfile": "Intensely floral, citrusy, eucalyptus-menthol, warm-sweet. Complex enough to work in both savory curries and sweet desserts. The aroma is almost perfume-like.",
  "prepTips": "Crack pods with the flat of a knife to expose seeds before adding to rice, curries, or chai. For baking, grind seeds fresh — pre-ground cardamom is a shadow of the real thing. Remove whole pods before serving.",
  "storage": {"location": "pantry", "shelfLifeDays": 1460, "tips": "Whole pods keep 3-4 years sealed. Ground lasts 3-6 months max. The pod is the world''s best natural spice package — don''t grind until you need to."},
  "substitutions": [{"id": "cinnamon", "tier": "emergency", "note": "Entirely different but fills the ''warm-sweet'' role in baking. Nothing truly substitutes cardamom."}],
  "pairs": ["cinnamon", "ginger", "cloves", "coffee", "rose", "saffron", "yogurt", "rice"],
  "origin": "Southern India (Kerala, Karnataka) and Guatemala. India consumes most of its own production; Guatemala is the largest exporter. The ''Queen of Spices.''",
  "culturalNotes": "Essential to Scandinavian baking (kardemummabullar — cardamom buns), Arabic coffee (gahwa), Indian chai, and East African pilau. Vikings picked it up from Arab traders in Constantinople and brought it home; it became more central to Nordic baking than cinnamon.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 6, "protein_g": 0.2, "fat_g": 0.1, "carb_g": 1.4}
}'::jsonb),

('cloves', '{
  "description": "Dried flower buds of Syzygium aromaticum. Intensely aromatic and warming — a single clove can perfume an entire pot of mulled wine. The eugenol compound (80% of clove oil) is the same thing dentists use as a topical anesthetic.",
  "flavorProfile": "Intensely warm, sweet, slightly bitter, numbing. Assertive enough to dominate a dish — always use with restraint.",
  "prepTips": "Whole cloves in braises, hams, and mulled drinks — stud an onion with 3-4 cloves for a classic stock aromatics trick. Ground cloves in baking (pumpkin pie, gingerbread). ALWAYS err on the side of less — the flavor compounds are 5-10x more concentrated than most spices.",
  "storage": {"location": "pantry", "shelfLifeDays": 1460, "tips": "Whole cloves are one of the longest-lasting spices. A fresh clove will release oil when pressed with a fingernail."},
  "substitutions": [{"id": "allspice", "tier": "direct", "note": "Allspice contains eugenol too — the closest natural substitute. Use half the amount."}],
  "pairs": ["cinnamon", "nutmeg", "ham", "apple", "orange", "onion", "ginger"],
  "origin": "Maluku Islands (Moluccas), Indonesia — the original Spice Islands. The Dutch East India Company fought wars to monopolize clove production.",
  "culturalNotes": "Indonesian kretek cigarettes are ~40% cloves — Indonesia consumes roughly half the world''s clove production for this purpose. In cooking, cloves appear in Chinese five-spice, Indian garam masala, German Lebkuchen, and the French quatre épices. The Moluccan clove trade was the direct cause of European colonization of Southeast Asia.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 7, "protein_g": 0.1, "fat_g": 0.4, "carb_g": 1.3}
}'::jsonb),

('nutmeg', '{
  "description": "Seed of Myristica fragrans, grated or ground. Warm, sweet, and slightly psychoactive in absurd quantities (don''t). The quintessential béchamel and eggnog spice — a whisper of nutmeg makes cream sauces taste ''right'' without being identifiable.",
  "flavorProfile": "Warm, sweet, nutty, slightly woody. Best used as a background note — when you can distinctly taste nutmeg, you''ve used too much.",
  "prepTips": "Grate fresh on a microplane — the difference between fresh and pre-ground is dramatic. A few scrapes into béchamel, mashed potatoes, creamed spinach, French toast batter, or eggnog. Goes in at the end of cooking.",
  "storage": {"location": "pantry", "shelfLifeDays": 1825, "tips": "Whole nutmeg lasts 5+ years. Ground loses potency in months. Buy whole and grate as needed — a single nutmeg lasts for dozens of recipes."},
  "substitutions": [{"id": "mace", "tier": "direct", "note": "Mace is the outer covering of the same seed — lighter, more delicate, virtually the same flavor family."}, {"id": "allspice", "tier": "creative", "note": "Different but similarly warm-sweet. Works in baking substitutions."}],
  "pairs": ["cream", "butter", "spinach", "potato", "egg", "cinnamon", "vanilla"],
  "origin": "Banda Islands, Indonesia. Another Spice Islands native — the Dutch massacred the Bandanese in 1621 to secure a nutmeg monopoly.",
  "culturalNotes": "Nutmeg contains myristicin, which in extremely large doses is a deliriant — this is not recreational, it''s genuinely dangerous and deeply unpleasant. In normal culinary quantities it''s perfectly safe and essential to European cuisine: béchamel, gratins, Dutch speculaas, Italian tortellini filling.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 12, "protein_g": 0.1, "fat_g": 0.8, "carb_g": 1.1}
}'::jsonb),

('allspice', '{
  "description": "Dried unripe berries of Pimenta dioica — called allspice because it smells like cinnamon, nutmeg, and cloves combined. Not a blend; it''s a single berry from a single tree. Jamaica produces most of the world''s supply.",
  "flavorProfile": "Warm, complex — cinnamon + nutmeg + cloves in one. Slightly peppery. The eugenol content (shared with cloves) gives it that familiar warming bite.",
  "prepTips": "Whole berries in jerk marinades, braises, pickles, and mulled drinks. Ground in baking (pumpkin pie, gingerbread, carrot cake). Like cloves, a little goes far — 2-3 whole berries or ¼ tsp ground is usually enough.",
  "storage": {"location": "pantry", "shelfLifeDays": 1460, "tips": "Whole berries keep 3-4 years. Ground fades within a year."},
  "substitutions": [{"id": "cloves", "tier": "creative", "note": "Covers the eugenol component. Add a pinch of cinnamon and nutmeg to approximate the rest."}],
  "pairs": ["cinnamon", "nutmeg", "cloves", "ginger", "brown_sugar", "rum", "jerk"],
  "origin": "Jamaica and Central America. The Arawak people used it long before Columbus, who encountered it on his second voyage (1494) and mistakenly called it pimienta (pepper).",
  "culturalNotes": "Allspice IS Jamaican jerk seasoning — it''s the one non-negotiable ingredient alongside Scotch bonnet peppers and thyme. The wood itself is used as the smoking fuel for traditional jerk. Also fundamental to Middle Eastern baharat blends and Scandinavian herring cures.",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 5, "protein_g": 0.1, "fat_g": 0.2, "carb_g": 1.4}
}'::jsonb),

('star_anise', '{
  "description": "Star-shaped fruit of Illicium verum — each point holds a single seed. The anethole compound (shared with fennel and anise seed) delivers the unmistakable licorice flavor. Central to Chinese and Vietnamese cooking.",
  "flavorProfile": "Intensely licorice/anise, warm, sweet. More potent and complex than anise seed — woodier, with a slightly bitter edge.",
  "prepTips": "Use whole pods in braises (remove before serving). One star is usually enough for a pot of pho or a red-braised pork shoulder. For five-spice powder, grind fresh. Pairs with soy sauce and rock sugar in Chinese master stocks.",
  "storage": {"location": "pantry", "shelfLifeDays": 1460, "tips": "Whole stars keep 3-4 years. Ground fades within 6 months. Buy whole and grind per-recipe."},
  "substitutions": [{"id": "fennel_seed", "tier": "creative", "note": "Milder licorice — use more. Different enough that a pho without star anise won''t taste right."}],
  "pairs": ["soy_sauce", "ginger", "cinnamon", "cloves", "pork", "duck", "fennel"],
  "origin": "Southern China and northern Vietnam. The primary ingredient in Chinese five-spice and the essential aromatic in Vietnamese phở.",
  "culturalNotes": "Star anise is the industrial source of shikimic acid, the precursor to Tamiflu (oseltamivir). During the 2005 avian flu scare, Roche bought up so much star anise that the price spiked globally and Chinese cooks couldn''t get enough for their kitchens.",
  "allergens": [],
  "nutrition": {"per": "1 pod", "kcal": 7, "protein_g": 0.3, "fat_g": 0.3, "carb_g": 1}
}'::jsonb),

('fennel_seed', '{
  "description": "Dried seeds of Foeniculum vulgare. Mildly licorice-sweet and warming — the gentler, more approachable cousin of star anise. Italian sausage seasoning, Indian after-dinner digestif, and the secret ingredient in many spice blends.",
  "flavorProfile": "Sweet, licorice-anise, warm. Toasting brings out a deeper nutty-caramel note that softens the licorice.",
  "prepTips": "Toast in a dry pan for 60 seconds until fragrant — the flavor transforms. Crack lightly before adding to sausage mixes. Chew a few seeds after a heavy meal (Indian mukhwas tradition) — genuinely aids digestion.",
  "storage": {"location": "pantry", "shelfLifeDays": 1460, "tips": "Keeps 3-4 years whole. Ground fennel fades within 6 months."},
  "substitutions": [{"id": "star_anise", "tier": "creative", "note": "Stronger licorice — use much less. Half a star ≈ 1 tsp fennel seed."}, {"id": "caraway_seed", "tier": "creative", "note": "Similar shape and size but earthy rather than licorice. Works in sausage."}],
  "pairs": ["pork", "sausage", "tomato", "orange", "fish", "cumin"],
  "origin": "Mediterranean — the Romans cultivated fennel extensively. Now grown across India, Egypt, and China as well.",
  "culturalNotes": "Fennel seed is what makes Italian sausage taste like Italian sausage. The classic ratio: 1 tbsp per pound of pork. Also the dominant flavor in Indian panch phoron (five-spice tempering with mustard, cumin, fenugreek, and nigella).",
  "allergens": [],
  "nutrition": {"per": "1 tsp", "kcal": 7, "protein_g": 0.3, "fat_g": 0.3, "carb_g": 1}
}'::jsonb)

ON CONFLICT (ingredient_id) DO UPDATE SET info = EXCLUDED.info, updated_at = now();
