#!/usr/bin/env node
/**
 * scripts/audit_unit_metadata.mjs
 *
 * Audits every bundled canonical in src/data/ingredients.js for the
 * three unit-metadata axes the resolver relies on:
 *
 *   1. preferredUnit { us, metric }
 *      → cook/recipe display unit. CookMode.applyPreferredUnit reads
 *        this FIRST. Missing → resolver falls through to ladder pick,
 *        which defaults to the ladder's first authored entry on US
 *        and "g"/"ml" on metric. That's why Metric users see grams
 *        for items like giardiniera that should be cup/ml.
 *
 *   2. measuredIn { us, metric }
 *      → pantry/shopping display unit. Falls back to preferredUnit
 *        when unset, so a missing measuredIn isn't broken — but it
 *        means the SAME unit drives both surfaces, which is wrong
 *        for items where cooks-by-X but buys-by-Y (butter is
 *        cook=tbsp, buy=oz).
 *
 *   3. count_weight_g (or COUNT_WEIGHTS_G / CUT_WEIGHTS_G entry)
 *      → grams per ONE count item. Required only when the canonical
 *        has count-style units (count/each/clove/slice/piece/dozen/
 *        ladder-locals like stick/wedge that anchor a single piece).
 *        Without this, count↔mass conversion fails and recipe
 *        amounts in count won't pair against pantry amounts in g.
 *
 * Run:
 *   node scripts/audit_unit_metadata.mjs
 *   node scripts/audit_unit_metadata.mjs --json    # machine-readable
 *
 * Re-runnable. No DB writes, no side effects.
 */

import { INGREDIENTS, COUNT_WEIGHTS_G, CUT_WEIGHTS_G } from "../src/data/ingredients.js";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");

// Units that imply a single-piece anchor — if any of these appear
// on the canonical's ladder, we expect a count_weight_g (inline,
// COUNT_WEIGHTS_G, or CUT_WEIGHTS_G via the parent hub) so the
// count-bridge path can resolve. "stick" / "wedge" / "clove" are
// ladder-local so they get listed too — they're the unit users
// reach for when the ingredient is naturally counted.
const COUNT_UNITS = new Set([
  "count", "each", "piece", "pieces", "ea", "ct",
  "clove", "cloves", "slice", "slices",
  "stick", "sticks", "wedge", "wedges",
  "dozen",
]);

// True when the ladder has a count-style anchor. Looks at both the
// canonical-id and the label so ladder-local labels ("eggs",
// "pieces") aren't missed.
function hasCountAxis(canonical) {
  return (canonical.units || []).some(u => {
    const id = String(u.id || "").toLowerCase();
    const label = String(u.label || "").toLowerCase();
    return COUNT_UNITS.has(id) || COUNT_UNITS.has(label);
  });
}

// True when the canonical's ladder is mass+volume only with no
// count units — a count_weight_g entry on these is meaningless
// (you don't bridge oz→count for a liquid).
function isPureMassVolume(canonical) {
  return !hasCountAxis(canonical);
}

// Resolve count_weight_g across all the places we look:
//   - inline ingredient.count_weight_g
//   - COUNT_WEIGHTS_G[id]
//   - CUT_WEIGHTS_G[parentId or id] (any cut entry counts as
//     "covered" — meat hubs are covered if at least one cut has
//     a default weight; the per-cut prompt is the user-visible
//     fallback for less-common cuts).
function hasCountWeight(canonical) {
  if (Number(canonical.count_weight_g) > 0) return "inline";
  if (Number(COUNT_WEIGHTS_G[canonical.id]) > 0) return "COUNT_WEIGHTS_G";
  const cutHubKey = canonical.id;
  if (CUT_WEIGHTS_G[cutHubKey] && Object.keys(CUT_WEIGHTS_G[cutHubKey]).length > 0) {
    return "CUT_WEIGHTS_G";
  }
  if (canonical.parentId && CUT_WEIGHTS_G[canonical.parentId] &&
      Object.keys(CUT_WEIGHTS_G[canonical.parentId]).length > 0) {
    return "CUT_WEIGHTS_G(parent)";
  }
  return null;
}

function hasBothSystems(field) {
  if (!field || typeof field !== "object") return false;
  return typeof field.us === "string" && field.us.length > 0 &&
         typeof field.metric === "string" && field.metric.length > 0;
}

