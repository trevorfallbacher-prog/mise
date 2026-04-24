// Central display-unit resolver.
//
// EVERY surface in the app that renders an ingredient amount — cook
// mode, recipe ingredient list, pantry row, kitchen tile, shopping
// suggestion, unit picker, nutrition calculator — calls through
// here. There is exactly one resolver. No caller reads
// canonical.preferredUnit or canonical.measuredIn directly; they
// ask this module and the module answers based on system + context.
//
// This file owns DISPLAY / PRESENTATION only. It does not convert
// amounts, does not touch ladder factors, does not assume density.
// Callers that need a converted NUMBER pair this resolver with
// convertStrict.

import { normalizeUnitId } from "./aliases";
import { MASS_FACTORS_G, VOLUME_FACTORS_ML, UNIT_FAMILY, unitFamily, isKnownUnit } from "./registry";

// ─── Contexts ───────────────────────────────────────────────────
// "Context" is the question the caller is asking. Same ingredient,
// different context, can yield different display units:
//
//   flour in COOK      → "cup"   (how cooks measure in a recipe)
//   flour in PANTRY    → "lb"    (how it's bought and stored)
//   flour in NUTRITION → "g"     (how math is done internally)
//
// Callers pass one of the four string constants below. Unknown
// context strings fall back to COOK (the most common case).

export const DISPLAY_CONTEXT = Object.freeze({
  COOK:      "cook",       // cook-mode ingredient display, recipe lists
  RECIPE:    "cook",       // alias — recipes and cook-mode use the same intent
  PANTRY:    "pantry",     // pantry rows, kitchen tiles
  SHOPPING:  "pantry",     // shopping list, buy suggestions
  NUTRITION: "nutrition",  // macro math, label rendering
});

function canonicalContext(ctx) {
  if (ctx === "cook" || ctx === "recipe") return "cook";
  if (ctx === "pantry" || ctx === "shopping") return "pantry";
  if (ctx === "nutrition" || ctx === "math") return "nutrition";
  return "cook";
}

function systemKey(system) {
  return system === "metric" ? "metric" : "us";
}

// Unit-family defaults by system, per physical family.
// These are the LAST-RESORT fallback when the canonical declares
// no preferredUnit / measuredIn / defaultUnit and nothing in its
// ladder is idiomatic for the system.
const SYSTEM_FAMILY_FALLBACK = Object.freeze({
  us:     Object.freeze({ mass: "oz", volume: "fl_oz", count: "count" }),
  metric: Object.freeze({ mass: "g",  volume: "ml",    count: "count" }),
});

// ─── User-override storage (context-scoped) ─────────────────────
// localStorage map keyed by canonical id, value is a per-context
// map of unit ids:
//
//   { butter: { cook: "tbsp", pantry: "oz" },
//     flour:  { cook: "g" } }
//
// Legacy v1 flat shape { butter: "tbsp" } is migrated on first read
// into the new shape under the "cook" context (recipe display was
// the only surface users could pick a unit from historically).

const LS_OVERRIDES_V2 = "mise.unitPrefs.v2";
const LS_OVERRIDES_V1 = "mise.unitPrefs.v1";  // legacy — migrated, never written again

function readOverrideMap() {
  if (typeof localStorage === "undefined") return {};
  try {
    const v2Raw = localStorage.getItem(LS_OVERRIDES_V2);
    if (v2Raw) {
      const parsed = JSON.parse(v2Raw);
      return (parsed && typeof parsed === "object") ? parsed : {};
    }
    // Migrate v1 → v2 (one-time, lazy).
    const v1Raw = localStorage.getItem(LS_OVERRIDES_V1);
    if (v1Raw) {
      const v1 = JSON.parse(v1Raw);
      if (v1 && typeof v1 === "object") {
        const v2 = {};
        for (const [id, unit] of Object.entries(v1)) {
          if (typeof unit === "string" && unit) v2[id] = { cook: unit };
        }
        try { localStorage.setItem(LS_OVERRIDES_V2, JSON.stringify(v2)); } catch { /* ignore */ }
        return v2;
      }
    }
    return {};
  } catch {
    return {};
  }
}

function writeOverrideMap(map) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(LS_OVERRIDES_V2, JSON.stringify(map)); } catch { /* ignore */ }
}

// Public accessors. Keyed by ingredient id (the canonical id string).
// Callers never see the storage shape.
export function getUserOverride(ingredientId, context) {
  if (!ingredientId) return null;
  const ctx = canonicalContext(context);
  const map = readOverrideMap();
  const bucket = map[ingredientId];
  if (bucket && typeof bucket === "object" && bucket[ctx]) return bucket[ctx];
  return null;
}

