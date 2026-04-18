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
    { amount: "3½ lb",  item: "chicken, bone-in, cut into 8 pieces", ingredientId: "chicken",       qty: { amount: 3.5, unit: "lb"    } },
    { amount: "6 oz",   item: "bacon or lardons, diced",             ingredientId: "bacon",         qty: { amount: 6,   unit: "oz"    } },
    { amount: "1",      item: "onion, diced",                        ingredientId: "yellow_onion",  qty: { amount: 1,   unit: "count" } },
    { amount: "2",      item: "carrots, diced",                      ingredientId: "carrot",        qty: { amount: 2,   unit: "count" } },
    { amount: "4",      item: "garlic cloves, crushed",              ingredientId: "garlic",        qty: { amount: 4,   unit: "clove" } },
    { amount: "2 tbsp", item: "tomato paste",                        ingredientId: "tomato_paste",  qty: { amount: 2,   unit: "tbsp"  } },
    { amount: "3 tbsp", item: "flour",                               ingredientId: "flour",         qty: { amount: 3,   unit: "tbsp"  } },
    { amount: "3 cups", item: "red wine (Burgundy or Pinot Noir)",   ingredientId: "red_wine",      qty: { amount: 3,   unit: "cup"   } },
    { amount: "1½ cup", item: "chicken stock",                       ingredientId: "chicken_stock", qty: { amount: 1.5, unit: "cup"   } },
    { amount: "1",      item: "bouquet garni (thyme, parsley, bay)" },
    { amount: "8 oz",   item: "cremini mushrooms, halved",           ingredientId: "mushroom",      qty: { amount: 8,   unit: "oz"    } },
    { amount: "12",     item: "pearl onions, peeled",                ingredientId: "pearl_onion",   qty: { amount: 12,  unit: "count" } },
    { amount: "2 tbsp", item: "butter",                              ingredientId: "butter",        qty: { amount: 2,   unit: "tbsp"  } },
    { amount: "to taste", item: "salt & pepper" },
  ],

  prepNotifications: [
    { id: "marinate", leadTime: "T-1d", text: "Marinate the chicken in red wine overnight (optional but classic)", defaultOn: false },
    { id: "temper", leadTime: "T-30m", text: "Pull the chicken from the fridge 30 min before cooking so it browns evenly", defaultOn: true },
  ],

  steps: [
    { id:1, title:"Render the bacon", instruction:"Cold Dutch oven. Add bacon. Cook on medium for 6–8 minutes until crisp and the fat has rendered. Remove bacon with a slotted spoon. Leave the fat.", icon:"🥓", animation:"brown", timer:m(7), tip:"The bacon fat becomes the browning medium for everything else. Don't pour it off.",
      uses:[{ amount:"6 oz", item:"bacon or lardons, diced", ingredientId:"bacon", state:"diced" }],
      heat:"medium", doneCue:"bacon crisp, fat pooled in pan — reserve bacon separately" },
    { id:2, title:"Brown the chicken", instruction:"Pat chicken dry. Season hard with salt and pepper. Brown in the bacon fat on medium-high, 4–5 minutes per side, in batches. Don't crowd. Transfer to a plate.", icon:"🔥", animation:"brown", timer:m(10), tip:"Deep brown = deep flavor. If the chicken is pale, the sauce will be flat. Be patient.",
      uses:[
        { amount:"3½ lb", item:"chicken, 8 pieces", ingredientId:"chicken" },
        { amount:"to taste", item:"salt & pepper" },
      ],
      heat:"medium-high", doneCue:"deep brown crust on both sides — not pale" },
    { id:3, title:"Build the base", instruction:"Drop heat to medium. Sweat onion, carrot, garlic in the rendered fat for 5 minutes. Stir in tomato paste and cook 2 minutes until it darkens. Sprinkle flour over and stir for 1 minute.", icon:"🧅", animation:"stir", timer:m(8), tip:"Cooking the tomato paste and flour prevents a raw-floury sauce later.",
      uses:[
        { amount:"1",      item:"onion, diced", ingredientId:"yellow_onion", state:"diced" },
        { amount:"2",      item:"carrots, diced", ingredientId:"carrot", state:"diced" },
        { amount:"4",      item:"garlic cloves, crushed", ingredientId:"garlic", state:"crushed" },
        { amount:"2 tbsp", item:"tomato paste", ingredientId:"tomato_paste" },
        { amount:"3 tbsp", item:"flour", ingredientId:"flour" },
      ],
      heat:"medium", doneCue:"tomato paste brick-red, flour smell gone" },
    { id:4, title:"Deglaze and braise", instruction:"Pour in wine, scrape the bottom clean. Add stock, bouquet garni, rendered bacon, and the chicken with any juices. Bring to a bare simmer.", icon:"🍷", animation:"stir", timer:null, tip:"No rapid boil — that'll toughen the meat. You want a lazy, just-trembling simmer.",
      uses:[
        { amount:"3 cups", item:"red wine (Burgundy/Pinot)", ingredientId:"red_wine" },
        { amount:"1½ cup", item:"chicken stock", ingredientId:"chicken_stock" },
        { amount:"1",      item:"bouquet garni (thyme, parsley, bay)" },
        { amount:"all",    item:"reserved bacon + chicken" },
      ],
      heat:"medium-high", doneCue:"just-trembling surface — not a rolling boil" },
    { id:5, title:"Low and slow", instruction:"Cover and cook on low for 45 minutes. Check for tenderness — the thigh meat should pull easily from the bone. Dark meat needs a bit longer than breast.", icon:"🫕", animation:null, timer:m(45), tip:"If using both white and dark meat, pull breasts earlier (30 min) and let thighs go longer.",
      uses:[],
      heat:"low", doneCue:"thigh meat pulls from the bone without resistance" },
    { id:6, title:"Glaze the garnish", instruction:"While the chicken braises, sauté mushrooms and pearl onions in butter in a separate pan until glazed and deeply colored, about 10 minutes.", icon:"🍄", animation:"brown", timer:m(10), tip:"Dry pan, high heat, don't crowd. Mushrooms don't brown if there's any moisture in the pan.",
      uses:[
        { amount:"2 tbsp", item:"butter", ingredientId:"butter" },
        { amount:"8 oz",   item:"cremini mushrooms, halved", ingredientId:"mushroom", state:"halved" },
        { amount:"12",     item:"pearl onions, peeled", ingredientId:"pearl_onion" },
      ],
      heat:"high", doneCue:"deep mahogany on mushrooms, onions soft and glazed" },
    { id:7, title:"Finish the sauce", instruction:"Transfer chicken to a platter. Strain the braising liquid (optional) and return to the pot. Reduce over medium-high for 5–10 minutes until thick enough to coat a spoon. Season. Return chicken, add mushrooms and pearl onions.", icon:"🫕", animation:"stir", timer:m(8), tip:"Taste the sauce before serving. You might want a splash more wine to brighten, or butter to round it out.",
      uses:[{ amount:"all", item:"mushrooms + pearl onions (from step 6)" }],
      heat:"medium-high", doneCue:"sauce coats the back of a spoon — dragged finger leaves a clean line" },
    { id:8, title:"Plate", instruction:"Over mashed potatoes, buttered egg noodles, or crusty bread. Spoon extra sauce on top. Scatter parsley if you like.", icon:"✨", animation:"plate", timer:null, tip:"Better the next day. Make on Saturday, eat on Sunday.",
      uses:[],
      heat:"off" },
  ],

  tags: ["bistro classic", "weekend project", "red wine"],
};

export default recipe;
