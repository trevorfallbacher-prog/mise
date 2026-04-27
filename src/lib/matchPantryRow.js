// Multi-token pantry row matcher.
//
// Closes the gap where "sour cream chips" wouldn't find a Lay's Sour
// Cream & Onion Potato Chips row. The previous Kitchen.jsx and
// MCM KitchenScreen filters did substring containment on individual
// fields:
//
//   row.name.includes("sour cream chips")  →  false
//   claim.includes("sour cream chips")     →  false
//   row.canonicalName.includes("sour cream chips") → false
//
// No single field carries the full phrase, so the row stayed hidden.
//
// The fix is token-based: split the query into words, build a
// searchable text bag from every relevant row field (name, brand,
// scan-raw text, claims, flavors, canonical display, typeLabel,
// location, category, ingredient tags), and require EVERY query
// token to appear somewhere in that bag.
//
// "sour cream chips" → tokens ["sour", "cream", "chips"]
// Bag = "lay's sour cream and onion potato chips potato_chips ..."
// All three tokens hit → row matches.
//
// This file is the SHARED source of truth so Kitchen.jsx and
// MCM KitchenScreen behave identically. Future scan / shopping
// list / wizard typeaheads can wrap the same matcher.

import { findIngredient } from "../data/ingredients";

const TOKEN_SPLIT = /[\s,/&_\-]+/;

// Build the searchable text bag for a pantry row. Returns a single
// lowercase string with every relevant field concatenated. Helpers
// (findIngredient, etc.) injected via opts so the matcher stays a
// pure function — useful for testing without React/registry context.
function bagForRow(item, opts = {}) {
  const parts = [];
  const push = (v) => {
    if (v == null) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (t) parts.push(t);
    } else if (Array.isArray(v)) {
      for (const x of v) push(x);
    } else {
      push(String(v));
    }
  };

  // Identity fields — name, brand, the original scanned text
  push(item.name);
  push(item.brand);
  push(item.scanRaw);

  // Composed display name — what the user actually sees. Catches
  // brand-prefixed forms like "Kerrygold Butter" when the row's
  // `name` field is just "butter".
  push(opts.displayName);

  // Categories / type / location / shelf tile
  push(item.category);
  push(item.typeLabel);
  push(item.location);
  push(item.tileId);

  // Canonical display — both the registry name and the slug.
  // The slug carries underscores ("peanut_butter_cup") which the
  // tokenizer splits on, so a query for "peanut butter cup" hits.
  if (item.canonicalId) {
    push(item.canonicalId);
    const ing = findIngredient(item.canonicalId);
    if (ing) {
      push(ing.name);
      push(ing.shortName);
    }
  }
  if (item.ingredientId && item.ingredientId !== item.canonicalId) {
    push(item.ingredientId);
    const ing = findIngredient(item.ingredientId);
    if (ing) {
      push(ing.name);
      push(ing.shortName);
    }
  }

  // attributes.* — the row's identity-axis values. Claims is the
  // load-bearing one for flavor/variant queries ("sour cream",
  // "fudge swirl") since stripFlavors and the categorize-product-
  // photo edge fn both write extracted variant tokens here.
  if (item.attributes) {
    push(item.attributes.claims);
    push(item.attributes.flavor);
    push(item.attributes.state);
    push(item.attributes.cut);
  }

  // Direct row-level claims / flavor (some legacy rows have these
  // on the row top-level instead of attributes).
  push(item.claims);
  push(item.flavor);

  // Ingredient composition tags — a multi-tag item ("burrito" with
  // chicken / cheese / tortilla / etc.) lets a query for any
  // contained ingredient surface the parent row.
  if (Array.isArray(item.ingredientIds) || Array.isArray(item.ingredients)) {
    const tags = item.ingredientIds || item.ingredients || [];
    for (const id of tags) {
      push(id);
      const ing = findIngredient(id);
      if (ing) {
        push(ing.name);
        push(ing.shortName);
      }
    }
  }

  return parts.join(" ").toLowerCase();
}

/**
 * Multi-token containment match. Returns true when every token in
 * the query appears somewhere in the row's searchable text bag.
 *
 * Empty query → always true (caller filters out by checking length
 * before calling).
 */
export function matchPantryRow(item, query, opts = {}) {
  if (!item) return false;
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  const tokens = q
    .split(TOKEN_SPLIT)
    .map(t => t.trim())
    .filter(t => t.length >= 2);   // skip 1-char noise ("a", "&")

  if (tokens.length === 0) return true;

  const bag = bagForRow(item, opts);
  for (const tok of tokens) {
    if (!bag.includes(tok)) return false;
  }
  return true;
}

/**
 * Lower-level helper exposed for tests and debugging — the actual
 * text bag a row produces. Useful when "why isn't this row
 * matching?" comes up.
 */
export { bagForRow };
