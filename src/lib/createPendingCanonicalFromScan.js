// Auto-create a pending canonical from a scan that returned identity
// but didn't bind to a registry canonical. Closes the
// "OFF/USDA gave us pickles + brand + tile but no canonical_id"
// gap that pre-this-helper sent users straight into MemoryBookCapture
// despite having plenty of signal.
//
// Three-tier resolution, fastest-first:
//
//   1. inferCanonicalFromName — exact-match against the runtime
//      registry's alias/canonical map. Catches misspellings and
//      common aliases ("dill pickles" → "pickles" if registered).
//
//   2. bindOrCreateCanonical fuzzy bind — when score ≥ 80 against
//      the bundled registry, we bind silently rather than minting a
//      new pending row. Score 60-79 ALSO binds here (pending rows
//      are reviewable; over-binding is cheaper than slug
//      proliferation, and the admin can re-map later if it was
//      wrong).
//
//   3. Create a pending_ingredient_info row. Slug is deterministic
//      from the cleaned product name (brand prefix stripped); the
//      table's (user_id, slug) UNIQUE constraint means re-scans of
//      the same UPC dedupe automatically. Axes (category / tileId /
//      subtype) flow from tagHintsToAxes(categoryHints) so the
//      brand-classifier picker can read subtype on this synthetic
//      canonical the moment it lands.
//
// The pending row's slug is the canonical id callers should use for
// the form / scan / correction binding. The runtime registry picks
// it up via registerCanonicalsFromDb (called from useIngredientInfo's
// merge effect); future scans / lookups treat it like a real
// canonical until an admin promotes or re-maps it.
//
// SCOPE: per-user (RLS on pending_ingredient_info is auth.uid() =
// user_id). If a family member scans the same UPC, they create their
// own pending row at the same slug. Admin promotion to global
// `ingredient_info` deduplicates via approved_canonical_id.
//
// FAILURE MODE: any error (RLS rejection, network blip, etc.) returns
// null silently. The caller falls through to the existing "form lands
// without a canonical" path — no regression. Logs a warn for
// debuggability.

import { bindOrCreateCanonical } from "./bindOrCreateCanonical";
import { tagHintsToAxes } from "./tagHintsToAxes";
import { stripFlavors } from "./stripFlavors";
import { inferCanonicalFromName, findIngredient } from "../data/ingredients";
import { supabase } from "./supabase";

// Slug rule mirrors bindOrCreateCanonical's nameToSlug. 80-char cap
// matches the canonical_id column's de-facto max in pantry_items.
function nameToSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

