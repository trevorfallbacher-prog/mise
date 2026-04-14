import { m } from "./schema";

const recipe = {
  slug: "soupe-a-loignon",
  title: "Soupe à l'Oignon",
  subtitle: "The long caramelization, crouton, molten Gruyère",
  emoji: "🧅",

  cuisine: "french",
  category: "soup",
  difficulty: 5,
  routes: ["plan", "learn"],
  time: { prep: 15, cook: 75 },
  serves: 4,

  skills: [
    { id: "heat",      weight: 0.5, xp: 60 },
    { id: "timing",    weight: 0.3, xp: 40 },
    { id: "seasoning", weight: 0.2, xp: 25 },
  ],
  minSkillLevels: { heat: 1 },

  tools: ["Dutch oven or heavy pot", "Wooden spoon", "Oven-safe soup bowls", "Baking tray"],
  ingredients: [
    { amount: "6",      item: "large yellow onions, thinly sliced", ingredientId: "yellow_onion", qty: { amount: 6,   unit: "count" } },
    { amount: "4 tbsp", item: "unsalted butter",                    ingredientId: "butter",       qty: { amount: 4,   unit: "tbsp"  } },
    { amount: "1 tbsp", item: "olive oil",                          ingredientId: "olive_oil",    qty: { amount: 1,   unit: "tbsp"  } },
    { amount: "½ cup",  item: "dry white wine or sherry",           ingredientId: "white_wine",   qty: { amount: 0.5, unit: "cup"   } },
    { amount: "8 cups", item: "beef stock (good quality)",          ingredientId: "beef_stock",   qty: { amount: 8,   unit: "cup"   } },
    { amount: "2",      item: "thyme sprigs" },
    { amount: "1",      item: "bay leaf" },
    { amount: "1 tsp",  item: "sugar",                              ingredientId: "sugar",        qty: { amount: 1,   unit: "tsp"   } },
    { amount: "4",      item: "thick baguette slices, toasted",     ingredientId: "baguette",     qty: { amount: 4,   unit: "slice" } },
    { amount: "2 cups", item: "Gruyère, grated",                    ingredientId: "gruyere",      qty: { amount: 2,   unit: "cup"   } },
    { amount: "to taste", item: "salt & pepper" },
  ],

  prepNotifications: [
    { id: "onion-prep", leadTime: "T-1h15m", text: "Start the onions now — they need 40+ minutes to caramelize", defaultOn: true },
  ],

  steps: [
    { id:1, title:"Start the onions", instruction:"Melt butter + oil in the pot over medium-low. Add all the sliced onions with a pinch of salt. Toss to coat.", icon:"🧅", animation:"stir", timer:null, tip:"The pot will look overflowing. Don't worry — they'll cook down to a third." },
    { id:2, title:"Sweat them down", instruction:"Cook on MEDIUM-LOW, stirring every 5 minutes, for about 15 minutes. They'll soften and release water.", icon:"🫕", animation:"stir", timer:m(15), tip:"Resist turning the heat up. High heat burns the edges before the water cooks off." },
    { id:3, title:"Caramelize slowly", instruction:"Add the sugar. Continue cooking on medium-low, stirring every 5 minutes, for another 25–35 minutes. They should go from pale blonde → amber → deep mahogany. The bottom of the pot will fond up — good.", icon:"🔥", animation:"brown", timer:m(30), tip:"This is the whole recipe. Skip this and you have onion soup. Do it properly and you have soupe à l'oignon." },
    { id:4, title:"Deglaze", instruction:"Pour in the wine. Scrape the fond off the bottom with a wooden spoon. Simmer 2 minutes until the alcohol cooks off.", icon:"🍷", animation:"stir", timer:m(2), tip:"The fond IS the flavor. Every scrap should come off the pan." },
    { id:5, title:"Build the broth", instruction:"Add stock, thyme, bay leaf. Bring to a simmer. Cook uncovered for 20 minutes to let the flavors concentrate. Season to taste.", icon:"🫕", animation:"stir", timer:m(20), tip:"Taste often. Good beef stock is forgiving; weak stock you'll need to reduce harder." },
    { id:6, title:"Top and broil", instruction:"Ladle soup into oven-safe bowls. Float a toast on each. Pile Gruyère over the top. Broil 3 minutes until bubbled, browned, and slightly crackling at the edges.", icon:"🔥", animation:"brown", timer:m(3), tip:"If your bowls aren't oven-safe, broil the cheese-topped toasts on a tray and float them on top right before serving." },
  ],

  tags: ["bistro", "cold weather", "make-ahead"],
};

export default recipe;
