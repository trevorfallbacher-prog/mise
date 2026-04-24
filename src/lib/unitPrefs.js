import { useEffect, useState } from "react";
import { convert, convertWithBridge, convertUniversal, formatQty } from "./unitConvert";
import { findIngredient } from "../data/ingredients";

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

// Per-user display-unit preferences for recipe ingredients. Backed by
// localStorage; persists across sessions and surfaces anywhere a
// recipe ingredient amount is rendered.
//
// Key model: canonical id first ("butter", "flour"), falling back to
// normalized item name ("buttermilk") for rows that the model didn't
// tag with a canonical. Values are unit ids from either an ingredient's
// units[] ladder or the universal mass/volume set.
//
// The shape is intentionally flat — {butter: "tbsp", flour: "cup", ...}
// — so the whole map lives in a single localStorage string and the
// React hook can subscribe with a single getter. No scaling explosion
// to worry about: even a heavy cook hits maybe 200 unique canonicals
// over a year, and unit strings are tiny.

const LS_KEY    = "mise.unitPrefs.v1";
const LS_SEEDED = "mise.unitPrefs.seeded.v1";
const LS_SYSTEM = "mise.unitPrefs.system.v1";   // "us" | "metric"

// Small curated seed for first-time users. Not comprehensive — we
// cover the ingredients most likely to come back in an awkward unit
// and let the user teach the rest via taps. Everything here is a
// common case where the LLM's default choice reads as robotic vs
// idiomatic for the locale.
const US_SEED = {
  butter:         "tbsp",
  flour:          "cup",
  sugar:          "cup",
  brown_sugar:    "cup",
  powdered_sugar: "cup",
  rice:           "cup",
  oats:           "cup",
  cornmeal:       "cup",
  milk:           "cup",
  heavy_cream:    "cup",
  buttermilk:     "cup",
  yogurt:         "cup",
  olive_oil:      "tbsp",
  vegetable_oil:  "tbsp",
  soy_sauce:      "tbsp",
  honey:          "tbsp",
  maple_syrup:    "tbsp",
};

// Metric seed — used for any non-US-English locale. Grams for
// masses, millilitres for liquids. Baking ingredients especially
// benefit from grams over volume (100g flour is always 100g; a
// "cup" depends on how packed the flour is).
const METRIC_SEED = {
  butter:         "g",
  flour:          "g",
  sugar:          "g",
  brown_sugar:    "g",
  powdered_sugar: "g",
  rice:           "g",
  oats:           "g",
  cornmeal:       "g",
  milk:           "ml",
  heavy_cream:    "ml",
  buttermilk:     "ml",
  yogurt:         "g",
  olive_oil:      "ml",
  vegetable_oil:  "ml",
  soy_sauce:      "ml",
  honey:          "g",
  maple_syrup:    "ml",
};

function readMap() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded or disabled — silent no-op; preference behavior
    // degrades to per-session only, which is still better than crash.
  }
}

// Normalize an item name so "Publix Bread Flour" and "bread flour" and
// "Flour" all collide to the same pref key as a last-resort fallback
// when there's no canonical id. Drops brand tokens aggressively —
// anything title-cased after the first word is treated as decoration.
function normalizeItemKey(name) {
  if (!name || typeof name !== "string") return null;
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40) || null;
}

// Seed the preference map once per install based on navigator.language.
// Subsequent loads skip this entirely. User picks always override the
// seed — they're written straight into the same map.
function seedIfNeeded() {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(LS_SEEDED)) return;
  const lang = (typeof navigator !== "undefined" && navigator.language) ? navigator.language : "en-US";
  const isUS = /^en-US$/i.test(lang);
  const system = isUS ? "us" : "metric";
  const seed = isUS ? US_SEED : METRIC_SEED;
  const current = readMap();
  const merged = { ...seed, ...current };
  writeMap(merged);
  try {
    localStorage.setItem(LS_SEEDED, "1");
    localStorage.setItem(LS_SYSTEM, system);
  } catch { /* ignore */ }
}

