// STRICT CONVERSION CORE.
//
// Contract:
//   convertStrict(qty, toUnit, ingredient) → Result
//     where Result is one of:
//       { ok: true,  value: number, path: "ladder" | "same-family" | "density-bridge" | "count-bridge" }
//       { ok: false, reason: ErrorCode, detail?: string }
//
// Deterministic. NEVER guesses. NEVER assumes water density.
// The three resolution paths, in order:
//
//   1. LADDER         — both units live on the ingredient's own
//                       units[] array. Uses toBase ratios directly.
//                       The only path that carries density-adjusted
//                       values for THIS ingredient (1 cup flour vs
//                       1 cup water).
//
//   2. SAME-FAMILY    — both units are MASS (or both VOLUME), unit
//                       ladder is partial. Uses MASS_FACTORS_G or
//                       VOLUME_FACTORS_ML. This is pure physics —
//                       no density assumption involved.
//
//   3. DENSITY-BRIDGE — one side is mass, the other volume. REQUIRES
//                       explicit ingredient.density_g_per_ml. Returns
//                       `no-density` error if missing. No silent
//                       water-standard fallback.
//
//   4. COUNT-BRIDGE   — one side is count, the other mass/volume.
//                       REQUIRES explicit ingredient.count_weight_g
//                       (or legacy CUT_WEIGHTS_G lookup). Returns
//                       `no-count-weight` on miss.
//
// Error codes (all strings, all stable — callers may branch on them):
//   - "missing-args"      — qty/toUnit/ingredient null or malformed
//   - "unknown-from-unit" — qty.unit doesn't normalize
//   - "unknown-to-unit"   — toUnit doesn't normalize
//   - "bad-amount"        — qty.amount not a finite number
//   - "no-density"        — cross-family attempt without density_g_per_ml
//   - "no-count-weight"   — count bridge attempt without count_weight_g
//   - "incompatible"      — count ↔ volume without a mass mid-step
//   - "unresolvable"      — no path found (ladder miss + no bridge)

import { normalizeUnitId } from "./aliases";
import { MASS_FACTORS_G, VOLUME_FACTORS_ML, UNIT_FAMILY } from "./registry";

function err(reason, detail) {
  const out = { ok: false, reason };
  if (detail) out.detail = detail;
  return out;
}

function ok(value, path) {
  return { ok: true, value, path };
}

// Lookup a unit on an ingredient's declared ladder. Normalizes the
// ladder entry id AND the query id so mixed-case data in the wild
// resolves consistently.
function findLadderEntry(ingredient, unitId) {
  const want = normalizeUnitId(unitId);
  if (!want || !ingredient?.units) return null;
  for (const u of ingredient.units) {
    if (normalizeUnitId(u.id) === want) return u;
  }
  return null;
}

// Family-native base value for a unit (grams for mass, ml for volume).
// Returns null if the unit is not in a universal family.
function universalBaseFactor(unitId) {
  const n = normalizeUnitId(unitId);
  if (!n) return null;
  if (MASS_FACTORS_G[n] != null)    return { value: MASS_FACTORS_G[n],    family: "mass"   };
  if (VOLUME_FACTORS_ML[n] != null) return { value: VOLUME_FACTORS_ML[n], family: "volume" };
  return null;
}

// Resolve an ingredient's density. Reads ONLY the explicit field;
// does not default to water (1.0). A missing density is a real
// condition that must be surfaced to the caller as an error.
//
// Accepts both modern `density_g_per_ml` (preferred going forward)
// and legacy inline values passed as `ingredient.density`.
function readDensity(ingredient) {
  if (!ingredient) return null;
  const explicit = Number(ingredient.density_g_per_ml ?? ingredient.density);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return null;
}

// Count weight resolver. Reads ONLY explicit fields on the ingredient
// or a pantry row. No silent default — missing count weight is an
// error.
function readCountWeightG(ingredient, row) {
  const rowVal = Number(row?.countWeightG);
  if (Number.isFinite(rowVal) && rowVal > 0) return rowVal;
  const ingVal = Number(ingredient?.count_weight_g);
  if (Number.isFinite(ingVal) && ingVal > 0) return ingVal;
  return null;
}

// ─── Public entry point ──────────────────────────────────────────

