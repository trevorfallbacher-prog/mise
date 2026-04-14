import { m } from "./schema";

const recipe = {
  slug: "caprese-sandwich",
  title: "Caprese Sandwich",
  subtitle: "Mozzarella, tomato, basil, bread",
  emoji: "🥪",

  cuisine: "italian",
  category: "lunch",
  difficulty: 1,
  routes: ["plan"],                // too simple to be a "learn" lesson
  time: { prep: 8, cook: 0 },
  serves: 1,

  skills: [
    { id: "knife",     weight: 0.5, xp: 20 },
    { id: "seasoning", weight: 0.5, xp: 20 },
  ],
  minSkillLevels: {},

  tools: ["Knife", "Cutting board"],
  ingredients: [
    { amount: "1",      item: "ciabatta roll or thick focaccia square" },
    { amount: "4 oz",   item: "fresh mozzarella (ideally buffalo), sliced", ingredientId: "mozzarella", qty: { amount: 4, unit: "oz" } },
    { amount: "1",      item: "ripe tomato, sliced",                        ingredientId: "tomato",     qty: { amount: 1, unit: "count" } },
    { amount: "6",      item: "basil leaves" },
    { amount: "1 tbsp", item: "good olive oil",                             ingredientId: "olive_oil",  qty: { amount: 1, unit: "tbsp" } },
    { amount: "1 tsp",  item: "balsamic vinegar (optional)" },
    { amount: "to taste", item: "flaky salt & cracked pepper" },
  ],

  prepNotifications: [],

  steps: [
    { id:1, title:"Prep the bread", instruction:"Slice the roll in half. If you have a cast iron or grill pan, warm it dry on medium and toast the cut sides for 1 minute — optional but nice.", icon:"🍞", animation:null, timer:null, tip:"Lightly toasted outside, soft inside. Don't over-toast — you're making a sandwich, not a cracker." },
    { id:2, title:"Slice everything", instruction:"Cut the tomato and mozzarella into similar-thickness slices (¼ inch). Season the tomato slices with a pinch of salt and let them sit for 2 minutes to release water.", icon:"🔪", animation:null, timer:m(2), tip:"Salting tomatoes early is the whole secret. It concentrates the flavor." },
    { id:3, title:"Layer it up", instruction:"Drizzle olive oil on both halves. Layer tomato, mozzarella, basil. A hit of balsamic if you like it.", icon:"🧄", animation:null, timer:null, tip:"Tomato closer to the bread absorbs juice without going soggy. Mozzarella on top." },
    { id:4, title:"Season and close", instruction:"Flaky salt and cracked pepper over the top layer. Close the sandwich. Press gently with your palm. Cut on a diagonal.", icon:"✨", animation:"plate", timer:null, tip:"If you're packing it, wrap tightly in parchment. It'll press itself into perfection in 30 minutes." },
  ],

  tags: ["no-cook", "lunchbox", "summer"],
};

export default recipe;
