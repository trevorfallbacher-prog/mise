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

// The 7 canonical skills. Per spec these are universal — every skill is always
// visible and levelable. Unlock gating lives on individual recipes, not here.
// Each skill has a maxLevel of 5 (novice → master).
export const SKILL_TREE = [
  { id: "knife",     name: "Knife Skills",    emoji: "🔪", maxLevel: 5, color: "#f5c842", unlocks: ["Chop","Julienne","Mince","Dice"] },
  { id: "heat",      name: "Heat Control",    emoji: "🔥", maxLevel: 5, color: "#e07a3a", unlocks: ["Sear","Simmer","Brown Butter","Caramelize"] },
  { id: "egg",       name: "Egg Mastery",     emoji: "🥚", maxLevel: 5, color: "#f0e68c", unlocks: ["Frittata","Hollandaise","Omelette","Soufflé"] },
  { id: "sauce",     name: "Sauce Building",  emoji: "🫕", maxLevel: 5, color: "#7eb8d4", unlocks: ["Pan Sauce","Reduction","Emulsion"] },
  { id: "dough",     name: "Dough",           emoji: "🥖", maxLevel: 5, color: "#c9a96e", unlocks: ["Fresh Pasta","Pizza","Bread"] },
  { id: "seasoning", name: "Seasoning",       emoji: "🧂", maxLevel: 5, color: "#d4a8c7", unlocks: ["Balance","Layering","Finishing"] },
  { id: "timing",    name: "Timing",          emoji: "⏱️", maxLevel: 5, color: "#a8d5a2", unlocks: ["Mise en place","Parallel prep","Pacing"] },
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

// Recipes live in src/data/recipes/ — one file per recipe, registry at
// src/data/recipes/index.js. Import from there.
