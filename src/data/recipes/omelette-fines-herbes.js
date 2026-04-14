import { m } from "./schema";

const recipe = {
  slug: "omelette-fines-herbes",
  title: "Omelette aux Fines Herbes",
  subtitle: "French-rolled, barely set, herb-laced",
  emoji: "🥚",

  cuisine: "french",
  category: "eggs",
  difficulty: 3,
  routes: ["plan", "learn"],
  time: { prep: 5, cook: 4 },
  serves: 1,

  skills: [
    { id: "egg",    weight: 0.6, xp: 50 },
    { id: "heat",   weight: 0.3, xp: 30 },
    { id: "timing", weight: 0.1, xp: 15 },
  ],
  minSkillLevels: {},

  tools: ["8\" non-stick skillet", "Rubber spatula", "Bowl", "Fork"],
  ingredients: [
    { amount: "3",      item: "large eggs",                      match: "eggs" },
    { amount: "1 tbsp", item: "unsalted butter",                 match: "unsalted butter" },
    { amount: "2 tbsp", item: "fines herbes (parsley, chives, tarragon, chervil)" },
    { amount: "to taste", item: "salt & white pepper" },
  ],

  prepNotifications: [],

  steps: [
    { id:1, title:"Beat the eggs", instruction:"Crack eggs into a bowl. Beat HARD with a fork for 30 seconds until completely uniform and frothy. Season with a pinch of salt.", icon:"🥚", animation:"stir", timer:30, tip:"No streaks, no whites. The texture of a French omelette depends entirely on the beating." },
    { id:2, title:"Hot pan, cold butter", instruction:"Heat the pan on medium-high until a drop of water sizzles off. Drop in the butter and swirl. When it foams but hasn't browned, you're ready.", icon:"🔥", animation:"brown", timer:null, tip:"If the butter browns, start over. Brown butter here = brown omelette." },
    { id:3, title:"Pour and scramble", instruction:"Pour in the eggs. IMMEDIATELY start small circular motions with a rubber spatula — flat circles across the pan — while shaking the pan back and forth for 20 seconds. Small curds form.", icon:"🍳", animation:"stir", timer:20, tip:"This is the part people miss. You want small, soft curds before the eggs fully set." },
    { id:4, title:"Smooth the top", instruction:"Stop stirring. Tilt the pan to spread the eggs into an even layer. Let them set for about 15 seconds — the top should still look barely wet.", icon:"🍳", animation:"stir", timer:15, tip:"A proper French omelette is set on the bottom, baveuse (just-runny) on top. Err on the side of underdone." },
    { id:5, title:"Add the herbs", instruction:"Scatter the fines herbes down the center third of the omelette.", icon:"🌿", animation:null, timer:null, tip:"Herbs go on the filling side only — not stirred in. You want bright green contrast inside." },
    { id:6, title:"Roll and plate", instruction:"Tilt the pan away from you. Use the spatula to fold the near third over the herbs. Slide the far edge onto the plate, then invert the pan to roll the omelette into a cigar, seam-side down. Brush the top with a tiny bit of butter for shine.", icon:"✨", animation:"plate", timer:null, tip:"Practice the roll on cold eggs first. The motion takes a few tries." },
  ],

  tags: ["classic", "technique", "quick"],
};

export default recipe;