export function setUserOverride(ingredientId, unit, context) {
  if (!ingredientId || !unit) return;
  const ctx = canonicalContext(context);
  const normalized = normalizeUnitId(unit) || unit;
  const map = readOverrideMap();
  const bucket = map[ingredientId] && typeof map[ingredientId] === "object" ? map[ingredientId] : {};
  if (bucket[ctx] === normalized) return;
  bucket[ctx] = normalized;
  map[ingredientId] = bucket;
  writeOverrideMap(map);
}

export function clearUserOverride(ingredientId, context) {
  if (!ingredientId) return;
  const ctx = canonicalContext(context);
  const map = readOverrideMap();
  const bucket = map[ingredientId];
  if (!bucket || typeof bucket !== "object" || !(ctx in bucket)) return;
  delete bucket[ctx];
  if (Object.keys(bucket).length === 0) delete map[ingredientId];
  else map[ingredientId] = bucket;
  writeOverrideMap(map);
}

// ─── Canonical-driven intent resolution ─────────────────────────
// Read the ingredient's own declared intent for the given context.
// Returns null if the canonical doesn't declare anything for this
// context — caller then falls through to ladder / registry defaults.
function canonicalIntentFor(ingredient, sys, ctx) {
  if (!ingredient) return null;

  if (ctx === "nutrition") {
    // Nutrition math always wants grams, with one exception: volume-
    // only ladders (milk, oil before density was declared) should
    // resolve through millilitres since their nutrition `per` is
    // volume-anchored. Detect by the ladder's base anchor.
    const hasG = (ingredient.units || []).some(u => normalizeUnitId(u.id) === "g" && Number(u.toBase) === 1);
    const hasMl = (ingredient.units || []).some(u => normalizeUnitId(u.id) === "ml" && Number(u.toBase) === 1);
    if (hasG) return "g";
    if (hasMl) return "ml";
    return "g";  // default — caller's density bridge will handle the rest
  }

  if (ctx === "pantry") {
    const hint = ingredient.measuredIn?.[sys];
    if (hint && isKnownUnit(hint)) return normalizeUnitId(hint);
    // Pantry falls back to preferredUnit if measuredIn isn't declared —
    // better than picking an arbitrary ladder entry when the author
    // only had one intent in mind.
    const pref = ingredient.preferredUnit?.[sys];
    if (pref && isKnownUnit(pref)) return normalizeUnitId(pref);
    return null;
  }

  // COOK context (default)
  const hint = ingredient.preferredUnit?.[sys];
  if (hint && isKnownUnit(hint)) return normalizeUnitId(hint);
  return null;
}

// Ranked ladder lookup. Returns the FIRST ladder entry whose family
// is idiomatic for the current system. "Idiomatic" means:
//   - US: any unit family is fine (US keeps ladder-local forms like
//     "stick" / "cup" / "oz").
//   - Metric: only g, kg, ml, l pass — a metric user doesn't want
//     "stick" as the default display.
//
// Returns a normalized unit id, or null if nothing in the ladder
// fits.
function pickFromLadder(ingredient, sys) {
  const units = ingredient?.units || [];
  if (units.length === 0) return null;
  for (const u of units) {
    const id = normalizeUnitId(u.id) || String(u.id).toLowerCase();
    if (sys === "us") return id;  // first entry wins; ladders are authored in preferred order
    if (id === "g" || id === "kg" || id === "ml" || id === "l") return id;
  }
  return null;
}

// Registry fallback — pick the family-appropriate universal unit
// based on the canonical's base anchor. Mass-anchored ingredients
// get g (metric) or oz (US). Volume-anchored get ml (metric) or
// fl_oz (US). Count-only get "count".
function pickFromRegistry(ingredient, sys) {
  const anchor = (ingredient?.units || []).find(u => Number(u.toBase) === 1);
  const fam = anchor ? unitFamily(anchor.id) : null;
  if (fam) return SYSTEM_FAMILY_FALLBACK[sys][fam];
  return SYSTEM_FAMILY_FALLBACK[sys].mass;
}

// ─── Public resolver ────────────────────────────────────────────
//
// Priority (highest → lowest):
//   1. User explicit override scoped to (ingredient, system, context).
//   2. Canonical intent for this context:
//        cook/recipe → canonical.preferredUnit[system]
//        pantry/shop → canonical.measuredIn[system] (falls back to
//                       preferredUnit[system] when unset)
//        nutrition   → grams (ml only for pure-volume ladders)
//   3. First entry of canonical.units[] idiomatic for the system.
//   4. Universal registry fallback per family.
//
// Never returns null for a well-formed ingredient — the last step
// guarantees SOMETHING. Returns null only when ingredient is
// missing or malformed.
//
// Note: `system` defaults to "us" on null/unknown so the resolver
// doesn't NaN out when called before localStorage is read.

