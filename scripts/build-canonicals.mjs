#!/usr/bin/env node
// Regenerate the static canonical list the categorize-product-photo
// edge fn ships to Haiku. Run after adding / renaming canonicals in
// src/data/ingredients.js so the AI's constrained pick stays in sync.
//
// Usage:
//   node scripts/build-canonicals.mjs
//
// Output:
//   supabase/functions/categorize-product-photo/canonicals.ts

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { INGREDIENTS } from "../src/data/ingredients.js";

const here = dirname(fileURLToPath(import.meta.url));
const out  = resolve(here, "../supabase/functions/categorize-product-photo/canonicals.ts");

const trimmed = INGREDIENTS.map(i => ({
  id:   i.id,
  name: i.name,
  ...(i.shortName && i.shortName !== i.name ? { shortName: i.shortName } : {}),
  ...(i.category ? { category: i.category } : {}),
}));

const header = `// Auto-generated from src/data/ingredients.js — do not edit by hand.
// Regenerate via: node scripts/build-canonicals.mjs
//
// The edge fn imports this list to constrain Haiku's canonical pick:
// instead of generating free-text "Greek Yogurt" it picks an existing
// id (or proposes a newCanonicalName when no row fits).

export interface CanonicalRow {
  id: string;
  name: string;
  shortName?: string;
  category?: string;
}

export const CANONICALS: CanonicalRow[] = `;

const body = JSON.stringify(trimmed, null, 2);
await writeFile(out, header + body + ";\n", "utf8");
console.log(`✓ wrote ${trimmed.length} canonicals → ${out}`);
