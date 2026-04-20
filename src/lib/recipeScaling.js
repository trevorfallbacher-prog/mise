// Scale a recipe's ingredient amounts to a target serving count.
//
// Every ingredient row can carry its amount as:
//   - a structured `qty` { amount: number, unit: string }, OR
//   - a free-text `amount` string ("2 tbsp", "1½ cups", "a handful")
//
// We scale both. Structured qty is trivial — multiply `amount` by the
// scale factor. Free-text is best-effort — we peel off the leading
// numeric (integer, decimal, or unicode fraction, possibly mixed like
// "1½"), multiply it, and reattach the rest. Anything we can't parse
// stays as-is with a marker appended, so the user sees "(×2.0)" next
// to "a handful" instead of a silently-wrong number.
//
// Steps are not scaled — "cook for 12 minutes" stays 12 minutes even
// when you're making twice as much. Time / difficulty / pan-size
// heuristics could be added later; for v1 we only touch ingredients.

const UNICODE_FRACTIONS = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 1 / 3, "⅔": 2 / 3,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

// Format a number for ingredient display — drop trailing .00, keep
// two decimals for fractions, convert common ratios back to unicode
// ("0.5" → "½") when it reads more naturally.
function formatAmount(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  // Try nice unicode first.
  const whole = Math.floor(n);
  const frac = n - whole;
  const fracEntries = Object.entries(UNICODE_FRACTIONS);
  for (const [sym, v] of fracEntries) {
    if (Math.abs(frac - v) < 0.01) {
      if (whole === 0) return sym;
      return `${whole}${sym}`;
    }
  }
  // Fall back to decimal, trimmed.
  const str = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return str.replace(/\.?0+$/, "");
}

// Extract a leading numeric from a free-text amount. Returns
// { value, rest } or null if nothing recognizable came off the front.
function parseLeadingNumeric(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.match(/^\s*(\d+(?:\.\d+)?)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])?\s*(.*)$/);
  if (!m) return null;
  const intPart = m[1] ? Number(m[1]) : 0;
  const fracPart = m[2] ? UNICODE_FRACTIONS[m[2]] : 0;
  const value = intPart + fracPart;
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, rest: m[3] || "" };
}

// Scale a single ingredient row. Never mutates — returns a new object.
function scaleIngredient(ing, factor) {
  if (!ing || factor === 1) return ing;
  const out = { ...ing };
  // Structured qty path — trivial multiply.
  if (out.qty && typeof out.qty.amount === "number") {
    out.qty = { ...out.qty, amount: out.qty.amount * factor };
  }
  // Free-text amount path.
  if (typeof out.amount === "string" && out.amount.trim().length > 0) {
    const parsed = parseLeadingNumeric(out.amount);
    if (parsed) {
      const scaled = parsed.value * factor;
      const rest = parsed.rest.trim();
      out.amount = rest
        ? `${formatAmount(scaled)} ${rest}`
        : formatAmount(scaled);
    } else {
      // Can't parse a numeric — annotate honestly so the user knows
      // we didn't touch it. "a handful" + factor 2 → "a handful (×2)".
      const fFmt = formatAmount(factor);
      out.amount = `${out.amount} (×${fFmt})`;
    }
  }
  return out;
}

// Public: return a scaled copy of the recipe. Serves is updated,
// every ingredient's amount is scaled, everything else is preserved.
// No-op (returns the input unchanged) when scaling isn't meaningful.
export function scaleRecipe(recipe, targetServings) {
  if (!recipe) return recipe;
  const base = Number(recipe.serves) || 0;
  const target = Number(targetServings) || 0;
  if (!base || !target || base === target) return recipe;
  const factor = target / base;
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map(ing => scaleIngredient(ing, factor))
    : recipe.ingredients;
  return { ...recipe, ingredients, serves: target };
}

// Pure scale factor — exposed for callers that only need a multiplier
// (e.g. nutrition rollups that have their own macros math).
export function scaleFactorFor(recipe, targetServings) {
  const base = Number(recipe?.serves) || 0;
  const target = Number(targetServings) || 0;
  if (!base || !target) return 1;
  return target / base;
}