export function getDisplayUnitForIngredient(ingredient, system, context) {
  if (!ingredient) return null;
  const sys = systemKey(system);
  const ctx = canonicalContext(context);

  // 1. user override
  const override = getUserOverride(ingredient.id, ctx);
  if (override) return override;

  // 2. canonical intent
  const intent = canonicalIntentFor(ingredient, sys, ctx);
  if (intent) return intent;

  // 3. ranked ladder
  const ladderPick = pickFromLadder(ingredient, sys);
  if (ladderPick) return ladderPick;

  // 4. registry fallback
  return pickFromRegistry(ingredient, sys);
}

// ─── Picker options ─────────────────────────────────────────────
//
// Returns ORDERED options for the unit picker. The order is the
// whole point — callers render as-is and the most-relevant choices
// are at the top.
//
// Section layout:
//   A. SELECTED    — the current display unit (from resolver).
//   B. CANONICAL   — every other entry in canonical.units[], in
//                    the author's declared order (ladders are
//                    authored from most-common-cook-usage to least).
//   C. REGISTRY    — compatible universal units in the same family
//                    as the ladder's anchor that aren't already
//                    listed above. Mass anchor → mass universals;
//                    volume anchor → volume universals. Count-only
//                    ladders don't get registry options (you don't
//                    measure tortillas in grams by default).
//
// Each option:
//   { id:        "cup",
//     label:     "cups",      // ladder's own label when available
//     family:    "volume",
//     section:   "selected" | "ladder" | "registry",
//     isSelected: boolean,
//     isLadderLocal: boolean,  // true for stick/wedge/clove/etc.
//   }
//
// Callers (UnitPicker) style "selected" differently (tint+check),
// render ladder-local units natively, and can collapse the registry
// section into a "more units" footer if they choose.

export function getUnitPickerOptions(ingredient, system, context) {
  const sys = systemKey(system);
  const selected = getDisplayUnitForIngredient(ingredient, sys, context);

  const seen = new Set();
  const out = [];

  const labelFor = (id) => {
    const entry = ingredient?.units?.find(u => normalizeUnitId(u.id) === id || u.id === id);
    return entry?.label || id;
  };

  const familyFor = (id) => unitFamily(id) || "count";

  // Returns true when the id is NOT in the registry (i.e. it's a
  // ladder-local unit like stick / wedge / clove that only lives
  // on the ingredient's own ladder).
  const isLadderLocal = (id) => !isKnownUnit(id);

  const pushOption = (rawId, section) => {
    const id = normalizeUnitId(rawId) || String(rawId).toLowerCase();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      label: labelFor(id),
      family: familyFor(id),
      section,
      isSelected: id === selected,
      isLadderLocal: isLadderLocal(id),
    });
  };

  // A. selected first (may or may not be on the ladder)
  if (selected) pushOption(selected, "selected");

  // B. every ladder entry in authored order
  (ingredient?.units || []).forEach(u => {
    pushOption(u.id, out.length === 0 ? "selected" : "ladder");
  });

  // C. registry siblings by ladder's base-anchor family
  const anchor = (ingredient?.units || []).find(u => Number(u.toBase) === 1);
  const anchorFam = anchor ? unitFamily(anchor.id) : null;
  if (anchorFam === "mass") {
    Object.keys(MASS_FACTORS_G).forEach(id => pushOption(id, "registry"));
    // Mass-bearing canonicals with a declared density also get
    // volume registry options offered, so US cooks can still see
    // "cup"/"tbsp" even when the canonical is anchored in grams.
    const hasDensity = Number(ingredient?.density_g_per_ml) > 0 ||
                       Number(ingredient?.density) > 0;
    if (hasDensity) {
      Object.keys(VOLUME_FACTORS_ML).forEach(id => pushOption(id, "registry"));
    }
  } else if (anchorFam === "volume") {
    Object.keys(VOLUME_FACTORS_ML).forEach(id => pushOption(id, "registry"));
    const hasDensity = Number(ingredient?.density_g_per_ml) > 0 ||
                       Number(ingredient?.density) > 0;
    if (hasDensity) {
      Object.keys(MASS_FACTORS_G).forEach(id => pushOption(id, "registry"));
    }
  }
  // count-only ladders intentionally get no registry section — you
  // don't pick tortillas by grams by default.

  // One-time tag flip: if nothing was marked selected above (edge
  // case: resolver returned a unit not in ladder and not in
  // registry), retro-tag the first option.
  if (!out.some(o => o.isSelected) && out.length > 0) {
    out[0] = { ...out[0], isSelected: true, section: "selected" };
  }

  return out;
}

// Thin convenience: most callers just want the label of the
// currently-selected display unit. Used by pantry rows, etc.
export function getDisplayLabelForIngredient(ingredient, system, context) {
  const id = getDisplayUnitForIngredient(ingredient, system, context);
  if (!id) return "";
  const entry = ingredient?.units?.find(u => normalizeUnitId(u.id) === id || u.id === id);
  return entry?.label || id;
}
