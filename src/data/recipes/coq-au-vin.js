import { m } from "./schema";

const recipe = {
  slug: "coq-au-vin",
  title: "Coq au Vin",
  subtitle: "Chicken braised in red wine, bistro classic",
  emoji: "🍷",

  cuisine: "french",
  category: "chicken",
  difficulty: 7,
  routes: ["plan", "learn"],
  time: { prep: 25, cook: 90 },
  serves: 4,

  skills: [
    { id: "heat",   weight: 0.3, xp: 60 },
    { id: "sauce",  weight: 0.4, xp: 80 },
    { id: "timing", weight: 0.3, xp: 50 },
  ],
  minSkillLevels: { heat: 2 },

  tools: ["Large Dutch oven", "Tongs", "Wooden spoon", "Sieve"],
  ingredients: [
    { amount: "3½ lb",  item: "chicken, bone-in, cut into 8 pieces" },
    { amount: "6 oz",   item: "bacon or lardons, diced" },
    { amount: "1",      item: "onion, diced" },
    { amount: "2",      item: "carrots, diced" },
    { amount: "4",      item: "garlic cloves, crushed",           match: "garlic" },
    { amount: "2 tbsp", item: "tomato paste" },
    { amount: "3 tbsp", item: "flour",                            match: "flour" },
    { amount: "3 cups", item: "red wine (Burgundy or Pinot Noir)" },
    { amount: "1½ cup", item: "chicken stock" },
    { amount: "1",      item: "bouquet garni (thyme, parsley, bay)" },
    { amount: "8 oz",   item: "cremini mushrooms, halved" },
    { amount: "12",     item: "pearl onions, peeled" },
    { amount: "2 tbsp", item: "butter",                           match: "unsalted butter" },
    { amount: "to taste", item: "salt & pepper" },
  ],

  prepNotifications: [
    { id: "marinate", leadTime: "T-1d", text: "Marinate the chicken in red wine overnight (optional but classic)", defaultOn: false },
    { id: "temper", leadTime: "T-30m", text: "Pull the chicken from the fridge 30 min before cooking so it browns evenly", defaultOn: true },
  ],

  steps: [
    { id:1, title:"Render the bacon", instruction:"Cold Dutch oven. Add bacon. Cook on medium for 6–8 minutes until crisp and the fat has rendered. Remove bacon with a slotted spoon. Leave the fat.", icon:"🥓", animation:"brown", timer:m(7), tip:"The bacon fat becomes the browning medium for everything else. Don't pour it off." },
    { id:2, title:"Brown the chicken", instruction:"Pat chicken dry. Season hard with salt and pepper. Brown in the bacon fat on medium-high, 4–5 minutes per side, in batches. Don't crowd. Transfer to a plate.", icon:"🔥", animation:"brown", timer:m(10), tip:"Deep brown = deep flavor. If the chicken is pale, the sauce will be flat. Be patient." },
    { id:3, title:"Build the base", instruction:"Drop heat to medium. Sweat onion, carrot, garlic in the rendered fat for 5 minutes. Stir in tomato paste and cook 2 minutes until it darkens. Sprinkle flour over and stir for 1 minute.", icon:"🧅", animation:"stir", timer:m(8), tip:"Cooking the tomato paste and flour prevents a raw-floury sauce later." },
    { id:4, title:"Deglaze and braise", instruction:"Pour in wine, scrape the bottom clean. Add stock, bouquet garni, rendered bacon, and the chicken with any juices. Bring to a bare simmer.", icon:"🍷", animation:"stir", timer:null, tip:"No rapid boil — that'll toughen the meat. You want a lazy, just-trembling simmer." },
    { id:5, title:"Low and slow", instruction:"Cover and cook on low for 45 minutes. Check for tenderness — the thigh meat should pull easily from the bone. Dark meat needs a bit longer than breast.", icon:"🫕", animation:null, timer:m(45), tip:"If using both white and dark meat, pull breasts earlier (30 min) and let thighs go longer." },
    { id:6, title:"Glaze the garnish", instruction:"While the chicken braises, sauté mushrooms and pearl onions in butter in a separate pan until glazed and deeply colored, about 10 minutes.", icon:"🍄", animation:"brown", timer:m(10), tip:"Dry pan, high heat, don't crowd. Mushrooms don't brown if there's any moisture in the pan." },
    { id:7, title:"Finish the sauce", instruction:"Transfer chicken to a platter. Strain the braising liquid (optional) and return to the pot. Reduce over medium-high for 5–10 minutes until thick enough to coat a spoon. Season. Return chicken, add mushrooms and pearl onions.", icon:"🫕", animation:"stir", timer:m(8), tip:"Taste the sauce before serving. You might want a splash more wine to brighten, or butter to round it out." },
    { id:8, title:"Plate", instruction:"Over mashed potatoes, buttered egg noodles, or crusty bread. Spoon extra sauce on top. Scatter parsley if you like.", icon:"✨", animation:"plate", timer:null, tip:"Better the next day. Make on Saturday, eat on Sunday." },
  ],

  tags: ["bistro classic", "weekend project", "red wine"],
};

export default recipe;
