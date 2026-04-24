// UNIT REGISTRY — the ONLY place unit conversion factors and family
// assignments live. No other file may declare these.
//
// MASS BASE: grams. VOLUME BASE: millilitres. COUNT is dimensionless.
// All factors are "how many BASE UNITS in one of these" — so
// MASS_FACTORS_G.oz = 28.3495 reads as "1 oz = 28.3495 g".
//
// These are physics, ingredient-independent. Density-aware
// conversions (e.g. 1 cup flour = 120 g) MUST come from the
// canonical ingredient's own declared ladder + density_g_per_ml —
// this registry never assumes water density.

import { normalizeUnitId } from "./aliases";

export const MASS_FACTORS_G = Object.freeze({
  mg: 0.001,
  g:  1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
});

export const VOLUME_FACTORS_ML = Object.freeze({
  ml:          1,
  l:           1000,
  tsp:         4.92892,
  tbsp:        14.7868,
  fl_oz:       29.5735,
  cup:         236.588,
  pint:        473.176,
  quart:       946.353,
  half_gallon: 1892.71,
  gallon:      3785.41,
});

// Family assignment. Mass / volume / count are the ONLY families.
export const UNIT_FAMILY = Object.freeze({
  mg: "mass", g: "mass", kg: "mass", oz: "mass", lb: "mass",
  ml: "volume", l: "volume",
  tsp: "volume", tbsp: "volume", fl_oz: "volume",
  cup: "volume", pint: "volume", quart: "volume",
  half_gallon: "volume", gallon: "volume",
  count: "count",
});

export const MASS_UNITS   = Object.freeze(new Set(Object.keys(MASS_FACTORS_G)));
export const VOLUME_UNITS = Object.freeze(new Set(Object.keys(VOLUME_FACTORS_ML)));

export function unitFamily(id) {
  const n = normalizeUnitId(id);
  return n ? UNIT_FAMILY[n] || null : null;
}

export function isKnownUnit(id) {
  return unitFamily(id) != null;
}

// List of every unit id in the same family as the given one.
// Returns [] for unknown inputs. Used to build picker options
// when an ingredient ladder is partial.
export function universalLadderFor(unitId) {
  const fam = unitFamily(unitId);
  if (fam === "mass")   return Array.from(MASS_UNITS);
  if (fam === "volume") return Array.from(VOLUME_UNITS);
  return [];
}
