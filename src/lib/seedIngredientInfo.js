import { SEED_INGREDIENT_INFO, SEED_VERSION } from "../data/seedIngredientInfo";

// One-shot ingredient_info auto-seeder.
//
// Runs from inside AuthedApp on mount. The first time a user logs in (per
// browser, per seed version) we upsert the bundled SEED_INGREDIENT_INFO
// rows into the ingredient_info table. After that the localStorage gate
// short-circuits the function so subsequent loads don't re-query the DB.
//
// Why client-side instead of a SQL migration:
//   * Users don't have to paste SQL anywhere — it just works.
//   * The seed data lives next to the JS code that reads it.
//   * Adding new metadata means: edit the JS array + bump SEED_VERSION
//     + redeploy. Existing users get the new rows automatically.
//
// Failure mode: harmless. The JS INGREDIENT_INFO fallback in
// src/data/ingredients.js still renders all metadata if the DB seed
// hasn't run yet. The seeder logs a warning and moves on.
//
// Idempotency: upsert(..., { onConflict: 'ingredient_id' }) means re-runs
// update existing rows rather than failing. The localStorage flag is the
// fast path; the upsert is the safety net.

const STORAGE_KEY = `mise:seed:ingredient_info:v${SEED_VERSION}`;

export async function seedIngredientInfoOnce(supabase) {
  if (!supabase) return { skipped: "no-client" };

  // Fast path — already seeded this version on this browser.
  try {
    if (typeof window !== "undefined" && window.localStorage?.getItem(STORAGE_KEY)) {
      return { skipped: "already-seeded" };
    }
  } catch {
    // localStorage might be disabled (private mode, sandboxed iframes).
    // Fall through and let the upsert run — it's idempotent anyway.
  }

  if (!Array.isArray(SEED_INGREDIENT_INFO) || SEED_INGREDIENT_INFO.length === 0) {
    return { skipped: "empty-seed" };
  }

  const { error } = await supabase
    .from("ingredient_info")
    .upsert(SEED_INGREDIENT_INFO, { onConflict: "ingredient_id" });

  if (error) {
    console.warn("[ingredient_info] auto-seed failed (JS fallback still works):", error.message);
    return { error: error.message };
  }

  try {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(STORAGE_KEY, String(Date.now()));
    }
  } catch {
    // Same private-mode case — non-fatal. Worst case we re-upsert next mount.
  }

  return { seeded: SEED_INGREDIENT_INFO.length };
}
