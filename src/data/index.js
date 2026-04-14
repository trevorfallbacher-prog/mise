export const OCCASIONS = [
  { id: "solo",    label: "Just me",   emoji: "🧘" },
  { id: "partner", label: "Date night",emoji: "🕯️" },
  { id: "family",  label: "Family",    emoji: "🏠" },
  { id: "kids",    label: "Kids",      emoji: "🧒" },
  { id: "friends", label: "Friends",   emoji: "🥂" },
  { id: "parents", label: "Parents",   emoji: "👴" },
  { id: "potluck", label: "Potluck",   emoji: "🍲" },
  { id: "holiday", label: "Holiday",   emoji: "🎉" },
];

export const MOODS = [
  { id: "disaster", emoji: "😬", label: "Rough one" },
  { id: "okay",     emoji: "😊", label: "Pretty good" },
  { id: "nailed",   emoji: "🤩", label: "Nailed it" },
];

export const DIETARY_OPTIONS = [
  { id: "everything", label: "I eat everything", emoji: "🍽️", desc: "No restrictions" },
  { id: "vegetarian", label: "Vegetarian",        emoji: "🥗",  desc: "No meat or fish" },
  { id: "vegan",      label: "Vegan",             emoji: "🌱",  desc: "No animal products" },
  { id: "keto",       label: "Keto",              emoji: "🥩",  desc: "Low carb, high fat" },
  { id: "glutenfree", label: "Gluten-Free",        emoji: "🌾",  desc: "No gluten" },
  { id: "halal",      label: "Halal",             emoji: "☪️",  desc: "Halal certified" },
  { id: "kosher",     label: "Kosher",            emoji: "✡️",  desc: "Kosher only" },
  { id: "dairyfree",  label: "Dairy-Free",         emoji: "🥛",  desc: "No dairy" },
];

export const VEGAN_STYLE_OPTIONS = [
  { id: "alternatives", label: "Meat alternatives are fine", emoji: "🫘", desc: "Tofu, tempeh, tofurkey — I'm in" },
  { id: "whole",        label: "Whole foods only",           emoji: "🥦", desc: "Nothing processed. Real ingredients only" },
  { id: "flexible",     label: "Depends on the dish",        emoji: "🤷", desc: "I mix it up based on the recipe" },
];

export const LEVEL_OPTIONS = [
  { id: "beginner",   label: "Total beginner",      emoji: "🥚", desc: "I can boil water. Barely." },
  { id: "some",       label: "I know some basics",  emoji: "🍳", desc: "Eggs, pasta, a few go-to meals" },
  { id: "comfortable",label: "Pretty comfortable",  emoji: "🔪", desc: "I cook regularly and try new things" },
  { id: "advanced",   label: "I can hang",          emoji: "👨‍🍳",desc: "Techniques, sauces, the works" },
];

export const GOAL_OPTIONS = [
  { id: "weeknight", label: "Quick weeknight meals", emoji: "⚡", desc: "Fast, reliable, not boring" },
  { id: "impress",   label: "Cook to impress",       emoji: "✨", desc: "Dinner parties, dates, wow moments" },
  { id: "healthy",   label: "Eat healthier",         emoji: "💚", desc: "Nourishing, balanced, feel good food" },
  { id: "skill",     label: "Build real skills",     emoji: "🏆", desc: "Master techniques, not just recipes" },
  { id: "explore",   label: "Explore cuisines",      emoji: "🌍", desc: "Travel through food" },
];

export const SKILL_TREE = [
  { id: "knife", name: "Knife Skills",    emoji: "🔪", level: 2, maxLevel: 5, unlocked: true,  color: "#f5c842", unlocks: ["Salads","Stir Fry","Julienne"] },
  { id: "heat",  name: "Heat Control",   emoji: "🔥", level: 1, maxLevel: 5, unlocked: true,  color: "#e07a3a", unlocks: ["Searing","Caramelizing","Brown Butter"] },
  { id: "eggs",  name: "Egg Mastery",    emoji: "🥚", level: 3, maxLevel: 5, unlocked: true,  color: "#f0e68c", unlocks: ["Hollandaise","Frittata","Soufflé"] },
  { id: "pasta", name: "Pasta & Dough",  emoji: "🍝", level: 0, maxLevel: 5, unlocked: false, color: "#c9a96e", unlocks: ["Fresh Pasta","Pizza","Bread"],   requiresLevel: "knife:2" },
  { id: "sauce", name: "Sauces & Stocks",emoji: "🫕", level: 0, maxLevel: 5, unlocked: false, color: "#7eb8d4", unlocks: ["French Cuisine","Braises","Reductions"], requiresLevel: "heat:2" },
  { id: "baking",name: "Baking",         emoji: "🧁", level: 0, maxLevel: 5, unlocked: false, color: "#d4a8c7", unlocks: ["Pastry","Bread","Tarts"],       requiresLevel: "eggs:2" },
];

