import { m } from "./schema";

// Homemade chicken stock — the real thing, not the boxed shortcut. 4
// hours on a back burner for 2 quarts of deeply savory stock that
// makes risotto, pan sauces, and soups taste like a restaurant made
// them. Saved chicken carcasses in the freezer (3–4 accumulated over
// a month of weeknight cooks) are the ideal base; you can also buy
// backs and wings. Worth every minute.
const recipe = {
  slug: "homemade-chicken-stock",
  title: "Homemade Chicken Stock",
  subtitle: "Carcasses, mirepoix, four hours — the foundation",
  emoji: "🍲",

  cuisine: "french",
  category: "stock",
  difficulty: 3,
  routes: ["plan", "learn"],
  time: { prep: 15, cook: 240 },
  serves: 32, // yields ~2 qt = 64 fl oz, 2 fl oz (¼ cup) per serving use

  produces: {
    kind: "ingredient",
    ingredientId: "chicken_stock",
    yield: { amount: 2, unit: "quart" },
    shelfLifeDays: 5,
    freezerShelfLifeDays: 180,
  },

  skills: [
    { id: "heat",      weight: 0.3, xp: 30 },
    { id: "timing",    weight: 0.3, xp: 25 },
    { id: "sauce",     weight: 0.4, xp: 45 },
  ],
  minSkillLevels: {},

  tools: ["8-qt stockpot", "Fine-mesh strainer", "Cheesecloth (optional, for clearer stock)", "Large heatproof bowl", "Storage containers or quart bags"],
  ingredients: [
    { amount: "2½ lb",     item: "chicken bones — carcasses, backs, wings" },
    { amount: "1 large",   item: "yellow onion, quartered (skin on)",       ingredientId: "yellow_onion", qty: { amount: 1, unit: "count" } },
    { amount: "2",         item: "carrots, scrubbed and halved",             ingredientId: "carrot",       qty: { amount: 2, unit: "count" } },
    { amount: "3 stalks",  item: "celery, halved" },
    { amount: "6 cloves",  item: "garlic, smashed (skin on)",                ingredientId: "garlic",       qty: { amount: 6, unit: "clove" } },
    { amount: "1 small bunch", item: "parsley stems",                        ingredientId: "parsley",      qty: { amount: 0.25, unit: "cup" } },
    { amount: "2",         item: "bay leaves" },
    { amount: "1 tsp",     item: "whole black peppercorns" },
    { amount: "12 cups",   item: "cold water (enough to cover by 2 inches)" },
  ],

  prepNotifications: [],

  steps: [
    { id:1, title:"Optional: roast the bones", instruction:"For a deeper, browner stock: arrange bones on a sheet pan, roast at 400°F for 30 minutes until golden. For a cleaner, more delicate stock (fond blanc): skip this step.", icon:"🔥", animation:"brown", timer:m(30), tip:"Roasting = French fond brun (brown stock). Raw = fond blanc (white stock). Both are correct; different jobs." },
    { id:2, title:"Load the pot", instruction:"Pile the bones (and any roasting-pan drippings) into a large stockpot. Add all the aromatics and vegetables. Cover with cold water by 2 inches.", icon:"🥣", animation:"stir", timer:null, tip:"Cold water start. Hot water locks proteins in the bones before they can release; cold water extracts gradually for deeper flavor." },
    { id:3, title:"Bring up slowly", instruction:"Bring to a gentle simmer over medium heat — 20–25 minutes. As scum and foam rise, skim with a slotted spoon or ladle. Skim thoroughly for the first 15 minutes.", icon:"🌊", animation:"boil", timer:m(20), tip:"NEVER boil. Rolling boil = cloudy, emulsified, greasy stock. Bare simmer = clear, silky stock." },
    { id:4, title:"Simmer low and slow", instruction:"Once clear and skimmed, reduce to the lowest simmer that still bubbles occasionally (185°F if you have a probe). Partially cover. Walk away for 3½ hours.", icon:"⏲️", animation:"boil", timer:m(210), tip:"Don't stir. Stirring clouds it. If the water level drops below the bones, top up with a splash of hot water." },
    { id:5, title:"Strain", instruction:"Set a fine-mesh strainer over a large bowl. Line with cheesecloth if you have it. Ladle the stock through — don't pour, which disturbs the sediment. Discard the solids.", icon:"🫙", animation:"stir", timer:null, tip:"Gentle is the whole game. The clearest stock is the one you didn't rush." },
    { id:6, title:"Cool fast, store", instruction:"Cool in the fridge uncovered for 2 hours, then transfer to airtight containers. Skim the solid fat layer off the top if you want (it's great for roasting potatoes). Fridge 5 days, freezer 6 months in ice-cube trays or quart bags laid flat.", icon:"❄️", animation:"plate", timer:null, tip:"Frozen in 2-tbsp ice cubes, you have perfect pan-sauce portions always ready. Bags-laid-flat stack like books." },
  ],

  tags: ["stock", "foundation", "make-ahead", "french"],
};

export default recipe;
