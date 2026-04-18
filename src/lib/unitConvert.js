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