export const UPCOMING_EVENTS = [
  { name: "Easter",       emoji: "🐣", daysAway: 6,  color: "#c8e6c9" },
  { name: "Cinco de Mayo",emoji: "🌮", daysAway: 21, color: "#ffccbc" },
  { name: "Mother's Day", emoji: "🌷", daysAway: 26, color: "#f8bbd0" },
];

export const UPCOMING_MOMENTS = [
  { id: 1, name: "Mother's Day",     date: "May 11", daysAway: 27, emoji: "🌷", source: "calendar" },
  { id: 2, name: "Dad's Birthday",   date: "May 22", daysAway: 38, emoji: "🎂", source: "calendar" },
  { id: 3, name: "Jake's Graduation",date: "Jun 7",  daysAway: 54, emoji: "🎓", source: "calendar" },
];

export const SAVED_RECIPES = [
  {
    id: 1, title: "Chocolate Chip Cookies", emoji: "🍪",
    skill: "Baking", skillColor: "#d4a8c7", rating: "nailed",
    occasions: ["parents","kids"], notes: "Used brown butter — game changer. Double batch next time.",
    cookedCount: 3, lastCooked: "Dec 2024", savedFor: ["kids"],
    nextSuggestion: { title: "Brown Butter Snickerdoodles", reason: "Same skill, more complexity" },
    tags: ["crowd pleaser","make again","brown butter"], xpEarned: 120,
    moment: "Made these with my parents. Saving for kids events.",
  },
  {
    id: 2, title: "Brown Butter Pasta", emoji: "🍝",
    skill: "Heat Control", skillColor: "#e07a3a", rating: "nailed",
    occasions: ["solo","partner"], notes: "Added white wine when blooming the pepper. Incredible.",
    cookedCount: 5, lastCooked: "Apr 2025", savedFor: ["partner"],
    nextSuggestion: { title: "Cacio e Pepe (Classic)", reason: "Master the original technique" },
    tags: ["weeknight","quick","impressive"], xpEarned: 95,
    moment: "My go-to when I want to impress with minimal effort.",
  },
  {
    id: 3, title: "Lemon Ricotta Pancakes", emoji: "🥞",
    skill: "Egg Mastery", skillColor: "#f0e68c", rating: "okay",
    occasions: ["family","partner"], notes: "Needed more lemon zest. Texture was perfect though.",
    cookedCount: 1, lastCooked: "Mar 2025", savedFor: ["family"],
    nextSuggestion: { title: "Soufflé Pancakes", reason: "Level up the same technique" },
    tags: ["weekend","brunch","needs tweaking"], xpEarned: 60,
    moment: "Sunday brunch. Everyone loved the texture.",
  },
  {
    id: 4, title: "Caramelized Onion Tart", emoji: "🫒",
    skill: "Heat Control", skillColor: "#e07a3a", rating: "nailed",
    occasions: ["friends","potluck"], notes: "3 hours for the onions but absolutely worth it.",
    cookedCount: 2, lastCooked: "Feb 2025", savedFor: ["friends","holiday"],
    nextSuggestion: { title: "French Onion Soup", reason: "Same caramelizing technique, deeper flavor" },
    tags: ["showstopper","patient cook","holiday worthy"], xpEarned: 150,
    moment: "Brought to a dinner party. People asked for the recipe.",
  },
];

