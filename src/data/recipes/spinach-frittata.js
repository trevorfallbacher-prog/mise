import { m } from "./schema";

const recipe = {
  slug: "spinach-frittata",
  title: "Spinach & Parmesan Frittata",
  subtitle: "Custardy eggs, broiled to a kiss",
  emoji: "🍳",

  cuisine: "italian",
  category: "eggs",
  difficulty: 3,
  routes: ["plan", "learn"],
  time: { prep: 10, cook: 15 },
  serves: 4,

  skills: [
    { id: "egg",    weight: 0.5, xp: 50 },
    { id: "heat",   weight: 0.3, xp: 35 },
    { id: "timing", weight: 0.2, xp: 20 },
  ],
  minSkillLevels: {},

  tools: ["10\" oven-safe skillet", "Whisk", "Mixing bowl"],
  ingredients: [
    { amount: "8",      item: "large eggs",                      match: "eggs" },
    { amount: "¼ cup",  item: "whole milk or cream" },
    { amount: "1 cup",  item: "Parmesan, grated",                match: "parmesan" },
    { amount: "3 cups", item: "baby spinach" },
    { amount: "1",      item: "shallot, minced" },
    { amount: "2 tbsp", item: "olive oil",                       match: "olive oil" },
    { amount: "to taste", item: "salt & pepper" },
  ],

  prepNotifications: [],

  steps: [
    { id:1, title:"Preheat the broiler", instruction:"Turn the broiler on HIGH. Position a rack 6 inches below it.", icon:"🔥", animation:null, timer:null, tip:"The broiler finishes the top while the bottom sets on the stove. Both need to be ready at once." },
    { id:2, title:"Whisk the eggs", instruction:"In a bowl, whisk eggs, milk, half the Parmesan, salt, and pepper. Whisk until totally uniform — no streaks.", icon:"🥚", animation:"stir", timer:null, tip:"Overmix for eggs is a myth. Whisk hard for air — they'll rise taller." },
    { id:3, title:"Wilt the greens", instruction:"Heat olive oil in the skillet on medium. Add shallot, cook 2 min until soft. Add spinach and cook until just wilted, about 90 seconds.", icon:"🥬", animation:"stir", timer:m(3), tip:"Press any extra water out of the spinach with a spoon — wet spinach gives you wet eggs." },
    { id:4, title:"Pour and set the bottom", instruction:"Drop heat to medium-low. Pour in the egg mix. Let it set undisturbed for 4–5 minutes — gently lift the edge with a spatula to check. The bottom should be firm, the top still wobbly.", icon:"🍳", animation:"stir", timer:m(5), tip:"Don't stir! This isn't scrambled eggs. The eggs must form a layer." },
    { id:5, title:"Broil the top", instruction:"Shower the rest of the Parmesan on top. Transfer skillet to under the broiler for 2–3 minutes until puffed, golden, and just set in the middle.", icon:"🔥", animation:"brown", timer:m(3), tip:"Pull it 30 seconds before it looks done. Carryover cooking finishes the center." },
    { id:6, title:"Rest and slice", instruction:"Rest 3 minutes. Slide out of the skillet onto a board. Cut into wedges. Serve warm or room temp.", icon:"✨", animation:"plate", timer:null, tip:"Room-temp frittata is a gift. Pack wedges for lunch — it's better the next day." },
  ],

  tags: ["brunch", "make-ahead", "meatless"],
};

export default recipe;