// Read the user's chosen measurement system. Falls back to the
// locale-derived default when no explicit choice has been made
// (first-time user on a UI that hasn't surfaced the toggle yet).
export function getMeasurementSystem() {
  if (typeof localStorage === "undefined") return "us";
  const stored = localStorage.getItem(LS_SYSTEM);
  if (stored === "us" || stored === "metric") return stored;
  const lang = (typeof navigator !== "undefined" && navigator.language) ? navigator.language : "en-US";
  return /^en-US$/i.test(lang) ? "us" : "metric";
}

// Switch the measurement system. Rewrites the preference map from the
// chosen system's seed. Existing user picks are dropped when flipping
// systems — the point of the toggle is "make everything metric now",
// so keeping a stale "butter → tbsp" around would contradict the ask.
// Callers can always re-pick per ingredient afterwards.
export function setMeasurementSystem(system) {
  if (system !== "us" && system !== "metric") return;
  if (typeof localStorage === "undefined") return;
  const seed = system === "us" ? US_SEED : METRIC_SEED;
  writeMap({ ...seed });
  try {
    localStorage.setItem(LS_SYSTEM, system);
    localStorage.setItem(LS_SEEDED, "1");
  } catch { /* ignore */ }
  broadcast();
}

export function prefKeyForIngredient(ing) {
  if (!ing) return null;
  if (ing.ingredientId) return ing.ingredientId;
  return normalizeItemKey(ing.item || ing.name);
}

export function getPreferredUnit(key) {
  if (!key) return null;
  seedIfNeeded();
  const map = readMap();
  return map[key] || null;
}

export function setPreferredUnit(key, unit) {
  if (!key || !unit) return;
  const map = readMap();
  if (map[key] === unit) return;
  map[key] = unit;
  writeMap(map);
  broadcast();
}

// Try to render an ingredient's amount string in the user's preferred
// unit. Returns the original amount string unchanged if:
//   • no preference stored for this canonical,
//   • the current amount string can't be parsed,
//   • the conversion fails (foreign unit family, no density, etc.).
//
// Deliberately defensive — a broken conversion should never drop the
// original amount on the floor. Callers only see a better string or
// the same string.
export function applyPreferredUnit(amountString, ing) {
  if (!amountString || typeof amountString !== "string") return amountString;
  const key = prefKeyForIngredient(ing);
  const preferred = getPreferredUnit(key);
  if (!preferred) return amountString;

  const parsed = parseAmountLoose(amountString);
  if (!parsed) return amountString;
  if (parsed.unit === preferred) return amountString;

  const ingredient = ing?.ingredientId ? findIngredient(ing.ingredientId) : null;
  let res;
  if (ingredient) {
    res = convert(parsed, preferred, ingredient);
    if (!res.ok) res = convertWithBridge(parsed, preferred, ingredient);
  } else {
    res = convertUniversal(parsed, preferred);
  }
  if (!res.ok || !Number.isFinite(res.value) || res.value <= 0) return amountString;

  const formattable = ingredient || { units: [{ id: preferred, label: preferred }] };
  return formatQty({ amount: res.value, unit: preferred }, formattable);
}

// Lightweight parser mirrored from UnitPicker — pulls the leading
// number (with optional unicode fraction) and the first unit token.
// Returns { amount, unit } or null.
const UNICODE_FRACTION = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 0.333, "⅔": 0.667,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};
function parseAmountLoose(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])?\s*([a-z_]+)/);
  if (!m) return null;
  const whole = m[1] ? Number(m[1]) : 0;
  const frac  = m[2] ? UNICODE_FRACTION[m[2]] || 0 : 0;
  const amount = whole + frac;
  if (!(amount > 0)) return null;
  const unit = m[3];
  if (!unit) return null;
  // Normalize common plurals/aliases so the pref check against the
  // preferred unit is apples-to-apples regardless of what the model
  // wrote ("cups" → "cup", "tablespoons" → "tbsp").
  const aliases = {
    cups: "cup", tablespoons: "tbsp", tablespoon: "tbsp",
    teaspoons: "tsp", teaspoon: "tsp",
    ounces: "oz", ounce: "oz", pounds: "lb", pound: "lb",
    grams: "g", gram: "g", kilograms: "kg", kilogram: "kg",
    milliliters: "ml", millilitres: "ml",
    liters: "l", litres: "l",
    sticks: "stick",
  };
  return { amount, unit: aliases[unit] || unit };
}