export const INITIAL_PANTRY = [
  { id: 1,  name: "Unsalted Butter", emoji: "🧈", amount: 1.5, unit: "sticks", max: 4,  category: "dairy",   lowThreshold: 1    },
  { id: 2,  name: "Heavy Cream",     emoji: "🥛", amount: 0.25,unit: "pint",   max: 2,  category: "dairy",   lowThreshold: 0.5  },
  { id: 3,  name: "Eggs",            emoji: "🥚", amount: 7,   unit: "eggs",   max: 12, category: "dairy",   lowThreshold: 3    },
  { id: 4,  name: "Parmesan",        emoji: "🧀", amount: 0.5, unit: "cup",    max: 2,  category: "dairy",   lowThreshold: 0.25 },
  { id: 5,  name: "Spaghetti",       emoji: "🍝", amount: 12,  unit: "oz",     max: 16, category: "dry",     lowThreshold: 4    },
  { id: 6,  name: "Garlic",          emoji: "🧄", amount: 3,   unit: "cloves", max: 10, category: "produce", lowThreshold: 2    },
  { id: 7,  name: "Olive Oil",       emoji: "🫒", amount: 0.4, unit: "bottle", max: 1,  category: "pantry",  lowThreshold: 0.2  },
  { id: 8,  name: "Flour",           emoji: "🌾", amount: 2.5, unit: "cups",   max: 5,  category: "dry",     lowThreshold: 1    },
  { id: 9,  name: "Brown Sugar",     emoji: "🍯", amount: 0.8, unit: "cups",   max: 2,  category: "dry",     lowThreshold: 0.25 },
  { id: 10, name: "Lemons",          emoji: "🍋", amount: 1,   unit: "lemons", max: 4,  category: "produce", lowThreshold: 1    },
];

export const RECIPE = {
  title: "Brown Butter Pasta",
  subtitle: "Cacio e Pepe adjacent",
  time: "22 min", difficulty: "Easy", serves: 2,
  tools: ["Large pot","12\" skillet","Tongs","Grater","Measuring cups"],
  ingredients: [
    { amount: "8 oz",   item: "spaghetti or bucatini",     match: "spaghetti",        emoji: "🍝" },
    { amount: "4 tbsp", item: "unsalted butter",           match: "unsalted butter",  emoji: "🧈" },
    { amount: "1 cup",  item: "Parmesan, finely grated",   match: "parmesan",         emoji: "🧀" },
    { amount: "1 tsp",  item: "cracked black pepper",      match: "black pepper",     emoji: "🌶" },
    { amount: "1 tsp",  item: "kosher salt",               match: "salt",             emoji: "🧂" },
    { amount: "½ cup",  item: "pasta water (reserve)",     match: null,               emoji: "💧" }, // reserved from cooking, not a pantry item
  ],
  steps: [
    { id:1, title:"Boil the water",   instruction:"Fill your pot with water. Salt it until it tastes like the sea. Bring to a rolling boil.", icon:"💧", animation:"boil", timer:null,    tip:"Well-salted water = seasoned pasta from the inside out." },
    { id:2, title:"Cook the pasta",   instruction:"Drop pasta in. Stir immediately. Cook 2 minutes LESS than the box says — you'll finish it in the pan.", icon:"🍝", animation:"stir", timer:7*60, tip:"Before draining, scoop out ½ cup of starchy pasta water. This is liquid gold." },
    { id:3, title:"Brown the butter", instruction:"Melt butter in your skillet over medium heat. Keep stirring. It'll foam, then go golden, then smell nutty. Pull off heat the moment it turns amber.", icon:"🧈", animation:"brown", timer:4*60, tip:"The difference between brown butter and burnt butter is about 30 seconds. Watch it." },
    { id:4, title:"Crack the pepper", instruction:"Add pepper directly into the brown butter. Let it sizzle for 30 seconds to bloom the spice.", icon:"🌶", animation:"bloom", timer:30, tip:"Fresh cracked pepper only. Pre-ground won't cut it here." },
    { id:5, title:"Build the sauce",  instruction:"Add drained pasta to the skillet. Splash in ¼ cup pasta water. Toss everything together. Add Parmesan in stages, tossing constantly.", icon:"🌀", animation:"toss", timer:null, tip:"If it looks dry, add more pasta water. If too loose, keep tossing — it'll tighten." },
    { id:6, title:"Plate and finish", instruction:"Twist pasta into a bowl using your tongs. Shower with more Parmesan. Add a final crack of pepper. Eat immediately.", icon:"✨", animation:"plate", timer:null, tip:"This doesn't hold. It's best the second it hits the bowl." },
  ],
};
