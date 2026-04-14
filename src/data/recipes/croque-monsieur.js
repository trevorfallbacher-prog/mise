import { m } from "./schema";

const recipe = {
  slug: "croque-monsieur",
  title: "Croque Monsieur",
  subtitle: "Ham, Gruyère, béchamel, broiled",
  emoji: "🥪",

  cuisine: "french",
  category: "lunch",
  difficulty: 4,
  routes: ["plan", "learn"],
  time: { prep: 15, cook: 10 },
  serves: 2,

  skills: [
    { id: "sauce",  weight: 0.4, xp: 45 },
    { id: "heat",   weight: 0.3, xp: 30 },
    { id: "timing", weight: 0.3, xp: 25 },
  ],
  minSkillLevels: {},

  tools: ["Small saucepan", "Whisk", "Sheet tray", "Baking parchment"],
  ingredients: [
    { amount: "4",      item: "slices thick white bread (pain de mie)" },
    { amount: "4 oz",   item: "ham, thinly sliced" },
    { amount: "1½ cup", item: "Gruyère, grated" },
    { amount: "2 tbsp", item: "butter",                           match: "unsalted butter" },
    { amount: "2 tbsp", item: "flour",                            match: "flour" },
    { amount: "1 cup",  item: "whole milk, warmed" },
    { amount: "¼ tsp",  item: "nutmeg, freshly grated" },
    { amount: "1 tsp",  item: "Dijon mustard" },
    { amount: "to taste", item: "salt & pepper" },
  ],

  prepNotifications: [
    { id: "warm-milk", leadTime: "T-15m", text: "Warm the milk (microwave or pan) before starting the béchamel", defaultOn: true },
  ],

  steps: [
    { id:1, title:"Make the roux", instruction:"Melt butter in a small saucepan on medium. Add flour and whisk constantly for 90 seconds until the raw-flour smell is gone but the mixture hasn't browned.", icon:"🧈", animation:"brown", timer:90, tip:"Blonde roux, not brown. Cook the flour but don't color it." },
    { id:2, title:"Build the béchamel", instruction:"Pour in the warm milk while whisking constantly. Keep whisking until the sauce thickens enough to coat the back of a spoon — about 3 minutes. Whisk in nutmeg, mustard, salt, pepper, and a handful of Gruyère.", icon:"🫕", animation:"stir", timer:m(3), tip:"Warm milk prevents lumps. Cold milk + hot roux = lumpy sauce." },
    { id:3, title:"Preheat the broiler", instruction:"Broiler on HIGH with a rack in the upper third. Line a sheet tray with parchment.", icon:"🔥", animation:null, timer:null, tip:"Get the broiler blazing hot before the sandwich goes under it." },
    { id:4, title:"Assemble the sandwich", instruction:"Spread a thin layer of béchamel on one side of each slice of bread. Top 2 slices with ham and a generous handful of Gruyère. Close the sandwiches, béchamel-side in.", icon:"🥪", animation:null, timer:null, tip:"Don't drown the inside — just a thin schmear. The real béchamel is going on top." },
    { id:5, title:"Top and broil", instruction:"Place sandwiches on the sheet tray. Spoon the remaining béchamel generously over the top of each. Shower with the rest of the Gruyère.", icon:"🔥", animation:"brown", timer:null, tip:"Don't be shy with the cheese on top. That's the whole point." },
    { id:6, title:"Broil until bronzed", instruction:"Slide under the broiler for 3–4 minutes. Watch closely — you want deeply bronzed and bubbling, but not burnt. Pull when it's glossy and speckled dark.", icon:"🔥", animation:"brown", timer:m(4), tip:"Don't walk away from the broiler. One minute too long and dinner is charcoal." },
  ],

  tags: ["café classic", "weekend", "brunch"],
};

export default recipe;
