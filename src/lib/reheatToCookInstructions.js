// reheatToCookInstructions — synthesize a ReheatMode-ready walkthrough
// from a recipe's reheat block (src/data/recipes/schema.js shape).
//
// Recipes carry only `reheat.primary` (method + time + temp + tips) —
// no step-by-step array. ReheatMode expects a recipe-shape
// cookInstructions with `steps[]`. This helper bridges the two so the
// I-ATE-THIS cook-screen fires for meal leftovers without waiting on
// an AI round-trip: we synthesize 1–2 tight steps per method using
// the primary block's data.
//
// Returns null when the recipe has no reheat block (raw / eaten-fresh
// dishes), which callers treat as "no walkthrough available".
//
// Per-method step shapes:
//   - oven / air_fryer / toaster_oven → two steps (preheat + heat)
//   - stovetop                        → one step with heat="medium"
//   - microwave                       → one step
//   - cold                            → one "serve cold" step

import { formatReheatSummary } from "../data/recipes/schema";

const METHOD_LABELS = {
  oven:         "oven",
  air_fryer:    "air fryer",
  toaster_oven: "toaster oven",
  stovetop:     "stovetop",
  microwave:    "microwave",
  cold:         "cold serve",
};

export function reheatToCookInstructions(recipe) {
  // Fast path: when the recipe was enriched at save-time with the
  // focused suggest-cook-instructions call, the full step array
  // lives on recipe.reheat.steps. Use it verbatim — those steps
  // carry heat badges, doneCues, per-step timers, and tips that
  // beat anything we could synthesize from reheat.primary alone.
  const storedSteps = Array.isArray(recipe?.reheat?.steps) ? recipe.reheat.steps : [];
  if (storedSteps.length > 0) {
    return {
      title: recipe?.title ? `Reheat ${recipe.title}` : "Reheat",
      emoji: recipe?.emoji || "♨",
      summary: formatReheatSummary(recipe?.reheat) || null,
      reheat: recipe?.reheat,
      steps: storedSteps,
    };
  }

  const p = recipe?.reheat?.primary;
  if (!p || !p.method) return null;

  const seconds = Number.isFinite(Number(p.timeMin))
    ? Math.max(0, Math.round(Number(p.timeMin) * 60))
    : null;
  const coveredClause = p.covered === true  ? "Cover "
                      : p.covered === false ? "Leave uncovered and "
                      : "";
  const steps = [];

  switch (p.method) {
    case "oven":
    case "toaster_oven":
    case "air_fryer": {
      const label = METHOD_LABELS[p.method];
      steps.push({
        id: "preheat",
        title: `Preheat the ${label}`,
        instruction: `Set the ${label} to ${p.tempF}°F and let it come to temperature before the food goes in. Skipping this means the outside dries while the center stays cold.`,
        icon: "♨",
        timer: null,
        tip: null,
        heat: null,
        doneCue: `${p.tempF}°F reached — the ${label}'s ready light turns off or the beeper fires.`,
      });
      steps.push({
        id: "heat",
        title: `Reheat · ${p.timeMin} min`,
        instruction: `${coveredClause}heat at ${p.tempF}°F for ${p.timeMin} minutes${p.tips ? ` — ${p.tips}` : "."}`,
        icon: "🔥",
        timer: seconds,
        tip: null,
        heat: null,
        doneCue: "Edges sizzle and the center feels warm to the back of your hand.",
      });
      break;
    }
    case "stovetop": {
      steps.push({
        id: "heat",
        title: `Warm over medium`,
        instruction: `${coveredClause}heat over medium for ${p.timeMin} minutes, stirring occasionally${p.tips ? ` — ${p.tips}` : "."}`,
        icon: "🔥",
        timer: seconds,
        tip: null,
        heat: "medium",
        doneCue: "Steam rises steadily and the contents loosen.",
      });
      break;
    }
    case "microwave": {
      steps.push({
        id: "heat",
        title: `Microwave · ${p.timeMin} min`,
        instruction: `${coveredClause}microwave on high for ${p.timeMin} minutes${p.tips ? ` — ${p.tips}` : "."}`,
        icon: "📡",
        timer: seconds,
        tip: null,
        heat: null,
        doneCue: "Steam rises from the center when you lift the cover.",
      });
      break;
    }
    case "cold": {
      steps.push({
        id: "serve",
        title: "Serve cold",
        instruction: p.tips || "Plate and eat — no heating needed.",
        icon: "🧊",
        timer: null,
        tip: null,
        heat: null,
        doneCue: null,
      });
      break;
    }
    default:
      return null;
  }

  return {
    title: recipe.title ? `Reheat ${recipe.title}` : "Reheat",
    emoji: recipe.emoji || "♨",
    summary: formatReheatSummary(recipe.reheat) || null,
    reheat: recipe.reheat,
    steps,
  };
}
