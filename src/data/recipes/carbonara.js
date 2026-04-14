import { m } from "./schema";

const recipe = {
  slug: "carbonara",
  title: "Spaghetti Carbonara",
  subtitle: "Eggs, cheese, cured pork — no cream, ever",
  emoji: "🥓",

  cuisine: "italian",
  category: "pasta",
  difficulty: 5,
  routes: ["plan", "learn"],
  time: { prep: 10, cook: 20 },
  serves: 2,

  skills: [
    { id: "timing", weight: 0.4, xp: 50 },
    { id: "heat",   weight: 0.3, xp: 40 },
    { id: "egg",    weight: 0.3, xp: 40 },
  ],
  minSkillLevels: { timing: 1 },

  tools: ["Large pot", "12\" skillet", "Mixing bowl", "Tongs", "Microplane"],
  ingredients: [
    { amount: "8 oz",   item: "spaghetti or rigatoni",            ingredientId: "spaghetti", qty: { amount: 8, unit: "oz" } },
    { amount: "4 oz",   item: "guanciale, diced (pancetta if you must)", ingredientId: "guanciale", qty: { amount: 4, unit: "oz" } },
    { amount: "3",      item: "egg yolks",                         ingredientId: "eggs",      qty: { amount: 3, unit: "count" } },
    { amount: "1",      item: "whole egg",                         ingredientId: "eggs",      qty: { amount: 1, unit: "count" } },
    { amount: "1 cup",  item: "Pecorino Romano, finely grated",    ingredientId: "pecorino",  qty: { amount: 1, unit: "cup" } },
    { amount: "1 tsp",  item: "coarse black pepper" },
    { amount: "to taste", item: "kosher salt (for pasta water only)" },
  ],

  prepNotifications: [],

  steps: [
    { id:1, title:"Render the guanciale", instruction:"Cold skillet, diced guanciale, medium heat. Render slowly for 6–8 minutes until the fat is pooled and the pork is crisp on the edges but still tender in the middle.", icon:"🥓", animation:"brown", timer:m(7), tip:"Start cold, render slow. A hot pan burns the outside before the fat renders." },
    { id:2, title:"Make the cream", instruction:"In a bowl, whisk yolks + whole egg + Pecorino + pepper until thick and pale. Set aside.", icon:"🥚", animation:"stir", timer:null, tip:"The cheese should be so fine it disappears into the eggs. Microplane it if you can." },
    { id:3, title:"Cook the pasta", instruction:"Boil salted water. Cook pasta 1 minute less than the box. Scoop out a full cup of pasta water before draining.", icon:"🍝", animation:"stir", timer:m(9), tip:"Pasta water is liquid gold here. Do not skip this." },
    { id:4, title:"Combine off heat", instruction:"Kill the heat under the guanciale. Add drained pasta to the skillet and toss in the rendered fat. Let it cool for 30 seconds.", icon:"🌀", animation:"toss", timer:30, tip:"The pan must be off heat when the eggs go in, or you'll scramble them. This is the whole recipe in one move." },
    { id:5, title:"Temper and emulsify", instruction:"Add 2 tbsp pasta water to the egg mixture, whisk. Pour over pasta while tossing constantly. The residual heat cooks the eggs to a silky sauce. Add more pasta water if it's tight.", icon:"🌀", animation:"toss", timer:60, tip:"Glossy and clinging = right. Scrambled = too hot. Runny = too cold, warm gently and keep tossing." },
    { id:6, title:"Plate and finish", instruction:"Into warm bowls. Top with more Pecorino, a crack of pepper, a few bits of guanciale. Eat.", icon:"✨", animation:"plate", timer:null, tip:"Carbonara doesn't hold for even 60 seconds. Table must be set before step 5." },
  ],

  tags: ["classic", "roman", "no cream"],
};

export default recipe;
