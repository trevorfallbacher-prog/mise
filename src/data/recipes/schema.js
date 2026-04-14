// Recipe shape used across the app. Every recipe file exports one of these.
//
// {
//   slug:       unique id, used as route param and DB key later
//   title, subtitle, emoji
//   cuisine:    "italian" | "french" | "japanese" | ...
//   category:   "pasta" | "eggs" | "lunch" | "soup" | "chicken" | ...
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
// }
//
// Helpers below keep timer expressions readable (m(3) = 180s).
export const m = (min) => min * 60;