function partialSystems(field) {
  if (!field || typeof field !== "object") return null;
  const has = [];
  if (typeof field.us === "string"     && field.us.length > 0)     has.push("us");
  if (typeof field.metric === "string" && field.metric.length > 0) has.push("metric");
  if (has.length === 0 || has.length === 2) return null;
  return has;  // only one side declared
}

const report = {
  total: INGREDIENTS.length,
  missingPreferredUnit: [],   // no preferredUnit OR missing one of {us, metric}
  missingMeasuredIn:    [],   // no measuredIn (acceptable — falls back; reported anyway)
  partialPreferredUnit: [],   // declared but missing us OR metric
  partialMeasuredIn:    [],   // declared but missing us OR metric
  needsCountWeight:     [],   // has count axis, no count_weight_g resolved
};

for (const c of INGREDIENTS) {
  const sumLine = { id: c.id, name: c.name, category: c.category || null };

  // preferredUnit — drives COOK display. Missing here is the
  // user-visible bug (Metric users see grams when the recipe
  // expects cup/tbsp/etc).
  if (!hasBothSystems(c.preferredUnit)) {
    const partial = partialSystems(c.preferredUnit);
    if (partial) report.partialPreferredUnit.push({ ...sumLine, has: partial });
    else         report.missingPreferredUnit.push(sumLine);
  }

  // measuredIn — pantry/shopping. Falls back to preferredUnit so a
  // bare missing here isn't broken; report so we can decide whether
  // pantry needs its own unit (butter cook=tbsp, buy=oz).
  if (!hasBothSystems(c.measuredIn)) {
    const partial = partialSystems(c.measuredIn);
    if (partial) report.partialMeasuredIn.push({ ...sumLine, has: partial });
    else         report.missingMeasuredIn.push(sumLine);
  }

  // count_weight_g — only required when the ladder has count axes.
  if (hasCountAxis(c) && !hasCountWeight(c)) {
    const ladderUnits = (c.units || [])
      .map(u => String(u.id || "").toLowerCase())
      .filter(id => COUNT_UNITS.has(id));
    report.needsCountWeight.push({ ...sumLine, countUnits: ladderUnits });
  }
}

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(0);
}

// Human-readable report
const fmt = (rows) => rows
  .map(r => {
    const cat = r.category ? ` [${r.category}]` : "";
    const has = r.has ? ` (has: ${r.has.join(",")})` : "";
    const cu  = r.countUnits ? ` (count units: ${r.countUnits.join(",")})` : "";
    return `  ${r.id.padEnd(32)} ${r.name}${cat}${has}${cu}`;
  })
  .join("\n");

console.log(`# Unit-metadata audit — ${report.total} bundled canonicals`);
console.log("");
console.log(`## preferredUnit MISSING — ${report.missingPreferredUnit.length}`);
console.log("Drives COOK display. Missing → Metric users see ladder-default (usually g/ml) instead of recipe intent.");
if (report.missingPreferredUnit.length > 0) console.log(fmt(report.missingPreferredUnit));
console.log("");
console.log(`## preferredUnit PARTIAL (only one system declared) — ${report.partialPreferredUnit.length}`);
if (report.partialPreferredUnit.length > 0) console.log(fmt(report.partialPreferredUnit));
console.log("");
console.log(`## measuredIn MISSING — ${report.missingMeasuredIn.length}`);
console.log("Drives PANTRY display. Falls back to preferredUnit, so missing isn't broken — but a separate unit is correct when buy-unit ≠ cook-unit (butter buy=oz cook=tbsp).");
if (report.missingMeasuredIn.length > 0) console.log(fmt(report.missingMeasuredIn));
console.log("");
console.log(`## measuredIn PARTIAL — ${report.partialMeasuredIn.length}`);
if (report.partialMeasuredIn.length > 0) console.log(fmt(report.partialMeasuredIn));
console.log("");
console.log(`## count_weight_g MISSING (count-axis canonicals only) — ${report.needsCountWeight.length}`);
console.log("Required when ladder has count/each/clove/slice/piece/stick/wedge — without it, count↔mass bridge fails.");
if (report.needsCountWeight.length > 0) console.log(fmt(report.needsCountWeight));
console.log("");
console.log("Done.");
