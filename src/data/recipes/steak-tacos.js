import { m } from "./schema";

const recipe = {
  slug: "steak-tacos",
  title: "Steak Tacos al Carbón",
  subtitle: "Hard-seared sirloin, lime, cilantro, onion — that's the whole move",
  emoji: "🌮",

  cuisine: "mexican",
  category: "tacos",
  difficulty: 4,
  routes: ["plan", "learn"],
  time: { prep: 15, cook: 12 },
  serves: 4,

  skills: [
    { id: "heat",      weight: 0.5, xp: 60 },
    { id: "knife",     weight: 0.3, xp: 35 },
    { id: "seasoning", weight: 0.2, xp: 20 },
  ],
  minSkillLevels: { heat: 1 },

  tools: ["12\" cast-iron skillet (or grill)", "Tongs", "Sharp knife", "Cutting board", "Small bowl for marinade", "Foil"],
  ingredients: [
    { amount: "1½ lb",  item: "sirloin (or skirt/flank if you have it)", ingredientId: "sirloin", qty: { amount: 1.5, unit: "lb" } },
    { amount: "3",      item: "garlic cloves, minced",                   ingredientId: "garlic",  qty: { amount: 3, unit: "clove" } },
    { amount: "3",      item: "limes (2 for marinade, 1 for serving)",    ingredientId: "lime",    qty: { amount: 3, unit: "count" } },
    { amount: "¼ cup",  item: "olive oil",                                ingredientId: "olive_oil", qty: { amount: 0.25, unit: "cup" } },
    { amount: "1",      item: "small yellow onion, finely diced",         ingredientId: "yellow_onion", qty: { amount: 1, unit: "count" } },
    { amount: "½ cup",  item: "cilantro, finely chopped",                 ingredientId: "cilantro", qty: { amount: 0.5, unit: "cup" } },
    { amount: "12",     item: "small corn tortillas (double-stack)",      ingredientId: "tortillas", qty: { amount: 12, unit: "count" } },
    { amount: "1",      item: "avocado, sliced (optional)",               ingredientId: "avocado",  qty: { amount: 1, unit: "count" } },
    // Spice rub — display-only, no ingredientId.
    { amount: "1 tbsp", item: "ground cumin" },
    { amount: "2 tsp",  item: "kosher salt" },
    { amount: "1 tsp",  item: "freshly ground black pepper" },
    { amount: "1 tsp",  item: "smoked paprika" },
    { amount: "to taste", item: "your favorite hot sauce or salsa" },
  ],

  prepNotifications: [
    { id: "marinate", leadTime: "T-1h", text: "Get the steak in the marinade now — even 30 minutes wakes it up.", defaultOn: true },
    { id: "rest-fridge", leadTime: "T-30m", text: "Pull the steak out so it's at room temp by the time the pan is screaming hot.", defaultOn: false },
  ],

  steps: [
    { id:1, title:"Marinate the steak", instruction:"Whisk the olive oil, juice of 2 limes, garlic, cumin, paprika, salt, and pepper in a small bowl. Pat the steak dry, then coat both sides. Let it sit at room temp for at least 30 minutes (up to 2 hours).", icon:"🥩", animation:"stir", timer:null, tip:"Acid + salt at room temp tenderizes from the outside in. Cold steak hitting a hot pan steams instead of sears." },
    { id:2, title:"Prep the toppings", instruction:"Finely dice the onion. Chop the cilantro. Halve the remaining lime into wedges. Slice the avocado if using. Set everything in small bowls — this is taco assembly station.", icon:"🌿", animation:"stir", timer:null, tip:"Mexican taquerías do raw onion + cilantro only on the taco itself. Keep it simple, let the steak shine." },
    { id:3, title:"Get the pan ripping hot", instruction:"Cast-iron over HIGH heat, dry, for 4 minutes. It should be smoking lightly. Open a window or turn on the fan.", icon:"🔥", animation:"brown", timer:m(4), tip:"You want a screaming-hot pan for the Maillard crust. If it doesn't smoke a little, you're going to steam, not sear." },
    { id:4, title:"Sear the steak", instruction:"Pat the steak dry one more time. Lay it in the dry pan — it should hiss violently. DON'T MOVE IT for 3 minutes. Flip once. Cook another 2–3 minutes for medium-rare (130°F internal).", icon:"🥩", animation:"brown", timer:m(6), tip:"One flip. The crust forms when the steak releases on its own — if you tug and it sticks, give it 30 more seconds." },
    { id:5, title:"Rest, then slice", instruction:"Move the steak to a cutting board. Tent loosely with foil and rest for 5 minutes. Then slice ¼-inch thick AGAINST the grain. Look for the lines in the meat — your knife crosses them at 90°.", icon:"🔪", animation:"plate", timer:m(5), tip:"Slicing with the grain gives you chewy, stringy steak. Against the grain shortens the fibers — every bite is tender." },
    { id:6, title:"Char the tortillas", instruction:"Wipe the pan, return to medium-high. Toast each tortilla 15–20 seconds per side until you get dark spots. Stack inside foil to keep warm.", icon:"🌮", animation:"brown", timer:m(3), tip:"Corn tortillas come alive when they're toasted. Cold or microwaved tortillas crack and turn rubbery." },
    { id:7, title:"Build and devour", instruction:"Double-stack two warm tortillas, pile on sliced steak, top with diced onion + cilantro, squeeze lime, hit with hot sauce. Avocado if you want.", icon:"✨", animation:"plate", timer:null, tip:"Two tortillas per taco is the move — the bottom one absorbs juice while the top one stays structural. Eat over a plate." },
  ],

  tags: ["weeknight", "high-heat", "gluten-free", "crowd pleaser"],
};

export default recipe;
