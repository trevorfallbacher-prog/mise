// Unit conversion for the cook-complete pantry-reconcile flow.
//
// Every ingredient in src/data/ingredients.js declares its own `units[]`
// ladder with a `toBase` factor. Within a single ingredient's ladder,
// conversion between any two units is just:
//
//   baseAmount = amount * fromUnit.toBase
//   outAmount  = baseAmount / toUnit.toBase
//
// That's the whole converter. The tricky "mass vs volume vs count"
// question handles itself — each ingredient picks ONE family and
// declares its ladder entirely in that family. Tortillas are count-only
// (1 ct = 1, 1 pack = 10), butter is mass+volume but all toBase into
// grams (a tbsp entry just uses 14.2g as its factor), milk is volume
// only. So cross-family collisions can't happen within one ladder.
//
// What CAN happen: a unit that isn't in this ingredient's ladder
// (recipe says "2 cloves garlic" but the pantry row is in "head" —
// both ARE in the garlic ladder so we're fine; but if a recipe
// somehow said "2 g tortillas" we'd fail fast, which is right).
//
// Everything here is pure — no DB, no React. Call it from the cook-
// complete flow to resolve "used 2 tbsp butter" → "decrement the
// pantry's 1.5-stick row by 28.4 g → 1.25 sticks remaining".

import { toBase } from "../data/ingredients";
import { effectiveCountWeightG } from "./nutrition";

// Convert { amount, unit } into a target unit within the same ingredient's
// ladder. Returns { ok, value } or { ok: false, reason }.
//
//   convert({ amount: 2, unit: "tbsp" }, "stick", butterIngredient)
//     → { ok: true, value: 0.25 }   // 2 tbsp = 0.25 sticks of butter
//
// Callers that want a soft fallback (display the raw unit when
// conversion fails) should check `ok` before using `value`.
export function convert(qty, toUnit, ingredient) {
  if (!qty || !ingredient) {
    return { ok: false, reason: "missing-args", value: NaN };
  }
  const fromEntry = ingredient.units?.find(u => u.id === qty.unit);
  const toEntry   = ingredient.units?.find(u => u.id === toUnit);
  if (!fromEntry) return { ok: false, reason: "from-unit-unknown", value: NaN };
  if (!toEntry)   return { ok: false, reason: "to-unit-unknown",   value: NaN };
  const base = Number(qty.amount) * fromEntry.toBase;
  if (!Number.isFinite(base)) return { ok: false, reason: "bad-amount", value: NaN };
  return { ok: true, value: base / toEntry.toBase };
}

// Convert { amount, unit } into a target unit, with an automatic
// cross-family bridge when the same-ladder path can't reach it.
//
// Two-stage:
//   1. convert() — same-ladder, exact, fast. Works for any pair of
//      units that both live in the ingredient's units[] array.
//   2. Bridge via effectiveCountWeightG — kicks in when exactly one
//      side is "count" and the other is a mass-family unit NOT on
//      the ladder (or when the ladder's count entry has a placeholder
//      toBase of 1). Uses the pantry row's grams-per-count (explicit
//      or derived from packageAmount/packageUnit/max) to bridge
//      count ↔ grams, then grams ↔ target.
//
// Returns { ok, value, bridged, reason }. `bridged: true` tells the
// caller the conversion used the cross-family path, which is useful
// for display hints ("≈") since bridged values are approximations
// (they depend on a per-row or canonical average weight).
//
// This is the helper to reach for anywhere recipe-unit meets pantry-
// unit and the two might not be in the same ladder family. Covers:
//   - recipe "3 chicken breasts" ↔ pantry "1.5 lb" (same ladder: count
//     has toBase=200g on chicken_breast; 3×200 / 453.6 = 1.32 lb)
//   - recipe "8 tortillas" ↔ pantry "16 oz pack" (bridged: tortillas
//     ladder has no oz, but pantry row carries packageAmount=16 oz
//     + max=8 → effectiveCountWeightG derives 56.7g/tortilla → 8×56.7
//     / 28.35 = 16 oz)
//   - recipe "2 oz chicken" ↔ pantry "8 count chicken breasts" (same
//     ladder, reverse direction, 2oz × 28.35 / 200 = 0.28 breasts —
//     user sees "you used ~1/3 of a breast")
export function convertWithBridge(qty, toUnit, ingredient, row) {
  if (!qty || !ingredient || !toUnit) {
    return { ok: false, reason: "missing-args", value: NaN, bridged: false };
  }
  // Same-ladder first. Most canonicals encode count-to-mass via
  // count.toBase (e.g. chicken_breast count.toBase=200g), so this
  // path handles a surprising number of count↔mass cases already.
  const direct = convert(qty, toUnit, ingredient);
  if (direct.ok) return { ...direct, bridged: false };

  // Bridge: find a grams-per-count number. Three-tier resolver:
  // explicit countWeightG → derived from packageAmount/packageUnit/max
  // → null. Null means we have no way to bridge count ↔ mass on this
  // row; caller falls back to showing the raw unit.
  const gramsPerCount = effectiveCountWeightG(row, ingredient);
  if (!gramsPerCount) return { ok: false, reason: direct.reason || "no-bridge", value: NaN, bridged: false };

  const fromIsCount = qty.unit === "count";
  const toIsCount   = toUnit === "count";
  // Bridge only activates when exactly one side is count and the
  // other is a known non-count unit. count↔count would've been
  // handled by the ladder; mass↔mass also.
  if (fromIsCount === toIsCount) {
    return { ok: false, reason: direct.reason || "no-bridge", value: NaN, bridged: false };
  }

  const fromEntry = fromIsCount ? null : ingredient.units?.find(u => u.id === qty.unit);
  const toEntry   = toIsCount   ? null : ingredient.units?.find(u => u.id === toUnit);
  if (!fromIsCount && !fromEntry) return { ok: false, reason: "from-unit-unknown", value: NaN, bridged: false };
  if (!toIsCount   && !toEntry)   return { ok: false, reason: "to-unit-unknown",   value: NaN, bridged: false };

  const grams = fromIsCount
    ? Number(qty.amount) * gramsPerCount
    : Number(qty.amount) * Number(fromEntry.toBase);
  if (!Number.isFinite(grams)) {
    return { ok: false, reason: "bad-amount", value: NaN, bridged: false };
  }

  const value = toIsCount
    ? grams / gramsPerCount
    : grams / Number(toEntry.toBase);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: "bad-amount", value: NaN, bridged: false };
  }
  return { ok: true, value, bridged: true };
}

