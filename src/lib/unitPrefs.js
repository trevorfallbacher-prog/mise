import { useEffect, useState } from "react";
import { convert, convertWithBridge, convertUniversal, formatQty } from "./unitConvert";
import { findIngredient } from "../data/ingredients";
import { normalizeUnitId, preferredUnitForCanonical } from "./units";

// ─── Preference system ───────────────────────────────────────────
// Two-layer model:
//
//   1. SYSTEM — "us" or "metric". Global toggle in Settings. Drives
//      the DEFAULT display unit for every canonical via that canonical's
//      `preferredUnit[system]` metadata (src/data/ingredients.js).
//
//   2. OVERRIDES — per-ingredient picks the user made from the chip
//      picker or unit-sheet. Stored as { ingredientId: unitId }.
//      An override wins over the canonical's preferredUnit for that
//      ingredient, for that user, across the app.
//
// Both live in localStorage. System is a single string, overrides
// are a small JSON map. Flipping the system DOES NOT wipe overrides
// anymore — the two layers stack. A metric user who picked "cup" for
// flour keeps seeing cup for flour after flipping to metric again.
// (Old behavior wiped everything; change rationale: the user asked
// for a specific unit on a specific ingredient, that's intent, don't
// contradict them just because they flipped the top-level toggle.)

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

const LS_OVERRIDES = "mise.unitPrefs.v1";
const LS_SYSTEM    = "mise.unitPrefs.system.v1";   // "us" | "metric"

function readOverrides() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_OVERRIDES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverrides(map) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_OVERRIDES, JSON.stringify(map));
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

// Read the user's chosen measurement system. First checks explicit
// storage; falls back to navigator.language on first load (en-US →
// "us", anything else → "metric"). Never throws, always returns a
// valid system string.
export function getMeasurementSystem() {
  if (typeof localStorage === "undefined") return "us";
  const stored = localStorage.getItem(LS_SYSTEM);
  if (stored === "us" || stored === "metric") return stored;
  const lang = (typeof navigator !== "undefined" && navigator.language) ? navigator.language : "en-US";
  return /^en-US$/i.test(lang) ? "us" : "metric";
}

// Switch the measurement system. ONLY flips the system flag — does
// NOT wipe user overrides. Broadcasts so every component re-renders.
export function setMeasurementSystem(system) {
  if (system !== "us" && system !== "metric") return;
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(LS_SYSTEM, system); } catch { /* ignore */ }
  broadcast();
}

// Identity key for a recipe ingredient. Canonical id when present
// (the reliable case — "butter", "chicken"), normalized item name
// as a fallback for pre-canonical recipe rows.
export function prefKeyForIngredient(ing) {
  if (!ing) return null;
  if (ing.ingredientId) return ing.ingredientId;
  return normalizeItemKey(ing.item || ing.name);
}

// Return the unit the user should SEE for this ingredient, in THIS
// order: (1) explicit override they set, (2) canonical's own
// preferredUnit[system] hint, (3) null meaning "leave amount as-is."
//
// This is the function the display path calls. It's pure — no state
// bump, no writes. Callers that want "display this amount as X" use
// applyPreferredUnit below; callers that want "what's the current
// display unit for this pref key?" use this.
export function getPreferredUnit(ingredientIdOrKey, ing) {
  if (!ingredientIdOrKey) return null;
  // 1. User override. Wins over canonical metadata — explicit intent.
  const overrides = readOverrides();
  if (overrides[ingredientIdOrKey]) return overrides[ingredientIdOrKey];

  // 2. Canonical-driven default for the current system. Read the
  // canonical's `preferredUnit[system]` metadata and return it.
  const system = getMeasurementSystem();
  const canonical = ing?.ingredientId
    ? findIngredient(ing.ingredientId)
    : findIngredient(ingredientIdOrKey);
  if (canonical) {
    const pref = preferredUnitForCanonical(canonical, system);
    if (pref) return pref;
  }
  return null;
}

// Persist a per-ingredient override. Written synchronously to
// localStorage and broadcast so every mounted component that read
// this key re-renders immediately. Calling with unit === current
// value is a no-op (no extra broadcast, no churn).
export function setPreferredUnit(key, unit) {
  if (!key || !unit) return;
  const normalizedUnit = normalizeUnitId(unit) || unit;
  const map = readOverrides();
  if (map[key] === normalizedUnit) return;
  map[key] = normalizedUnit;
  writeOverrides(map);
  broadcast();
}

// Clear a per-ingredient override so the canonical's preferredUnit
// takes over again. Useful when a "reset" action surfaces in the
// unit picker ("use default for metric").
export function clearPreferredUnit(key) {
  if (!key) return;
  const map = readOverrides();
  if (!(key in map)) return;
  delete map[key];
  writeOverrides(map);
  broadcast();
}

// Convert an amount string to the user's preferred display unit for
// this ingredient. Returns the original string unchanged when:
//   • no canonical metadata AND no override exists,
//   • the amount string can't be parsed,
//   • the preferred unit equals the parsed unit,
//   • the conversion path fails (foreign family, no density bridge).
//
// Defensive by design — a broken conversion should never drop the
// original amount on the floor. Callers see a better string or the
// same string.
export function applyPreferredUnit(amountString, ing) {
  if (!amountString || typeof amountString !== "string") return amountString;
  const key = prefKeyForIngredient(ing);
  const preferred = getPreferredUnit(key, ing);
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

// Lightweight parser — pulls a leading number (integer, decimal, or
// unicode fraction) and the first unit token. Returns { amount, unit }
// or null. Unit normalization happens downstream via normalizeUnitId
// so callers always get raw-lowercase-alnum here.
const UNICODE_FRACTION = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 0.333, "⅔": 0.667,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};
function parseAmountLoose(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim().toLowerCase();
  // Capture: optional whole, optional fraction glyph, unit token
  // (letters, digits, underscore — no spaces; "fl oz" is normalized
  // by normalizeUnitId via the " → _" fallback).
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
