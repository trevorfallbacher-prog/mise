#!/usr/bin/env node
/**
 * scripts/seed_curated_recipes.js
 *
 * One-shot seed for the curated_recipes reference table (migration
 * 0104). Reads every module under src/data/recipes/ and upserts
 * one row per recipe, carrying slug, cuisine, route_tags, and
 * optional collection tag.
 *
 * Only recipes whose routes[] array includes "learn" earn the
 * curated multiplier at runtime, but every bundled recipe is
 * seeded here so the metadata is available for future routes /
 * analytics / admin UI.
 *
 * Usage:
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  node scripts/seed_curated_recipes.js
 *
 * Re-running is safe — upserts on the slug PK.
 *
 * See docs/plans/xp-leveling.md Phase 4a.
 */

import { createClient } from "@supabase/supabase-js";
import { RECIPES } from "../src/data/recipes/index.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function toRow(recipe) {
  return {
    slug:       recipe.slug,
    cuisine:    recipe.cuisine || null,
    route_tags: Array.isArray(recipe.routes) ? recipe.routes : [],
    collection: recipe.collection || null,
  };
}

async function main() {
  const rows = RECIPES.map(toRow);
  const learnCount = rows.filter(r => r.route_tags.includes("learn")).length;
  console.log(`Upserting ${rows.length} recipes (${learnCount} on the learn route)…`);

  // Warn on any learn-route recipes without a cuisine — blocks the
  // per-cuisine curated ladder from attributing correctly. §7 open #3.
  const missingCuisine = rows.filter(
    r => r.route_tags.includes("learn") && !r.cuisine
  );
  if (missingCuisine.length) {
    console.warn("⚠ learn-route recipes missing cuisine:",
      missingCuisine.map(r => r.slug).join(", "));
  }

  const { error } = await supabase
    .from("curated_recipes")
    .upsert(rows, { onConflict: "slug" });

  if (error) {
    console.error("Upsert failed:", error);
    process.exit(1);
  }
  console.log("Done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
