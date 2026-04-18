import { m } from "./schema";

// Classic Ligurian pesto — basil, pine nuts, parmesan, garlic, olive
// oil, salt. Traditionally mortar-and-pestle (hence the name), but a
// food processor works if you don't bruise the basil with too much heat.
// Keeps 1 week refrigerated under a film of olive oil, or 3 months
// frozen in ice-cube trays.
const recipe = {
  slug: "pesto",
  title: "Pesto alla Genovese",
  subtitle: "Basil, pine nuts, parmesan — the real deal",
  emoji: "🌿",

  cuisine: "italian",
  category: "sauce",
  difficulty: 2,
  routes: ["plan", "learn"],
  time: { prep: 10, cook: 0 },
  serves: 8, // yields ~1 cup, 2 tbsp per serving

  produces: {
    kind: "ingredient",
    ingredientId: "pesto",
    yield: { amount: 1, unit: "cup" },
    shelfLifeDays: 7,
  },

  skills: [
    { id: "knife",     weight: 0.3, xp: 20 },
    { id: "seasoning", weight: 0.4, xp: 30 },
    { id: "sauce",     weight: 0.3, xp: 25 },
  ],
  minSkillLevels: {},

  tools: ["Food processor (or mortar and pestle)", "Microplane", "Jar"],
  ingredients: [
    { amount: "2 cups",     item: "fresh basil leaves, packed",      ingredientId: "basil",     qty: { amount: 2, unit: "cup" } },
    { amount: "⅓ cup",      item: "pine nuts, lightly toasted" },
    { amount: "2 cloves",   item: "garlic",                           ingredientId: "garlic",    qty: { amount: 2, unit: "clove" } },
    { amount: "½ cup",      item: "Parmigiano-Reggiano, finely grated", ingredientId: "parmesan", qty: { amount: 0.5, unit: "cup" } },
    { amount: "2 tbsp",     item: "Pecorino Romano, finely grated",  ingredientId: "pecorino",  qty: { amount: 2, unit: "tbsp" } },
    { amount: "½ cup",      item: "extra-virgin olive oil",          ingredientId: "olive_oil", qty: { amount: 0.5, unit: "cup" } },
    { amount: "¼ tsp",      item: "kosher salt" },
  ],

  prepNotifications: [],

  steps: [
    { id:1, title:"Toast the pine nuts", instruction:"Dry skillet over medium-low. Toss pine nuts until golden and fragrant — 3 minutes. Don't walk away; they go from pale to burnt in 30 seconds.", icon:"🌰", animation:"brown", timer:m(3), tip:"Toasted pine nuts are the entire difference between good and great pesto. Never skip.",
      uses:[{ amount:"⅓ cup", item:"pine nuts" }],
      heat:"medium-low", doneCue:"pale gold, fragrant — NOT dark brown" },
    { id:2, title:"Wash and dry the basil", instruction:"Rinse basil under cold water. Spin dry thoroughly or pat between towels — water in the processor makes pesto gray.", icon:"🌿", animation:"stir", timer:null, tip:"Dry basil pesto stays emerald green; wet basil pesto turns army-drab in hours.",
      uses:[{ amount:"2 cups", item:"fresh basil leaves, packed", ingredientId:"basil" }],
      doneCue:"basil leaves visibly dry, no water droplets" },
    { id:3, title:"Pulse the aromatics", instruction:"Combine garlic, pine nuts, and salt in the processor. Pulse 10–12 times until finely chopped. Don't puree yet.", icon:"🧄", animation:"stir", timer:null, tip:"Pulse, don't run. Too much heat from a spinning motor bruises the basil when you add it next.",
      uses:[
        { amount:"2 cloves", item:"garlic", ingredientId:"garlic" },
        { amount:"toasted", item:"pine nuts (from step 1)" },
        { amount:"¼ tsp",   item:"kosher salt" },
      ],
      doneCue:"finely chopped, not yet a paste" },
    { id:4, title:"Add basil, then oil", instruction:"Add basil. Pulse 6–8 times until chunky. With the processor running, drizzle in the olive oil in a steady stream until it's a textured green paste — 20 seconds.", icon:"🌿", animation:"stir", timer:20, tip:"Stop before it's fully smooth. Pesto should have texture; smoothies are not pesto.",
      uses:[
        { amount:"all",  item:"dried basil (from step 2)" },
        { amount:"½ cup", item:"extra-virgin olive oil", ingredientId:"olive_oil" },
      ],
      doneCue:"textured emerald-green paste — still has flecks, not smooth" },
    { id:5, title:"Fold in the cheese", instruction:"Transfer to a bowl. Fold in both cheeses by hand. Taste. Add more salt or a squeeze of lemon if it needs brightness.", icon:"🧀", animation:"stir", timer:null, tip:"Adding cheese in the processor makes it gummy. Fold by hand for a clean texture.",
      uses:[
        { amount:"½ cup",  item:"Parmigiano-Reggiano, grated", ingredientId:"parmesan", state:"grated" },
        { amount:"2 tbsp", item:"Pecorino Romano, grated", ingredientId:"pecorino", state:"grated" },
      ],
      doneCue:"cheeses fully incorporated — taste is bright and balanced" },
    { id:6, title:"Jar and top with oil", instruction:"Pack into a clean jar. Smooth the top and pour a thin film of olive oil over it before capping. Refrigerate; keeps 1 week.", icon:"🫙", animation:"plate", timer:null, tip:"The oil film is an oxygen barrier — it's what keeps the surface from browning. Re-seal with oil after every use.",
      uses:[{ amount:"thin film", item:"olive oil (top layer)", ingredientId:"olive_oil" }] },
  ],

  tags: ["sauce", "italian", "no-cook", "make-ahead"],
};

export default recipe;
