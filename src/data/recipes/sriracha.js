import { m } from "./schema";

// Homemade sriracha — blended (not fermented) version. Fermented is more
// authentic but takes 5–7 days; this weeknight-friendly version blends
// red chilies with garlic/sugar/vinegar and simmers briefly. Keeps
// 3 months refrigerated, flavor deepens after 48 hours.
const recipe = {
  slug: "sriracha",
  title: "Homemade Sriracha",
  subtitle: "Garlicky red chili sauce — blended, not fermented",
  emoji: "🌶️",

  cuisine: "thai",
  category: "sauce",
  difficulty: 3,
  routes: ["plan", "learn"],
  time: { prep: 15, cook: 15 },
  serves: 12, // yields ~12 fl oz, ~1 tbsp per serving

  // What this recipe produces. Lands in the pantry as an ingredient
  // row (kind: "ingredient"), id: "sriracha", roughly 12 fl oz yield.
  // Shelf-life drives the auto-expiration once it's in the fridge.
  produces: {
    kind: "ingredient",
    ingredientId: "sriracha",
    yield: { amount: 12, unit: "fl_oz" },
    shelfLifeDays: 90,
  },

  skills: [
    { id: "heat",      weight: 0.3, xp: 30 },
    { id: "seasoning", weight: 0.4, xp: 40 },
    { id: "sauce",     weight: 0.3, xp: 30 },
  ],
  minSkillLevels: {},

  tools: ["Blender or food processor", "Saucepan", "Fine-mesh sieve", "Sterilized bottle or jar"],
  ingredients: [
    { amount: "1 lb",       item: "red Fresno or red jalapeño chilies, stems removed" },
    { amount: "6 cloves",   item: "garlic",                  ingredientId: "garlic",     qty: { amount: 6, unit: "clove" } },
    { amount: "3 tbsp",     item: "light brown sugar" },
    { amount: "1 tbsp",     item: "kosher salt" },
    { amount: "⅓ cup",      item: "distilled white vinegar", ingredientId: "vinegar",    qty: { amount: 0.33, unit: "cup" } },
    { amount: "2 tbsp",     item: "water" },
  ],

  prepNotifications: [],

  steps: [
    { id:1, title:"Prep the chilies", instruction:"Split the chilies down the middle and scrape out the seeds if you want a milder sauce; leave them for full heat. Rough-chop.", icon:"🌶️", animation:"stir", timer:null, tip:"Gloves. Trust me. Fresno oils stay on your hands for hours." },
    { id:2, title:"Blend", instruction:"Add chilies, garlic, brown sugar, salt, vinegar, and water to a blender. Blend until fully smooth — 2 minutes on high.", icon:"🌀", animation:"stir", timer:m(2), tip:"The smoother you get it now, the less you strain later. Push on." },
    { id:3, title:"Simmer", instruction:"Transfer to a small saucepan. Bring to a boil, then reduce to a gentle simmer. Cook 8–10 minutes, stirring often, until the raw garlic smell is gone and the color deepens to brick red.", icon:"🍲", animation:"stir", timer:m(9), tip:"Watch for sputter — a splatter screen helps. The vinegar smell is intense; ventilate." },
    { id:4, title:"Strain", instruction:"Press the sauce through a fine-mesh sieve to catch the seeds and chunks. Push hard with a spatula; you want the pulp through, not just the liquid.", icon:"🫙", animation:"stir", timer:null, tip:"If you want the classic textured sriracha, skip straining. Strained = cleaner; unstrained = rustic." },
    { id:5, title:"Bottle and chill", instruction:"Pour into a sterilized bottle or jar. Let cool to room temp, then refrigerate. Flavor deepens dramatically after 48 hours.", icon:"🧊", animation:"plate", timer:null, tip:"Day 1 is punchy, day 3 is balanced, day 7 is glorious. Resist using until 48h if you can." },
  ],

  tags: ["sauce", "make-ahead", "condiment", "spicy"],
};

export default recipe;
