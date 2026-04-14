import { m } from "./schema";

const recipe = {
  slug: "cacio-e-pepe",
  title: "Cacio e Pepe",
  subtitle: "Cheese, pepper, and technique",
  emoji: "🧀",

  cuisine: "italian",
  category: "pasta",
  difficulty: 4,
  routes: ["plan", "learn"],
  time: { prep: 5, cook: 15 },
  serves: 2,

  skills: [
    { id: "timing",    weight: 0.4, xp: 45 },
    { id: "heat",      weight: 0.3, xp: 35 },
    { id: "seasoning", weight: 0.3, xp: 30 },
  ],
  minSkillLevels: {},

  tools: ["Large pot", "12\" skillet", "Tongs", "Microplane or fine grater"],
  ingredients: [
    { amount: "8 oz",   item: "tonnarelli or spaghetti", match: "spaghetti" },
    { amount: "1½ cup", item: "Pecorino Romano, finely grated" },
    { amount: "2 tsp",  item: "whole black peppercorns, coarsely cracked" },
    { amount: "to taste", item: "kosher salt" },
    { amount: "1 cup",  item: "pasta water (reserve)" },
  ],

  prepNotifications: [],

  steps: [
    { id:1, title:"Crack the pepper", instruction:"Crush whole peppercorns with the bottom of a pan or a mortar. You want coarse cracked pepper, not fine ground.", icon:"🌶", animation:"bloom", timer:null, tip:"Pre-ground pepper won't bloom. Whole peppercorns only." },
    { id:2, title:"Toast the pepper", instruction:"Heat a dry skillet on medium. Toast the cracked pepper for 30 seconds until fragrant. Off heat.", icon:"🔥", animation:"brown", timer:30, tip:"Toasting wakes up the volatile oils. Your kitchen will smell different." },
    { id:3, title:"Cook pasta al dente", instruction:"Boil and salt water. Cook pasta 2 minutes less than the box. Reserve a full cup of pasta water before draining.", icon:"🍝", animation:"stir", timer:m(8), tip:"You want the pasta starchy and underdone — finish in the pan." },
    { id:4, title:"Build the sauce", instruction:"To the skillet with pepper add ½ cup pasta water — it'll steam. Drop heat to medium-low. Add pasta and toss.", icon:"🌀", animation:"toss", timer:30, tip:"Low heat. The cheese will break if the pan is too hot." },
    { id:5, title:"Emulsify the cheese", instruction:"Off heat, add Pecorino a handful at a time, tossing hard between each addition. Add more pasta water as needed. Keep tossing until the sauce coats the pasta.", icon:"🧀", animation:"toss", timer:90, tip:"The emulsion takes a full minute to come together. Don't panic if it looks grainy at first — keep tossing." },
    { id:6, title:"Plate immediately", instruction:"Twist into bowls. Top with a final pinch of cracked pepper and more Pecorino. Eat now.", icon:"✨", animation:"plate", timer:null, tip:"Cacio e pepe waits for nobody. If you can't serve it in 2 minutes, don't start." },
  ],

  tags: ["3 ingredients", "technique", "Roman"],
};

export default recipe;
