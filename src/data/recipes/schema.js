// Recipe shape used across the app. Every recipe file exports one of these.
//
// {
//   slug:       unique id, used as route param and DB key later
//   title, subtitle, emoji
//   cuisine:    "italian" | "french" | "japanese" | ...
//   category:   "pasta" | "eggs" | "lunch" | "soup" | "chicken" | "sauce" | "stock" | ...
//   difficulty: 1..10 (ladder sort; 1-3 easy, 4-6 medium, 7-10 hard)
//   routes:     ["plan"] | ["learn"] | ["plan","learn"]
//   time:       { prep: minutes, cook: minutes }  (total = prep + cook)
//   serves:     integer
//   skills:     [{ id, weight, xp }]  weight sums to 1, xp = XP earned on that skill per cook
//   minSkillLevels: { knife: 2, heat: 1 }  — skill levels required to unlock in Learn
//   tools:      string[]
//   ingredients:[{ amount, item }]  — amount is a display string ("8 oz", "½ cup")
//   steps:      [{ id, title, instruction, icon, animation?, timer?, tip }]
//               animation: one of "boil","stir","brown","bloom","toss","plate" (or null)
//               timer: seconds (or null)
//   prepNotifications: [{ id, leadTime, text, defaultOn }]
//               leadTime format: "T-2h", "T-30m", "T-1d"
//   tags:       string[]
//
//   // Phase-1 compound-ingredient support. Optional; when absent, the
//   // recipe implicitly produces a meal (finished dish, eaten fresh).
//   produces?:  {
//     kind: "ingredient" | "meal",
//     ingredientId?: "sriracha",           // for kind: "ingredient"
//     yield?: { amount: 12, unit: "fl_oz" },// total yield across all servings
//     shelfLifeDays?: 90,                  // fridge shelf life after make
//     freezerShelfLifeDays?: 180,          // optional — for stocks & sauces
//   }
// }
//
// Helpers below keep timer expressions readable (m(3) = 180s).
export const m = (min) => min * 60;