// Strip a known brand prefix from the productName before slugifying.
// "Vlasic Kosher Dill Pickles" with brand="Vlasic" → "Kosher Dill
// Pickles" → slug "kosher_dill_pickles". Without this, the slug
// pollutes with brand tokens and an admin reviewing the queue sees
// "vlasic_kosher_dill_pickles" instead of the canonical-y form.
function stripBrandPrefix(name, brand) {
  if (!name) return "";
  const trimmed = String(name).trim();
  if (!brand) return trimmed;
  const lower = trimmed.toLowerCase();
  const brandLower = String(brand).toLowerCase();
  if (lower.startsWith(brandLower)) {
    return trimmed.substring(brand.length).replace(/^[\s,'\-]+/, "").trim();
  }
  return trimmed;
}

/**
 * Resolve a product name to a canonical id. May create a pending
 * canonical if the name is genuinely novel.
 *
 * Returns:
 *   { canonicalId, source }      — on success, source ∈
 *                                  {"registry-infer", "fuzzy-bind",
 *                                   "scan-created-pending"}
 *   null                         — on failure (no name, no userId,
 *                                  RLS rejection, etc.)
 */
export async function createPendingCanonicalFromScan({
  userId,
  productName,
  brand          = null,
  categoryHints  = null,
  state          = null,
  emoji          = null,
}) {
  if (!userId) return null;
  const rawName = String(productName || "").trim();
  if (!rawName) return null;

  // FLAVOR-FREE NAME — strip variant/flavor tokens BEFORE everything
  // else so the synthetic canonical's slug + display name never
  // carry "Fudge Swirl" / "Honey BBQ" / "Cookies & Cream" / etc.
  // Without this strip, a re-scan of the same UPC would set the
  // form's name field to the full marketing string when the canonical
  // pin fires, which violates the CLAUDE.md identity-stack rule:
  // canonical IS the name; flavor lives on claims.
  const flavorScan = stripFlavors(rawName, { brand, removeFromName: true });
  const flavorFreeName = (flavorScan.remainingName || rawName).trim();

  // Tier 1 — registry alias / inference. Run against the flavor-
  // stripped name so "Milk Chocolate Truffles" hits the chocolate
  // canonical instead of "...Fudge Swirl" failing the alias match.
  const inferred = inferCanonicalFromName(flavorFreeName);
  if (inferred && inferred.id && findIngredient(inferred.id)) {
    return { canonicalId: inferred.id, source: "registry-infer" };
  }

  // Tier 2 — fuzzy bind via bindOrCreateCanonical. Same — feed the
  // flavor-stripped name. Score ≥ 60 binds silently; we'd rather
  // over-bind to a real canonical than spam the pending queue with
  // near-duplicates. Admin can re-map a wrong bind later via the
  // standard correction flow.
  const decision = bindOrCreateCanonical(flavorFreeName);
  if (decision.decision === "bind") {
    return { canonicalId: decision.canonicalId, source: "fuzzy-bind" };
  }
  if (decision.decision === "suggest" && decision.canonicalId) {
    return { canonicalId: decision.canonicalId, source: "fuzzy-bind" };
  }

  // Tier 3 — create a pending canonical. Slug from the brand-stripped
  // AND flavor-stripped name; admin queue sees "potato_chips" not
  // "lays_sour_cream_and_onion_potato_chips" or
  // "milk_chocolate_truffles_fudge_swirl".
  const cleanName = stripBrandPrefix(flavorFreeName, brand);
  const slug = nameToSlug(cleanName) || nameToSlug(flavorFreeName);
  if (!slug) return null;

  // Axes from OFF category hints. tagHintsToAxes returns
  // category/tileId/typeId/subtype/state — all optional. We forward
  // whatever lands so the brand-classifier picker can score against
  // this synthetic canonical on the next scan.
  const axes = tagHintsToAxes(Array.isArray(categoryHints) ? categoryHints : []);

  // info.name is the SYNTHETIC CANONICAL's display name. Per the
  // CLAUDE.md identity-stack rule, the canonical IS the name —
  // brand / state / flavor / package size compose around it. Use
  // the flavor-stripped name so "Fudge Swirl" never lands here
  // and the canonical-pin in the form reads "Milk Chocolate
  // Truffles" instead of the full marketing copy.
  const info = {
    name:     cleanName || flavorFreeName,
    category: axes.category || null,
    tileId:   axes.tileId   || null,
    typeId:   axes.typeId   || null,
    subtype:  axes.subtype  || null,
    state:    state || axes.state || null,
    emoji:    emoji || null,
    // Stash extracted flavor claims at the synthetic canonical so
    // future scans of UPCs that bind to this same slug carry the
    // flavor through correction memory without re-running the
    // strip pipeline. Populated only when stripFlavors found
    // something to extract.
    extractedClaims: flavorScan.claims.length > 0 ? flavorScan.claims : undefined,
    source:   "scan_inferred",
  };

  // Upsert — (user_id, slug) is UNIQUE (migration 0047). Re-scans of
  // the same UPC find the existing row and update info if axes
  // changed (which they shouldn't, since OFF data is stable for a
  // given UPC, but the merge is harmless if so).
  const { error } = await supabase
    .from("pending_ingredient_info")
    .upsert({
      user_id:     userId,
      slug,
      source_name: rawName,
      info,
      status:      "pending",
    }, { onConflict: "user_id,slug" });

  if (error) {
    console.warn("[create-pending-canonical] upsert failed:", error.message);
    return null;
  }

  return { canonicalId: slug, source: "scan-created-pending" };
}
