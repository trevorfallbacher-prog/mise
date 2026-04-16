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
export const SEED_VERSION = 6;

export const SEED_INGREDIENT_INFO = [
  {
    ingredient_id: "kosher_salt",
    info: {
      description: "Coarse-grained salt with no additives. The default cooking salt for professionals — the large flakes are easy to pinch and distribute evenly, and the open crystal structure dissolves quickly on contact with moisture.",
      flavorProfile: "Pure salt, clean, no metallic or bitter aftertaste",
      prepTips: "Pinch from a bowl, not a shaker. Season from 12 inches above so it distributes. Taste as you go — you can always add, never subtract.",
      storage: {
        location: "pantry",
        shelfLifeDays: 9999,
        shelfLife: { fridge: null, freezer: null, pantry: 9999 },
        tips: "Indefinite shelf life. Keep in a wide-mouth bowl or cellar near the stove for easy pinching.",
        spoilageSigns: "Doesn't spoil. Clumping just means it absorbed moisture — break it up and use it.",
        freezable: false,
      },
      substitutions: [
        { id: "sea_salt", tier: "direct", note: "Slightly different crystal size; adjust by taste." },
        { id: "table_salt", tier: "caution", note: "Much denser per volume — use half the amount or measure by weight." },
        { id: "flaky_salt", tier: "creative", note: "Use as a finisher, not for cooking — too expensive and the texture's wasted." },
      ],
      pairs: ["black_pepper", "garlic", "lemon", "butter", "olive_oil"],
      flavor: {
        primary: ["salt"],
        intensity: "mild",
        heatChange: {
          raw: "clean salt, no aftertaste",
          cooked: "dissolves into the dish, becomes invisible — its job is to amplify, not to be tasted",
          charred: "doesn't change — salt doesn't burn",
        },
      },
      nutrition: { per: "1 tsp", kcal: 0, sodium_mg: 1120 },
      origin: "Historically produced for the kosher meat-curing process (koshering), not because the salt itself is kosher. Diamond Crystal and Morton are the two dominant brands in the US, with meaningfully different densities.",
      culturalNotes: "Diamond Crystal vs Morton is the great kitchen schism. Diamond is ~40% less dense per teaspoon — recipes that just say 'kosher salt' usually mean Diamond. If you use Morton, scale down by about a third or you'll oversalt every dish.",
      recipes: ["Almost everything savory", "Brines", "Pasta water", "Meat dry rubs"],
      allergens: [],
      diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false, glutenFree: true },
      seasonality: { yearRound: true },
      sourcing: "Diamond Crystal for cooking (hollow flakes, dissolves fast, easy to pinch). Morton for baking where you need consistent weight-per-volume.",
      market: {
        priceTier: "budget",
        availability: "supermarket",
        organicCommon: false,
        qualityMatters: false,
        qualityNote: "It's salt. Brand matters for measurement consistency, not flavor — every kosher salt tastes the same. Pick Diamond Crystal because every recipe is calibrated for it.",
      },
      skillDev: { skills: ["seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
    },
  },
  {
    ingredient_id: "black_pepper",
    info: {
      description: "Dried unripe berries of Piper nigrum, the most traded spice in human history. The piperine compound delivers the heat; volatile oils deliver the aroma. Freshly ground is non-negotiable — pre-ground loses potency within weeks.",
      flavorProfile: "Sharp, warm, piney, slightly floral. Tellicherry peppercorns (left to ripen longer on the vine) are fruitier and more complex.",
      prepTips: "Always grind fresh — a pepper mill is the single biggest upgrade for a new cook. Add early for background warmth, add at the end for aromatic punch. Toast whole peppercorns in a dry pan to bloom the oils before crushing for cacio e pepe.",
      storage: {
        location: "pantry",
        shelfLifeDays: 1095,
        shelfLife: { fridge: null, freezer: 1825, pantry: 1095 },
        tips: "Whole peppercorns last 3+ years. Ground pepper loses potency in 3-6 months. Keep in a mill, not a shaker.",
        spoilageSigns: "No aroma when freshly ground = it's done. Grayish powder instead of a sharp peppery smell.",
        freezable: true,
        freezeNotes: "Whole peppercorns freeze indefinitely. Doubles their shelf life. Bring to room temp before grinding.",
      },
      substitutions: [
        { id: "white_pepper", tier: "direct", note: "Same plant, different processing — hotter, less aromatic, no dark specks in light sauces." },
        { id: "peppercorns", tier: "direct", note: "Whole form of the same thing. Grind fresh for better flavor." },
      ],
      pairs: ["salt", "lemon", "garlic", "steak", "eggs", "pasta", "butter", "parmesan"],
      flavor: {
        primary: ["spicy", "umami"],
        intensity: "moderate",
        heatChange: {
          raw: "sharp, biting, immediate heat that hits the front of the tongue",
          cooked: "background warmth, mellower; piperine survives heat but volatile oils evaporate fast",
          charred: "becomes acrid and harsh — never let pepper hit a dry pan alone",
        },
      },
      nutrition: { per: "1 tsp", kcal: 6, protein_g: 0.2, fat_g: 0.1, carb_g: 1.5, fiber_g: 0.6 },
      origin: "Native to Kerala, India (Malabar Coast). The spice that launched the Age of Exploration — Europeans sailed around Africa and across oceans to bypass the Arab spice monopoly.",
      culturalNotes: "Pepper was literally worth its weight in gold in medieval Europe. Rent, taxes, and dowries were paid in peppercorns. The phrase 'peppercorn rent' (a token payment) survives in English law to this day.",
      recipes: ["Cacio e Pepe", "Steak au Poivre", "Pepper-crusted tuna", "Bistro French onion soup"],
      allergens: [],
      diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false, glutenFree: true },
      seasonality: { yearRound: true },
      sourcing: "Tellicherry peppercorns (graded TGSEB or TGEB) are the largest 10% of the Malabar harvest — sweeter, fruitier, more complex. Worth the ~$2 premium per ounce. Pre-ground is the kitchen equivalent of decaf.",
      market: {
        priceTier: "moderate",
        availability: "supermarket",
        organicCommon: true,
        qualityMatters: true,
        qualityNote: "Generic supermarket peppercorns are fine for everyday seasoning. For finishing dishes where pepper IS the flavor (cacio e pepe, steak au poivre), Tellicherry is a noticeable upgrade.",
      },
      skillDev: { skills: ["seasoning", "knife"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
    },
  },
  {
    ingredient_id: "paprika",
    info: {
      description: "Dried, ground red peppers — the baseline paprika. Ranges from sweet and mild (Hungarian édesnemes) to moderately warm. The workhorse behind goulash, deviled eggs, and anything that needs warm red color without serious heat.",
      flavorProfile: "Sweet, warm, mildly earthy, fruity. Almost no heat — the sweetness of dried pepper is the point.",
      prepTips: "Bloom in hot oil or butter for 15-30 seconds to activate the fat-soluble pigments. Never add to screaming-hot oil — it scorches instantly and turns bitter.",
      storage: {
        location: "pantry",
        shelfLifeDays: 730,
        shelfLife: { fridge: null, freezer: 1460, pantry: 730 },
        tips: "Loses color and potency faster than most spices. Replace every 1-2 years. If it smells like nothing, it IS nothing.",
        spoilageSigns: "Dull brown-red instead of vibrant red, no aroma when you open the jar, clumping from absorbed moisture.",
        freezable: true,
        freezeNotes: "Double bag it — picks up freezer odors through cardboard. Doubles the usable life.",
      },
      substitutions: [
        { id: "smoked_paprika", tier: "direct", note: "Adds smokiness — great for some dishes, overpowering for others." },
        { id: "cayenne", tier: "caution", note: "10-20x hotter. Use a pinch where you would use a teaspoon." },
        { id: "chili_powder", tier: "creative", note: "More complex, more savory — works in chili, tacos, rubs." },
      ],
      pairs: ["garlic", "onion", "chicken", "potato", "eggs", "sour_cream"],
      flavor: {
        primary: ["sweet", "umami"],
        intensity: "mild",
        heatChange: {
          raw: "dusty, powdery, faintly bitter",
          cooked: "sweet, deep red, fruity — bloomed in fat it turns warm and almost caramel",
          charred: "bitter and acrid within seconds — burns faster than any other spice",
        },
      },
      nutrition: { per: "1 tsp", kcal: 6, protein_g: 0.3, fat_g: 0.3, carb_g: 1.2, fiber_g: 0.8 },
      origin: "Central Mexico (the peppers), brought to Spain and Hungary by the 16th century. Hungary made it the national spice — Szeged and Kalocsa are the two great paprika regions.",
      culturalNotes: "Hungary classifies paprika into eight grades from különleges (delicate, bright red) to erős (hot). The Nobel Prize for Vitamin C was awarded for work on Hungarian paprika — it has more C per gram than citrus.",
      recipes: ["Chicken Paprikash", "Hungarian Goulash", "Deviled Eggs", "Patatas Bravas"],
      allergens: ["nightshade"],
      allergenDetail: "Nightshade family (Solanaceae) — relevant for autoimmune elimination diets but not a true food allergy for most people.",
      diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: true, allium: false, glutenFree: true },
      seasonality: { yearRound: true },
      sourcing: "Hungarian (Szeged or Kalocsa) for complexity and depth. Spanish pimentón dulce is fruitier. Avoid generic supermarket paprika if you cook seriously — the quality gap is bigger than you think.",
      market: {
        priceTier: "budget",
        availability: "supermarket",
        organicCommon: false,
        qualityMatters: true,
        qualityNote: "The $3 supermarket jar vs $10 Hungarian Szegedi is a genuine night-and-day upgrade for any dish where paprika is the lead spice (goulash, paprikash). For color-only uses (deviled eggs, sprinkle on hummus), cheap is fine.",
      },
      skillDev: { skills: ["seasoning", "heat"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
    },
  },
  {
    ingredient_id: "cumin",
    info: {
      description: "Dried seeds of Cuminum cyminum, used whole or ground. The warm, earthy backbone of Mexican, Indian, Middle Eastern, and North African cooking. If your chili, curry, or falafel tastes flat, it needs more cumin.",
      flavorProfile: "Warm, earthy, slightly nutty, faintly bitter. Toasting intensifies the nuttiness dramatically.",
      prepTips: "Toast whole seeds in a dry pan for 60 seconds until fragrant before grinding — the flavor difference is night and day. Pairs with coriander so often they're practically one spice (the classic 2:1 cumin:coriander ratio in most Indian and Middle Eastern blends).",
      storage: {
        location: "pantry",
        shelfLifeDays: 1095,
        shelfLife: { fridge: null, freezer: 1825, pantry: 1095 },
        tips: "Whole seeds last 3-4 years. Ground loses punch within 6 months — buy whole and grind as needed if you can.",
        spoilageSigns: "Faded color, no aroma when toasted in a dry pan. If toasting doesn't wake it up, it's gone.",
        freezable: true,
        freezeNotes: "Whole seeds in a sealed jar — adds 2 years. Bring to room temp before grinding to avoid clumping.",
      },
      substitutions: [
        { id: "ground_cumin", tier: "direct", note: "Same spice, pre-ground. Convenience over flavor." },
        { id: "coriander", tier: "creative", note: "Different flavor but fills the same warm-earthy role in a blend. Use 1.5x the cumin amount." },
        { id: "chili_powder", tier: "creative", note: "Already contains cumin (~25-30%) plus other warming spices. Can stand in for cumin in Tex-Mex applications." },
      ],
      pairs: ["coriander", "garlic", "chili_powder", "lime", "beans", "onion", "yogurt", "tomato"],
      flavor: {
        primary: ["umami", "bitter"],
        intensity: "moderate",
        heatChange: {
          raw: "dusty, faintly medicinal — needs heat to come alive",
          cooked: "warm, nutty, deeply earthy — toasted seeds are floral",
          charred: "smoky and bitter; burnt cumin tastes like petrol",
        },
      },
      nutrition: { per: "1 tsp", kcal: 8, protein_g: 0.4, fat_g: 0.5, carb_g: 0.9, fiber_g: 0.2, iron_mg: 1.4 },
      origin: "Eastern Mediterranean — cultivated in Egypt and the Levant for at least 4,000 years. India is now the dominant producer, growing 70% of the world's supply.",
      culturalNotes: "Cumin is the second most consumed spice worldwide after black pepper. In Ayurvedic medicine it's considered a digestive aid — jeera water (cumin tea) is sipped daily across India. The spice that defines the spice route from Asia to the Americas, brought to Mexico by Spanish friars in the 1500s.",
      recipes: ["Chili con Carne", "Falafel", "Tikka Masala", "Hummus", "Mole Rojo", "Cumin Lamb (Xinjiang)"],
      allergens: [],
      diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "low", nightshade: false, allium: false, glutenFree: true },
      seasonality: { yearRound: true },
      sourcing: "Whole seeds from a high-turnover spice shop will outperform a 5-year-old supermarket ground jar by a mile. If you only buy one whole spice to grind fresh, make it cumin.",
      market: {
        priceTier: "budget",
        availability: "supermarket",
        organicCommon: true,
        qualityMatters: true,
        qualityNote: "Indian/Middle Eastern grocers sell cumin for half the supermarket price and it's almost always fresher. The supermarket ground version in the small jar is the worst-case scenario — old, dusty, dim.",
      },
      skillDev: { skills: ["seasoning", "heat"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
    },
  },
  {
    ingredient_id: "garlic_powder",
    info: {
      description: "Dehydrated garlic, ground fine. Delivers garlic flavor without the moisture, texture, or burn of fresh — it dissolves into dry rubs, marinades, and doughs where fresh garlic can't go. Not a substitute for fresh in sautés; a complement to it.",
      flavorProfile: "Mellow, sweet, roasted-garlic character. Less sharp and pungent than fresh — the dehydration tames the allicin bite.",
      prepTips: "Hydrate in a few drops of water before adding to wet dishes — prevents clumping and helps it bloom. For dry rubs and seasoning blends, use straight. Do NOT confuse with garlic salt (which is ~75% salt — measuring it like garlic powder will oversalt every dish).",
      storage: {
        location: "pantry",
        shelfLifeDays: 1095,
        shelfLife: { fridge: null, freezer: 1825, pantry: 1095 },
        tips: "Hygroscopic — absorbs moisture and clumps. A clumped jar is past its prime. Add a few grains of rice to the jar to absorb moisture in humid kitchens.",
        spoilageSigns: "Hard rock-like clumps that won't break up, faded color (should be cream/beige, not gray), no aroma when opened.",
        freezable: true,
        freezeNotes: "Freezing extends shelf life dramatically. Use straight from the freezer — no need to thaw before measuring.",
      },
      substitutions: [
        { id: "garlic", tier: "creative", note: "Fresh garlic — more pungent, adds moisture. ⅛ tsp powder ≈ 1 clove. Won't disperse evenly in dry applications." },
        { id: "garlic_salt", tier: "caution", note: "75% salt by weight. Reduce other salt in the recipe by half if substituting 1:1." },
        { id: "onion_powder", tier: "creative", note: "Different aromatic but fills the same dry-rub role. Often used together anyway." },
      ],
      pairs: ["onion_powder", "paprika", "black_pepper", "cumin", "oregano", "salt", "thyme"],
      flavor: {
        primary: ["umami", "sweet"],
        intensity: "moderate",
        heatChange: {
          raw: "mild, sweet, slightly dusty",
          cooked: "deeply savory, roasted-garlic warmth — blooms in fat",
          charred: "bitter and acrid; burns much faster than fresh garlic because there's no moisture to protect it",
        },
      },
      nutrition: { per: "1 tsp", kcal: 10, protein_g: 0.5, fat_g: 0, carb_g: 2.3, fiber_g: 0.3 },
      origin: "Dehydrated garlic originated in commercial food processing (mid-20th century US). Garlic itself is Central Asian — cultivated for 5,000+ years. China grows ~80% of the world's commercial garlic supply.",
      culturalNotes: "Snobs dismiss garlic powder but professional kitchens use it constantly. It does something fresh garlic literally cannot: distribute evenly in a dry rub, season a burger patty throughout, or flavor bread dough without wet pockets. Different tools for different jobs — chefs who only use fresh garlic are working with one hand tied behind their back.",
      recipes: ["Dry Rubs (BBQ)", "Garlic Bread", "Burger Seasoning", "Ranch Dressing", "Caesar Dressing", "Pretzel Bread"],
      allergens: ["allium"],
      allergenDetail: "Allium family (onions, garlic, leeks, shallots). FODMAP-sensitive folks react strongly to all alliums; garlic powder is just as problematic as fresh.",
      diet: { vegan: true, vegetarian: true, keto: true, halal: true, kosher: "pareve", fodmap: "high", nightshade: false, allium: true, glutenFree: true },
      seasonality: { yearRound: true },
      sourcing: "Avoid the cheapest white-label brands — quality varies wildly. McCormick, Spice Islands, Penzeys, and Burlap & Barrel are reliable. Granulated garlic (slightly coarser than powder) is what most pro kitchens actually stock — same flavor, less clumping.",
      market: {
        priceTier: "budget",
        availability: "supermarket",
        organicCommon: true,
        qualityMatters: true,
        qualityNote: "The $2 generic vs $6 Penzeys gap is real — the cheap stuff often tastes flat and dusty. Worth the upgrade for any spice you use weekly.",
      },
      skillDev: { skills: ["seasoning"], difficulty: "easy", proFromScratch: false, fromScratchRecipeId: null },
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
