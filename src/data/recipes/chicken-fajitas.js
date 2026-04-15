import { m } from "./schema";

const recipe = {
  slug: "chicken-fajitas",
  title: "Chicken Fajitas",
  subtitle: "Hot skillet, charred peppers, lime-bright chicken",
  emoji: "🌯",

  cuisine: "mexican",
  category: "tacos",
  difficulty: 3,
  routes: ["plan", "learn"],
  time: { prep: 15, cook: 15 },
  serves: 4,

  skills: [
    { id: "heat",      weight: 0.4, xp: 40 },
    { id: "knife",     weight: 0.3, xp: 30 },
    { id: "seasoning", weight: 0.3, xp: 30 },
  ],
  minSkillLevels: {},

  tools: ["12\" cast-iron or heavy skillet", "Tongs", "Cutting board", "Mixing bowl", "Foil or tortilla warmer"],
  ingredients: [
    { amount: "1½ lb",  item: "chicken breast or thighs",          ingredientId: "chicken_breast", qty: { amount: 1.5, unit: "lb" } },
    { amount: "3",      item: "bell peppers (mix red, yellow, green), sliced", ingredientId: "bell_pepper", qty: { amount: 3, unit: "count" } },
    { amount: "1",      item: "large yellow onion, sliced",        ingredientId: "yellow_onion", qty: { amount: 1, unit: "count" } },
    { amount: "3",      item: "garlic cloves, minced",             ingredientId: "garlic",       qty: { amount: 3, unit: "clove" } },
    { amount: "2",      item: "limes (one for marinade, one for serving)", ingredientId: "lime", qty: { amount: 2, unit: "count" } },
    { amount: "3 tbsp", item: "olive oil",                          ingredientId: "olive_oil",    qty: { amount: 3, unit: "tbsp" } },
    { amount: "8",      item: "flour or corn tortillas, warmed",    ingredientId: "tortillas",    qty: { amount: 8, unit: "count" } },
    { amount: "½ cup",  item: "cilantro, leaves picked",            ingredientId: "cilantro",     qty: { amount: 0.5, unit: "cup" } },
    { amount: "1",      item: "avocado, sliced (optional)",         ingredientId: "avocado",      qty: { amount: 1, unit: "count" } },
    // Spice rub — not in the canonical registry, displayed-only.
    { amount: "2 tsp",  item: "ground cumin" },
    { amount: "2 tsp",  item: "chili powder" },
    { amount: "1 tsp",  item: "smoked paprika" },
    { amount: "½ tsp",  item: "dried oregano (Mexican if you have it)" },
    { amount: "1½ tsp", item: "kosher salt" },
    { amount: "½ tsp",  item: "freshly ground black pepper" },
  ],

  prepNotifications: [
    { id: "marinate", leadTime: "T-30m", text: "Toss chicken with the spice rub + lime juice now — even 20 minutes makes it sing.", defaultOn: true },
  ],

  steps: [
    { id:1, title:"Slice everything", instruction:"Slice the chicken into ½-inch strips against the grain. Slice the peppers and onion into ¼-inch strips. Mince the garlic. Halve one lime, juice the other.", icon:"🔪", animation:"stir", timer:null, tip:"Even strips = even cooking. Wider chicken on a hot skillet either burns outside or stays raw inside." },
    { id:2, title:"Spice the chicken", instruction:"In a bowl, toss chicken with the cumin, chili powder, paprika, oregano, salt, pepper, juice of 1 lime, and 1 tbsp olive oil. Let it sit while the pan heats — 15 minutes is great, 30 is better.", icon:"🌶", animation:"toss", timer:null, tip:"The acid in the lime tenderizes; the spices form a crust on the hot pan. Don't skip the rest." },
    { id:3, title:"Heat the pan ripping hot", instruction:"Set your cast-iron over HIGH heat with no oil for 3 minutes until it's smoking lightly. This is non-negotiable for char.", icon:"🔥", animation:"brown", timer:m(3), tip:"If you can't hover your hand 2 inches above for more than a second, it's ready. Open a window." },
    { id:4, title:"Char the peppers + onion", instruction:"Add 1 tbsp olive oil, then the peppers and onion. Don't stir for 60 seconds — let them blister. Then toss every 30 seconds for 4 minutes total. They should be charred at the edges, still crisp in the middle. Move to a plate.", icon:"🫑", animation:"toss", timer:m(4), tip:"Crowding steams instead of sears. Work in two batches if your pan is under 12 inches." },
    { id:5, title:"Sear the chicken", instruction:"Same hot pan. Add the last 1 tbsp oil, then the chicken in a single layer. Don't stir for 90 seconds — let one side get deep brown. Then toss and cook 3 more minutes until just cooked through.", icon:"🍗", animation:"brown", timer:m(5), tip:"Chicken should hit 165°F, but if you sliced thin, time is your gauge. Resist the urge to keep flipping." },
    { id:6, title:"Bring it together", instruction:"Add the garlic to the chicken, toss for 30 seconds. Return the peppers and onion. Squeeze the remaining lime over everything. Toss once.", icon:"🌀", animation:"toss", timer:30, tip:"Garlic last so it doesn't burn. Lime at the end keeps it bright instead of cooked-out." },
    { id:7, title:"Warm the tortillas", instruction:"While you brought it together, your tortillas should already be warming — wrap them in foil in a 300°F oven for 5 minutes, or char them one at a time over a gas flame for 10 seconds a side.", icon:"🌮", animation:"plate", timer:null, tip:"Cold tortillas crack and ruin the bite. Stack and wrap them once warm so they steam each other." },
    { id:8, title:"Plate family-style", instruction:"Pile the chicken and peppers on a board or platter. Scatter cilantro and avocado on top. Serve the warm tortillas in a stack alongside.", icon:"✨", animation:"plate", timer:null, tip:"Let everyone build their own. Add hot sauce, sour cream, or shredded cheese on the table." },
  ],

  tags: ["weeknight", "sheet-pan-friendly", "crowd pleaser", "gluten-free with corn tortillas"],
};

export default recipe;