export function convertStrict(qty, toUnit, ingredient, options = {}) {
  if (!qty || typeof qty !== "object") return err("missing-args", "qty required");
  if (toUnit == null || toUnit === "")  return err("missing-args", "toUnit required");

  const amount = Number(qty.amount);
  if (!Number.isFinite(amount)) return err("bad-amount", String(qty.amount));

  const fromUnit = normalizeUnitId(qty.unit);
  const normTo   = normalizeUnitId(toUnit);
  if (!fromUnit) return err("unknown-from-unit", String(qty.unit));
  if (!normTo)   return err("unknown-to-unit",   String(toUnit));

  if (fromUnit === normTo) return ok(amount, "ladder");

  // ── Path 1: ladder (ingredient-declared factors, density-aware) ─
  const fromEntry = findLadderEntry(ingredient, fromUnit);
  const toEntry   = findLadderEntry(ingredient, normTo);
  if (fromEntry && toEntry) {
    const fBase = Number(fromEntry.toBase);
    const tBase = Number(toEntry.toBase);
    if (!Number.isFinite(fBase) || fBase <= 0) return err("bad-amount", `ladder.${fromUnit}.toBase`);
    if (!Number.isFinite(tBase) || tBase <= 0) return err("bad-amount", `ladder.${normTo}.toBase`);
    return ok((amount * fBase) / tBase, "ladder");
  }

  // ── Path 2: same-family universal (physics, no density assumed) ─
  const fromFam = UNIT_FAMILY[fromUnit];
  const toFam   = UNIT_FAMILY[normTo];
  if (fromFam && fromFam === toFam && fromFam !== "count") {
    const fromBase = universalBaseFactor(fromUnit);
    const toBase   = universalBaseFactor(normTo);
    if (fromBase && toBase) {
      return ok((amount * fromBase.value) / toBase.value, "same-family");
    }
  }

  // ── Path 3: density bridge (cross-family mass ↔ volume) ─────────
  if ((fromFam === "mass" && toFam === "volume") ||
      (fromFam === "volume" && toFam === "mass")) {
    const density = readDensity(ingredient);
    if (density == null) {
      return err("no-density", ingredient?.id || "unknown");
    }
    // Normalize both sides to grams using density to cross the bridge.
    const fromBase = universalBaseFactor(fromUnit);
    const toBase   = universalBaseFactor(normTo);
    if (!fromBase || !toBase) return err("unresolvable", `${fromUnit}→${normTo}`);
    // from → grams (if volume, multiply by density to get mass)
    const grams = fromFam === "mass"
      ? amount * fromBase.value
      : amount * fromBase.value * density;
    // grams → to
    const out = toFam === "mass"
      ? grams / toBase.value
      : (grams / density) / toBase.value;
    if (!Number.isFinite(out)) return err("bad-amount", "bridge-nan");
    return ok(out, "density-bridge");
  }

  // ── Path 4: count bridge (requires explicit count_weight_g) ─────
  if (fromFam === "count" || toFam === "count") {
    const gPerCount = readCountWeightG(ingredient, options.row);
    if (gPerCount == null) {
      return err("no-count-weight", ingredient?.id || "unknown");
    }
    // Convert via grams. count → g uses gPerCount; if the other side
    // is volume, we ALSO need density — compose both bridges.
    if (fromFam === "count") {
      const grams = amount * gPerCount;
      if (toFam === "mass") {
        const toBase = universalBaseFactor(normTo);
        if (!toBase) return err("unresolvable", `count→${normTo}`);
        return ok(grams / toBase.value, "count-bridge");
      }
      if (toFam === "volume") {
        const density = readDensity(ingredient);
        if (density == null) return err("no-density", ingredient?.id || "unknown");
        const toBase = universalBaseFactor(normTo);
        if (!toBase) return err("unresolvable", `count→${normTo}`);
        return ok((grams / density) / toBase.value, "count-bridge");
      }
      return err("incompatible", `count→${toFam}`);
    }
    // toFam === "count"
    const fromBase = universalBaseFactor(fromUnit);
    if (!fromBase) return err("unresolvable", `${fromUnit}→count`);
    if (fromFam === "mass") {
      const grams = amount * fromBase.value;
      return ok(grams / gPerCount, "count-bridge");
    }
    if (fromFam === "volume") {
      const density = readDensity(ingredient);
      if (density == null) return err("no-density", ingredient?.id || "unknown");
      const grams = amount * fromBase.value * density;
      return ok(grams / gPerCount, "count-bridge");
    }
    return err("incompatible", `${fromFam}→count`);
  }

  return err("unresolvable", `${fromUnit}→${normTo}`);
}

// Hard-throwing convenience for dev assertions and tests. Prefer
// convertStrict in production callers — a UI should render a
// graceful "can't convert" badge, not crash the app.
export function convertOrThrow(qty, toUnit, ingredient, options) {
  const res = convertStrict(qty, toUnit, ingredient, options);
  if (!res.ok) {
    throw new Error(`convertOrThrow failed: ${res.reason}${res.detail ? ` (${res.detail})` : ""}`);
  }
  return res.value;
}