// Subtract a "used" quantity from a pantry row, both keyed to the same
// ingredient. Returns the new row amount in the row's own unit, or null
// if the conversion isn't possible (caller should show a warning and
// fall back to the user picking a number manually).
//
//   decrementRow(
//     { amount: 1.5, unit: "stick" },    // the pantry row
//     { amount: 2,   unit: "tbsp"  },    // the amount the recipe used
//     butterIngredient,
//   ) → 1.25   // 1.5 sticks − 2 tbsp = 1.25 sticks
//
// Clamps at zero so we don't end up with negative inventory if the
// user overshoots.
export function decrementRow(row, used, ingredient) {
  if (!row || !used || !ingredient) return null;
  const converted = convert(used, row.unit, ingredient);
  if (!converted.ok) return null;
  const next = Number(row.amount) - converted.value;
  return Math.max(0, Number(next.toFixed(4)));
}

// Consume `used` across an array of pantry rows (an identity stack — N
// sibling instances sharing canonical + state + composition). Rows are
// drawn FIFO in the order supplied by the caller (CookComplete sorts
// earliest expires first so the next-to-spoil instance is always
// cracked before a fresher sibling). Returns one entry per row
// touched:
//
//   [{ row, newAmount, consumedAmount, unit, unsatisfied }]
//
// * newAmount is in row.unit. 0 = delete the row.
// * consumedAmount is also in row.unit — what the caller would tell
//   the user ("2 cans drawn from Apr 20 batch").
// * unsatisfied is the remainder in `used.unit` when the rows ran out
//   before fully satisfying demand. 0 when everything was consumed.
//
// Keeps `decrementRow` as the single-row primitive; this is the
// multi-row orchestrator built on top of `convert`.
export function planInstanceDecrement(rows, used, ingredient) {
  const out = [];
  if (!Array.isArray(rows) || rows.length === 0 || !used || !ingredient) {
    return { entries: out, unsatisfied: Number(used?.amount) || 0 };
  }
  let remainingBase = Number(used.amount) * (ingredient.units?.find(u => u.id === used.unit)?.toBase ?? NaN);
  if (!Number.isFinite(remainingBase)) {
    // Unit isn't in the ingredient's ladder — caller should fall back
    // to a single-row un-convertible entry, same as decrementRow's
    // null return.
    return { entries: out, unsatisfied: Number(used.amount) };
  }
  for (const row of rows) {
    if (remainingBase <= 0) break;
    const rowFactor = ingredient.units?.find(u => u.id === row.unit)?.toBase;
    if (!rowFactor) continue;
    const rowBase = Number(row.amount) * rowFactor;
    if (!Number.isFinite(rowBase) || rowBase <= 0) continue;
    const consumeBase = Math.min(rowBase, remainingBase);
    const consumedInUnit = Number((consumeBase / rowFactor).toFixed(4));
    const newAmount = Math.max(0, Number(((rowBase - consumeBase) / rowFactor).toFixed(4)));
    out.push({
      row,
      newAmount,
      consumedAmount: consumedInUnit,
      unit: row.unit,
    });
    remainingBase -= consumeBase;
  }
  const unsatisfiedBase = Math.max(0, remainingBase);
  const usedFactor = ingredient.units?.find(u => u.id === used.unit)?.toBase ?? 1;
  const unsatisfied = Number((unsatisfiedBase / usedFactor).toFixed(4));
  return { entries: out, unsatisfied };
}

// Human-readable "2 cloves" / "½ cup" / "60 g" string for a qty + ingredient.
// Falls back gracefully if the unit isn't in the ingredient's ladder.
// Used by the confirm-removal summary and the leftover-row display.
export function formatQty(qty, ingredient) {
  if (!qty) return "";
  const entry = ingredient?.units?.find(u => u.id === qty.unit);
  const label = entry?.label || qty.unit || "";
  const amt = Number(qty.amount);
  if (!Number.isFinite(amt)) return `${qty.amount} ${label}`.trim();
  // Render small fractions as nice glyphs for the common kitchen amounts.
  const pretty = prettyFraction(amt);
  return `${pretty} ${label}`.trim();
}

// "0.25" → "¼", "1.5" → "1½", "2" → "2". Falls back to the raw number
// with up to two decimal places when we don't have a glyph.
function prettyFraction(n) {
  const FRACTIONS = {
    0.125: "⅛", 0.25: "¼", 0.333: "⅓", 0.5: "½",
    0.667: "⅔", 0.75: "¾", 0.875: "⅞",
  };
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 1000) / 1000;
  const match = Object.entries(FRACTIONS).find(([k]) => Math.abs(Number(k) - frac) < 0.005);
  if (match) return whole > 0 ? `${whole}${match[1]}` : match[1];
  // Two decimal places max, strip trailing zeros.
  return String(Number(n.toFixed(2)));
}

// Re-export toBase for callers that want to do their own math against
// the canonical base amount (useful for ranking multi-match pantry rows
// by "closest yield to what the recipe needs").
export { toBase };
