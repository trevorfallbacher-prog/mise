import { m } from "./schema";

const recipe = {
  slug: "aglio-e-olio",
  title: "Spaghetti Aglio e Olio",
  subtitle: "Garlic, olive oil, and good timing",
  emoji: "🍝",

  cuisine: "italian",
  category: "pasta",
  difficulty: 2,
  routes: ["plan", "learn"],
  time: { prep: 5, cook: 12 },
  serves: 2,

  skills: [
    { id: "heat",      weight: 0.4, xp: 30 },
    { id: "timing",    weight: 0.3, xp: 25 },
    { id: "seasoning", weight: 0.3, xp: 20 },
  ],
  minSkillLevels: {},

  tools: ["Large pot", "12\" skillet", "Tongs", "Grater"],
  ingredients: [
    { amount: "8 oz",   item: "spaghetti",                       ingredientId: "spaghetti", qty: { amount: 8, unit: "oz" } },
    { amount: "¼ cup",  item: "good olive oil",                  ingredientId: "olive_oil", qty: { amount: 0.25, unit: "cup" } },
    { amount: "6",      item: "garlic cloves, thinly sliced",    ingredientId: "garlic",    qty: { amount: 6, unit: "clove" } },
    { amount: "½ tsp",  item: "red pepper flakes" },
    { amount: "¼ cup",  item: "parsley, chopped",                ingredientId: "parsley",   qty: { amount: 0.25, unit: "cup" } },
    { amount: "½ cup",  item: "Parmesan, grated",                ingredientId: "parmesan",  qty: { amount: 0.5, unit: "cup" } },
    { amount: "to taste", item: "kosher salt" },
  ],

  prepNotifications: [],

  steps: [
    { id:1, title:"Salt the water", instruction:"Fill a large pot with water and add enough salt so it tastes like the sea. Bring to a rolling boil.", icon:"💧", animation:"boil", timer:null, tip:"Well-salted water seasons pasta from the inside — skimp here and nothing else saves it." },
    { id:2, title:"Cook the pasta", instruction:"Drop the spaghetti in. Stir once. Cook one minute less than the box says — you'll finish it in the pan.", icon:"🍝", animation:"stir", timer:m(8), tip:"Before draining, save a full cup of pasta water. You'll need it." },
    { id:3, title:"Bloom the garlic", instruction:"While pasta cooks, warm the olive oil in a skillet on MEDIUM-LOW. Add sliced garlic. Cook slowly for 3–4 minutes until golden and fragrant, never brown.", icon:"🧄", animation:"bloom", timer:m(4), tip:"Low and slow. Brown garlic is bitter garlic." },
    { id:4, title:"Add the heat", instruction:"Stir in the red pepper flakes. Let them sizzle for 20 seconds.", icon:"🌶", animation:"bloom", timer:20, tip:"The flakes bloom fat-soluble, so the oil is what carries the heat to the pasta." },
    { id:5, title:"Toss it together", instruction:"Tongs the pasta straight into the skillet — a little pasta water riding along is fine. Add ¼ cup more pasta water. Toss hard for 90 seconds until the sauce clings.", icon:"🌀", animation:"toss", timer:90, tip:"It should look glossy, not oily. If it's dry, splash more pasta water." },
    { id:6, title:"Finish and plate", instruction:"Off heat, toss in the parsley and half the Parmesan. Plate and shower the rest on top.", icon:"✨", animation:"plate", timer:null, tip:"Eat immediately — this waits for no one." },
  ],

  tags: ["weeknight", "quick", "5 ingredients"],
};

export default recipe;
