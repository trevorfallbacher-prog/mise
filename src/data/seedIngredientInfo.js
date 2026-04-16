// Bundled ingredient_info seed data.
//
// This module exports an array that mirrors the ingredient_info table shape
// in Supabase: { ingredient_id, info } per row. The auto-seeder
// (src/lib/seedIngredientInfo.js) upserts these rows on first login so
// users never need to run SQL by hand.
//
// As more ingredient metadata moves from the JS INGREDIENT_INFO object in
// src/data/ingredients.js to this DB-backed format, append entries here
// and bump SEED_VERSION below to force a re-seed for existing users.
//
// Same shape that getIngredientInfo() in ingredients.js consumes — see
// the comment block at the top of that file for the full schema.

// Bump this when seed data changes so existing users get the update.
// The seeder gates on a localStorage key tied to this version.
export const SEED_VERSION = 1;

export const SEED_INGREDIENT_INFO = [
  {
    ingredient_id: "kosher_salt",
    info: {
      description: "Coarse-grained salt with no additives. The default cooking salt for professionals — the large flakes are easy to pinch and distribute evenly, and the open crystal structure dissolves quickly on contact with moisture.",
      flavorProfile: "Pure salt, clean, no metallic or bitter aftertaste",
      prepTips: "Pinch from a bowl, not a shaker. Season from 12 inches above so it distributes. Taste as you go — you can always add, never subtract.",
      storage: { location: "pantry", shelfLifeDays: 9999, tips: "Indefinite shelf life. Keep in a wide-mouth bowl or cellar near the stove for easy pinching." },
      substitutions: [
        { id: "sea_salt", tier: "direct", note: "Slightly different crystal size; adjust by taste." },
        { id: "table_salt", tier: "caution", note: "Much denser per volume — use half the amount or measure by weight." },
      ],
      pairs: ["black_pepper", "garlic", "lemon", "butter"],
      origin: "Historically produced for the kosher meat-curing process (koshering), not because the salt itself is kosher. Diamond Crystal and Morton are the two dominant brands in the US, with meaningfully different densities.",
      culturalNotes: "Diamond Crystal vs Morton is the great kitchen schism. Diamond is ~40% less dense per teaspoon — recipes that just say kosher salt usually mean Diamond. If you use Morton, scale down by about a third.",
      allergens: [],
      nutrition: { per: "1 tsp", kcal: 0, sodium_mg: 1120 },
      sourcing: "Diamond Crystal for cooking (hollow flakes, dissolves fast, easy to pinch). Morton for baking where you need consistent weight-per-volume.",
    },
  },
  {
    ingredient_id: "black_pepper",
    info: {
      description: "Dried unripe berries of Piper nigrum, the most traded spice in human history. The piperine compound delivers the heat; volatile oils deliver the aroma. Freshly ground is non-negotiable — pre-ground loses potency within weeks.",
      flavorProfile: "Sharp, warm, piney, slightly floral. Tellicherry peppercorns (left to ripen longer on the vine) are fruitier and more complex.",
      prepTips: "Always grind fresh — a pepper mill is the single biggest upgrade for a new cook. Add early for background warmth, add at the end for aromatic punch.",
      storage: { location: "pantry", shelfLifeDays: 1095, tips: "Whole peppercorns last 3+ years. Ground pepper loses potency in 3-6 months. Keep in a mill, not a shaker." },
      substitutions: [
        { id: "white_pepper", tier: "direct", note: "Same plant, different processing — hotter, less aromatic, no dark specks in light sauces." },
      ],
      pairs: ["salt", "lemon", "garlic", "steak", "eggs", "pasta", "butter"],
      origin: "Native to Kerala, India (Malabar Coast). The spice that launched the Age of Exploration — Europeans sailed around Africa and across oceans to bypass the Arab spice monopoly.",
      culturalNotes: "Pepper was literally worth its weight in gold in medieval Europe. Rent, taxes, and dowries were paid in peppercorns. The phrase peppercorn rent (a token payment) survives in English law.",
      allergens: [],
      nutrition: { per: "1 tsp", kcal: 6, protein_g: 0.2, fat_g: 0.1, carb_g: 1.5 },
    },
  },
  {
    ingredient_id: "paprika",
    info: {
      description: "Dried, ground red peppers — the baseline paprika. Ranges from sweet and mild (Hungarian édesnemes) to moderately warm. The workhorse behind goulash, deviled eggs, and anything that needs warm red color without serious heat.",
      flavorProfile: "Sweet, warm, mildly earthy, fruity. Almost no heat — the sweetness of dried pepper is the point.",
      prepTips: "Bloom in hot oil or butter for 15-30 seconds to activate the fat-soluble pigments. Never add to screaming-hot oil — it scorches instantly and turns bitter.",
      storage: { location: "pantry", shelfLifeDays: 730, tips: "Loses color and potency faster than most spices. Replace every 1-2 years. If it smells like nothing, it IS nothing." },
      substitutions: [
        { id: "smoked_paprika", tier: "direct", note: "Adds smokiness — great for some dishes, overpowering for others." },
        { id: "cayenne", tier: "caution", note: "10-20x hotter. Use a pinch where you would use a teaspoon." },
      ],
      pairs: ["garlic", "onion", "chicken", "potato", "eggs", "sour_cream"],
      origin: "Central Mexico (the peppers), brought to Spain and Hungary by the 16th century. Hungary made it the national spice — Szeged and Kalocsa are the two great paprika regions.",
      culturalNotes: "Hungary classifies paprika into eight grades from különleges (delicate, bright red) to erős (hot). The Nobel Prize for Vitamin C was awarded for work on Hungarian paprika.",
      allergens: ["nightshade"],
      nutrition: { per: "1 tsp", kcal: 6, protein_g: 0.3, fat_g: 0.3, carb_g: 1.2 },
    },
  },
  {
    ingredient_id: "cumin",
    info: {
      description: "Dried seeds of Cuminum cyminum, used whole or ground. The warm, earthy backbone of Mexican, Indian, Middle Eastern, and North African cooking. If your chili, curry, or falafel tastes flat, it needs more cumin.",
      flavorProfile: "Warm, earthy, slightly nutty, faintly bitter. Toasting intensifies the nuttiness dramatically.",
      prepTips: "Toast whole seeds in dry pan for 60 seconds until fragrant before grinding — the flavor difference is enormous. Pairs with coriander so often they are practically one spice (the classic 2:1 cumin:coriander ratio).",
      storage: { location: "pantry", shelfLifeDays: 1095, tips: "Whole seeds last 3-4 years. Ground loses punch within 6 months — buy whole and grind as needed if you can." },
      substitutions: [
        { id: "ground_cumin", tier: "direct", note: "Same spice, pre-ground." },
        { id: "coriander", tier: "creative", note: "Different flavor but fills the same warm-earthy role in a blend." },
      ],
      pairs: ["coriander", "garlic", "chili_powder", "lime", "beans", "onion", "yogurt"],
      origin: "Eastern Mediterranean — cultivated in Egypt and the Levant for at least 4,000 years.",
      culturalNotes: "Cumin is the second most consumed spice worldwide after black pepper. In Ayurvedic medicine it is considered a digestive aid (jeera water).",
      allergens: [],
      nutrition: { per: "1 tsp", kcal: 8, protein_g: 0.4, fat_g: 0.5, carb_g: 0.9 },
    },
  },
  {
    ingredient_id: "garlic_powder",
    info: {
      description: "Dehydrated garlic, ground fine. Delivers garlic flavor without the moisture, texture, or burn of fresh — it dissolves into dry rubs, marinades, and doughs where fresh garlic can't go. Not a substitute for fresh in sautés; a complement to it.",
      flavorProfile: "Mellow, sweet, roasted-garlic character. Less sharp and pungent than fresh — the dehydration tames the allicin bite.",
      prepTips: "Hydrate in a few drops of water before adding to wet dishes — prevents clumping. Do NOT confuse with garlic salt (which is ~75% salt).",
      storage: { location: "pantry", shelfLifeDays: 1095, tips: "Hygroscopic — absorbs moisture and clumps. A clumped jar is past its prime." },
      substitutions: [
        { id: "garlic", tier: "creative", note: "Fresh garlic — more pungent, adds moisture. ⅛ tsp powder ≈ 1 clove." },
      ],
      pairs: ["onion_powder", "paprika", "black_pepper", "cumin", "oregano"],
      origin: "Dehydrated garlic originated in commercial food processing (mid-20th century US), but garlic itself is Central Asian — cultivated for 5,000+ years.",
      culturalNotes: "Snobs dismiss garlic powder but professional kitchens use it constantly. It does something fresh garlic literally cannot: distribute evenly in a dry rub, season a burger patty throughout, or flavor bread dough without wet pockets.",
      allergens: ["allium"],
      nutrition: { per: "1 tsp", kcal: 10, protein_g: 0.5, fat_g: 0, carb_g: 2 },
    },
  },
  {
    ingredient_id: "italian_seasoning",
    info: {
      description: "A dried herb blend representing the baseline of Italian-American cooking. Not traditional to any specific Italian region — it's an American pantry shortcut that combines the herbs you'd find in a Neapolitan nonna's garden into one shaker.",
      flavorProfile: "Herbal, warm, earthy, slightly floral. The oregano-basil-thyme trio does most of the work; the others add nuance.",
      prepTips: "Crush between your palms to wake up the oils. Add to marinara, pizza dough, roasted vegetables, garlic bread, vinaigrettes.",
      storage: { location: "pantry", shelfLifeDays: 730, tips: "Blends age faster than single spices because each herb degrades at a different rate. Replace yearly." },
      substitutions: [
        { id: "oregano", tier: "direct", note: "Oregano alone covers 60% of the blend's job." },
        { id: "herbs_de_provence", tier: "creative", note: "French counterpart — adds lavender and savory but similar overall character." },
      ],
      blendOf: ["oregano", "dried_basil", "dried_thyme", "dried_rosemary", "dried_marjoram", "dried_sage"],
      pairs: ["garlic", "tomato", "olive_oil", "mozzarella", "pasta", "bread"],
      origin: "American invention, mid-20th century. McCormick and other spice companies popularized it as a convenience product. Traditional Italian cooks use individual herbs.",
      culturalNotes: "Italian grandmothers do not use 'Italian seasoning' — they use what's growing outside. But for a weeknight garlic bread or a quick marinara, a pre-mixed blend is genuinely practical.",
      allergens: [],
      nutrition: { per: "1 tsp", kcal: 3, protein_g: 0.1, fat_g: 0.1, carb_g: 0.6 },
    },
  },
];
