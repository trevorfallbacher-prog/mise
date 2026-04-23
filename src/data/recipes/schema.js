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
//   ingredients:[{ amount, item, ingredientId?, qty?, state? }]
//     amount     display string ("8 oz", "½ cup")
//     item       display text ("bread", "grated parmesan")
//     ingredientId  canonical id (optional, enables pantry matching)
//     qty        { amount, unit } for structured decrement (optional)
//     state      required physical form ("crumbs", "grated", "shredded",
//                "diced", "minced", …). Scopes pantry matching — a
//                recipe asking for crumbs won't match a loaf row even
//                for the same id. Omit for state-agnostic recipes.
//   steps:      [{ id, title, instruction, icon, animation?, timer?, tip,
//                  uses?, heat?, doneCue? }]
//               animation: one of "boil","stir","brown","bloom","toss","plate" (or null)
//               timer: seconds (or null)
//               uses:  [{ amount, item, ingredientId?, state? }] — the
//                      measurements the cook needs RIGHT NOW at this step.
//                      CookMode renders a FOR THIS STEP tile above the
//                      instruction with these rows. Optional: when absent,
//                      CookMode falls back to rendering the full top-level
//                      ingredients list so legacy recipes still show
//                      measurements during the cook.
//               heat:  "low" | "medium" | "high" | "medium-low" | "off" —
//                      burner setting. Surfaced as a badge in the step
//                      tile so the cook knows without rereading the prose.
//               doneCue: short qualitative "it's ready when…" signal
//                      ("nutty smell, color of wet sand"; "no longer
//                      sticks to the pan"). The signal every real recipe
//                      book has that AI drafts routinely miss.
//   prepNotifications: [{ id, leadTime, text, defaultOn }]
//               leadTime format: "T-2h", "T-30m", "T-1d"
//               LEGACY shape — kept for back-compat with existing recipes.
//               New recipes should use prepSteps below instead.
//   prepSteps:  [{ id, leadMinutes, title, body, emoji?, defaultOn?, source? }]
//               Structured prep reminders. Each step schedules a push
//               notification at (mealScheduledFor - leadMinutes) via the
//               prep_notifications table (migration 0134).
//                 id           stable key within the recipe — used as
//                              prep_notifications.prep_key and as the
//                              toggle key inside scheduled_meals.
//                              notification_settings.
//                 leadMinutes  integer minutes before the scheduled meal
//                              time. 30 = half-hour prep ("toss the
//                              chicken in spice rub"). 720 = overnight
//                              ("cube butter and freeze"). 1440 = a day
//                              ahead ("take the roast out to thaw").
//                 title        short headline shown as the push title.
//                 body         one-sentence actionable text. Start with
//                              a verb — "Toss…", "Freeze…", "Pull…" —
//                              so the notification reads as an
//                              instruction, not a status update.
//                 emoji        optional. Defaults to 🧊 for leadMinutes
//                              ≥ 360 (cold-chain-sounding) and ⏰ below.
//                 defaultOn    true by default. Set false for optional
//                              reminders that should be off unless the
//                              user explicitly toggles them on.
//                 source       'recipe_prep' | 'freeze_overnight' |
//                              'step_timing'. Classifies the reminder
//                              for analytics + UI accent. Omit to let
//                              resolvePrepSteps pick based on leadMinutes.
//               Every entry becomes one prep_notifications row per
//               scheduled meal. The drain RPC fires them when
//               deliver_at arrives. Quiet-hours in the user's
//               notification_preferences automatically shifts any row
//               that would have landed in their sleep window EARLIER
//               (so freeze-overnight at 2am surfaces as a 9:30pm ping).
//   tags:       string[]
//
//   // Leftover reheat instructions. Optional; absent when the dish
//   // is eaten fresh only (vinaigrettes, aiolis, anything raw) or
//   // when we simply haven't authored it yet. The leftover pantry
//   // row carries sourceRecipeSlug, so the I-ate-this sheet can
//   // look up reheat from the recipe on-demand rather than stamping
//   // it onto the meal row — single source of truth, improvements
//   // to the recipe flow through to existing leftovers automatically.
//   reheat?:    {
//     primary: {
//       method:   "oven" | "microwave" | "stovetop" | "air_fryer" |
//                 "toaster_oven" | "cold",
//       tempF:    number | null,   // null for microwave / cold
//       timeMin:  number,           // single number of minutes
//       covered:  boolean | null,   // null when not applicable
//       tips:     "1-2 sentence specifics",
//     },
//     // 0-2 alternative methods for cooks who don't have the
//     // primary gear (no oven → microwave fallback, etc.)
//     alt?:     Array<{method, tempF, timeMin, covered, tips}>,
//     // Optional quality / safety caveat ("eggs scramble if rushed",
//     // "dairy-based sauces break on microwave — stovetop only").
//     note?:    string | null,
//   }
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

// Compact reheat summary for UI chips and sheet headers.
//   "Oven 350°F · 20 min · covered"
//   "Microwave · 3 min"
//   "Stovetop · 5 min · uncovered"
// Returns null when the recipe has no reheat block, so callers can
// easily guard with ternary or && short-circuit.
export function formatReheatSummary(reheatBlock) {
  const b = reheatBlock?.primary || reheatBlock;
  if (!b?.method) return null;
  const labels = {
    oven: "Oven", microwave: "Microwave", stovetop: "Stovetop",
    air_fryer: "Air fryer", toaster_oven: "Toaster oven", cold: "Cold",
  };
  const bits = [labels[b.method] || b.method];
  if (typeof b.tempF === "number") bits[0] += ` ${b.tempF}°F`;
  if (typeof b.timeMin === "number") bits.push(`${b.timeMin} min`);
  if (b.covered === true)  bits.push("covered");
  if (b.covered === false) bits.push("uncovered");
  return bits.join(" · ");
}
