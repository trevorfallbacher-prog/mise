import { useEffect, useState } from "react";
import { convert, convertWithBridge, convertUniversal, formatQty } from "./unitConvert";
import { findIngredient } from "../data/ingredients";
import {
  normalizeUnitId,
  getDisplayUnitForIngredient,
  getUserOverride,
  setUserOverride,
  clearUserOverride,
  DISPLAY_CONTEXT,
} from "./units";

// Legacy-shaped facade over src/lib/units/display.js.
//
// Every public export in this file delegates to the central
// display-unit resolver. This file exists because four components
// import `applyPreferredUnit` / `setPreferredUnit` / `prefKeyForIngredient`
// and rewiring them all in one pass is churn; the facade lets those
// callers keep their signatures while the single resolver lives in
// src/lib/units/display.js.
//
// Context-aware: callers that pass a `context` argument get
// context-scoped resolution (cook/pantry/nutrition). Callers that
// don't pass one default to COOK, which matches the historical
// behavior (the only surface users could pick a unit from was the
// recipe / cook-mode ingredient picker).

const CHANGE_EVENT = "mise:unitprefs-changed";
function broadcast() {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch { /* ignore */ }
}

// Subscribe React components to preference changes. Returns a version
// counter that bumps whenever setMeasurementSystem or setPreferredUnit
// fires — pulling this hook into any component that calls
// applyPreferredUnit on render makes it re-compute amounts when the
// user flips the Settings toggle or picks a unit in another screen.
export function useUnitPrefsVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const bump = () => setV(x => x + 1);
    window.addEventListener(CHANGE_EVENT, bump);
    // Also react to localStorage writes from other tabs.
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(CHANGE_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  return v;
}

// Measurement system storage. System lives here (not in display.js)
// because it's independent of any single ingredient — it's a global
// user preference.
const LS_SYSTEM = "mise.unitPrefs.system.v1";

export function getMeasurementSystem() {
  if (typeof localStorage === "undefined") return "us";
  const stored = localStorage.getItem(LS_SYSTEM);
  if (stored === "us" || stored === "metric") return stored;
  const lang = (typeof navigator !== "undefined" && navigator.language) ? navigator.language : "en-US";
  return /^en-US$/i.test(lang) ? "us" : "metric";
}

export function setMeasurementSystem(system) {
  if (system !== "us" && system !== "metric") return;
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(LS_SYSTEM, system); } catch { /* ignore */ }
  broadcast();
}

// Re-export the context constants so components that want to be
// explicit about their context can import from here.
export { DISPLAY_CONTEXT };

// Normalize an item name for pre-canonical rows. Best-effort — a
// user who typed "Publix Bread Flour" and a user who typed "bread
// flour" should collide to the same override key. Brand tokens get
// swallowed aggressively.
function normalizeItemKey(name) {
  if (!name || typeof name !== "string") return null;
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40) || null;
}

// Identity key for a recipe ingredient. Canonical id when present,
// normalized name as fallback.
export function prefKeyForIngredient(ing) {
  if (!ing) return null;
  if (ing.ingredientId) return ing.ingredientId;
  return normalizeItemKey(ing.item || ing.name);
}

// Return the user-facing display unit for this ingredient in the
// given context. Thin wrapper over the central resolver.
export function getPreferredUnit(ingredientIdOrKey, ing, context = DISPLAY_CONTEXT.COOK) {
  if (!ingredientIdOrKey) return null;
  const canonical = ing?.ingredientId
    ? findIngredient(ing.ingredientId)
    : findIngredient(ingredientIdOrKey);
  if (!canonical) {
    // No canonical — user-only override may still apply (keyed by
    // normalized name). No ladder / intent / registry fallback
    // possible.
    return getUserOverride(ingredientIdOrKey, context);
  }
  return getDisplayUnitForIngredient(canonical, getMeasurementSystem(), context);
}

// Persist a per-ingredient, per-context override.
export function setPreferredUnit(key, unit, context = DISPLAY_CONTEXT.COOK) {
  if (!key || !unit) return;
  const normalized = normalizeUnitId(unit) || unit;
  const existing = getUserOverride(key, context);
  if (existing === normalized) return;
  setUserOverride(key, normalized, context);
  broadcast();
}

// Clear a per-ingredient override so the canonical's intent takes
// over again.
export function clearPreferredUnit(key, context = DISPLAY_CONTEXT.COOK) {
  if (!key) return;
  const existing = getUserOverride(key, context);
  if (!existing) return;
  clearUserOverride(key, context);
  broadcast();
}

// Convert an amount string to the user's preferred display unit for
// this ingredient IN THIS CONTEXT. Defaults context to COOK so the
// existing cook-mode and AIRecipe call sites keep their current
// semantics without change.
//
// Returns the original string when:
//   - nothing resolves a preferred unit for this (ingredient, context),
//   - the amount string can't be parsed,
//   - the preferred unit equals the parsed unit,
//   - the conversion path fails.
export function applyPreferredUnit(amountString, ing, context = DISPLAY_CONTEXT.COOK) {
  if (!amountString || typeof amountString !== "string") return amountString;
  const key = prefKeyForIngredient(ing);
  const preferred = getPreferredUnit(key, ing, context);
  if (!preferred) return amountString;

  const parsed = parseAmountLoose(amountString);
  if (!parsed) return amountString;
  const parsedNorm = normalizeUnitId(parsed.unit) || parsed.unit;
  const preferredNorm = normalizeUnitId(preferred) || preferred;
  if (parsedNorm === preferredNorm) return amountString;

  const canonical = ing?.ingredientId ? findIngredient(ing.ingredientId) : null;
  let res;
  if (canonical) {
    res = convert({ amount: parsed.amount, unit: parsedNorm }, preferredNorm, canonical);
    if (!res.ok) res = convertWithBridge({ amount: parsed.amount, unit: parsedNorm }, preferredNorm, canonical);
  } else {
    res = convertUniversal({ amount: parsed.amount, unit: parsedNorm }, preferredNorm);
  }
  if (!res.ok || !Number.isFinite(res.value) || res.value <= 0) return amountString;

  const formattable = canonical || { units: [{ id: preferredNorm, label: preferredNorm }] };
  return formatQty({ amount: res.value, unit: preferredNorm }, formattable);
}

// Leading number + unicode fraction + unit token parser.
const UNICODE_FRACTION = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 0.333, "⅔": 0.667,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};
function parseAmountLoose(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])?\s*([a-z_0-9]+(?:\s+[a-z_0-9]+)?)/);
  if (!m) return null;
  const whole = m[1] ? Number(m[1]) : 0;
  const frac  = m[2] ? UNICODE_FRACTION[m[2]] || 0 : 0;
  const amount = whole + frac;
  if (!(amount > 0)) return null;
  const unit = m[3];
  if (!unit) return null;
  return { amount, unit };
}
