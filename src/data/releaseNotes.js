// Release notes — bundled per-version changelog the user sees.
//
// Newest entry FIRST. Bump CURRENT_VERSION to the new entry's version
// when shipping. The "what's new" notification compares CURRENT_VERSION
// against the user's locally-stored last-seen version and surfaces a
// small notification when there's a delta.
//
// Entry shape:
//
//   {
//     version: "0.2.0",                  // semver-ish, monotonic
//     date:    "2026-04-16",             // ISO date
//     title:   "Short headline",         // <60 chars, shown in notification
//     summary: "One-paragraph pitch...", // shown in modal at the top
//     shipped: [
//       { kind: 'feature' | 'fix' | 'safety' | 'ux' | 'architecture',
//         text: "User-facing one-liner",
//         commits: ["abcd123", ...]      // optional, helps future debugging
//       },
//       ...
//     ],
//     coming_soon: [                     // optional; teases what's next
//       "Free-text bullet about what's queued",
//       ...
//     ],
//   }
//
// Voice rules:
//   * Speak to the user, not about implementation. "Meals can now be
//     composed of other meals" — not "Migration 0034 adds the
//     pantry_item_components table."
//   * Lead with what they can DO, not what we did.
//   * `commits` is for future-debugging, not user-facing — the modal
//     shows kind+text, never the commit hashes. Leave them in the
//     data so a maintainer can grep.
//   * Keep summaries scannable. If a user opens the modal during
//     dinner prep, they should be able to skim it in 30 seconds.
//
// Adding a release:
//   1. Bump CURRENT_VERSION below
//   2. PREPEND a new entry to RELEASE_NOTES (newest first)
//   3. Bump package.json's version to match
//   4. Ship — users get the notification on next app open

export const CURRENT_VERSION = "0.4.0";

export const RELEASE_NOTES = [
  {
    version: "0.4.0",
    date:    "2026-04-16",
    title:   "One search, smarter placement, better flour",
    summary:
      "Add Item just got a single unified search. Type anything — your " +
      "family's saved items come up first, then the global ingredient " +
      "registry, all in one dropdown with tile-context priority. " +
      "We also taught the app to remember where you put each item so " +
      "your frozen pizza stops landing in the dairy tile. And yes, " +
      "actual flour options now (bread, whole wheat, 00, pastry, cake, " +
      "rice, almond, cornmeal, masa — 11 total).",
    shipped: [
      {
        kind: "feature",
        text: "Unified search in Add Item — the name field pulls your family's saved items AND our ingredient registry into one ranked dropdown. FROM LIST tab is gone; search is everything now",
        commits: ["0bd6106"],
      },
      {
        kind: "feature",
        text: "Tile-context priority: when you open Add from a specific tile, items that belong there float to the top of the search results with an IN TILE hint",
        commits: ["0bd6106"],
      },
      {
        kind: "feature",
        text: "Tile memory: your placement decisions persist per-item. Added Home Run Inn Pizza to Frozen Meals last time? Next family member sees it land there automatically, even if they opened Add from a different tile",
        commits: ["a1d9333"],
      },
      {
        kind: "fix",
        text: "Composed items (frozen cheese pizza, Italian blend shredded cheese, store-bought pesto) no longer route by their biggest component — the user's explicit placement wins over the heuristic",
        commits: ["a1d9333"],
      },
      {
        kind: "feature",
        text: "Flour registry: 11 proper flour canonicals under a Flour hub — All-Purpose, Bread, Whole Wheat, Pastry, Cake, 00, Semolina, Rice, Almond, Coconut, Cornmeal, Masa Harina. Each with its own weight-to-volume so recipe math stops pretending almond flour weighs the same as all-purpose",
        commits: ["135b29c"],
      },
      {
        kind: "ux",
        text: "Search dropdown distinguishes between what's yours (👤 YOURS · USED 4× · 2d) and what's from the registry (📖 INGREDIENT · DAIRY · CHEESE). Exact-name matches get the same EXACT MATCH · WILL MERGE INTO THIS hint templates already had",
        commits: ["0bd6106"],
      },
    ],
    coming_soon: [
      "Scan-side template matching — when a receipt has \"Home Run Inn Pizza\" on it, we match your template first instead of routing to generic pizza canonical",
      "Admin-promoted community tier — most-used templates across families get blessed into a global composites set (Margherita Pizza, BLT, etc.)",
      "Per-component proportion slider — \"I used 30% of the salt jar\" recorded on a cook without weighing",
      "Enrichment seed pass for the new flour canonicals — description / flavor profile / substitutes / prep tips, same treatment the spice rack got",
      "Pantry -> Kitchen rename so 'Pantry' can mean just the pantry sub-tab",
    ],
  },
  {
    version: "0.3.0",
    date:    "2026-04-16",
    title:   "Your kitchen remembers — family-shared templates for recurring items",
    summary:
      "Stop retyping the same brand names every grocery run. When you " +
      "add a custom item (\"Home Run Inn Pizza\"), we now save it as a " +
      "template for your whole family. Next time anyone in your " +
      "household types it, the name, emoji, components, and defaults " +
      "autofill. Strict dedup keeps the list clean — no more \"Home " +
      "Run Inn Pizza\" next to \"home run in pizza cheese\" because " +
      "someone didn't see the existing one.",
    shipped: [
      {
        kind: "feature",
        text: "YOUR RECENTS: every custom item you add becomes a family-shared template — tap any recent to autofill name, emoji, components, and unit next time you add it",
        commits: ["513783f", "ba08c63", "3d84e72"],
      },
      {
        kind: "feature",
        text: "Typeahead suggestions as you type — the dropdown surfaces matching templates with \"used 4×\" and \"2d ago\" context",
        commits: ["54e245d"],
      },
      {
        kind: "feature",
        text: "Strict family dedup: when your spouse adds \"Home Run Inn Pizza\" after you did, saving merges into the existing template instead of creating a duplicate (with an EXACT MATCH hint before saving so the merge is visible, not silent)",
        commits: ["513783f", "54e245d"],
      },
      {
        kind: "ux",
        text: "Add Item opens to CUSTOM mode by default now — brand-specific and household-specific items are the common case, canonical ingredients are the fallback",
        commits: ["fb4d7c2"],
      },
      {
        kind: "ux",
        text: "Use-count tracking (\"3×\", \"12×\") surfaces which templates you reach for most — rankings recency-first, but fun to see which item your household has bought the most this month",
        commits: ["ba08c63"],
      },
      {
        kind: "architecture",
        text: "Foundation work: patch-notes system (what you're reading!), philosophy rules in ARCHITECTURE.md, migration template with RLS patterns, release-notes voice guide — all designed so this app can scale without the foundation cracking",
        commits: ["c3e5109", "08bb022", "87c6618", "5e754cf", "fcacbd5", "e21ca56", "020220d", "4d4fd4d", "1cddda1"],
      },
    ],
    coming_soon: [
      "Scan-side template matching — when you scan a receipt with \"Home Run Inn Pizza\" on it, we match your template first before the generic canonical, so brand identity survives the scan",
      "Admin-promoted community tier — most-used templates across families can eventually get blessed into a global \"Community Composites\" set (Margherita Pizza, BLT, etc.) so new users benefit from the crowd",
      "Per-component proportion slider — \"I used 30% of the salt jar\" recorded on a cook without weighing anything",
      "Spice family hubs — collapse the 70+ spice ingredients into themed groups (Chili Family, Dried Herbs, etc.)",
      "Pantry → Kitchen rename — the top-level concept becomes 'Kitchen' so 'Pantry' can mean just the pantry sub-tab",
    ],
  },
  {
    version: "0.2.0",
    date:    "2026-04-16",
    title:   "Meals + Components — items can now contain other items",
    summary:
      "The kitchen got smarter about what's actually on your shelf. " +
      "A frozen pizza isn't just 'one item' anymore — it's a Meal " +
      "made of dough, sauce, cheese, and pepperoni, and recipes " +
      "calling for any of those will find it. Same for Italian " +
      "Blend cheese, leftover lasagna, your homemade hot sauce. " +
      "Plus a pile of safety nets and quality-of-life upgrades.",
    shipped: [
      {
        kind: "feature",
        text: "Multi-tag items: pick any number of canonical ingredients when linking — the picker accumulates instead of force-closing on the first tap",
        commits: ["b5b09bd"],
      },
      {
        kind: "feature",
        text: "Components tree: items composed of multiple ingredients now have a structured COMPONENTS section instead of a flat tag list",
        commits: ["2bda8e9", "70f0a1e", "9a02672", "ff644da"],
      },
      {
        kind: "feature",
        text: "Recursive drill: tap a sub-item component to drill into its own card — your leftover lasagna can show its marinara, which can show its tomatoes",
        commits: ["ff644da"],
      },
      {
        kind: "feature",
        text: "Cooked leftovers automatically capture what they were made from — every consumed item becomes a component on the saved leftover",
        commits: ["68f30c1"],
      },
      {
        kind: "feature",
        text: "Name your leftovers anything you want — \"Mom's Lasagna\" instead of \"Leftover Lasagna\", optional override on the cook-complete screen",
        commits: ["64c9118"],
      },
      {
        kind: "feature",
        text: "Build custom items with components inline — adding a \"Curry Ketchup\" lets you pick [ketchup, curry_powder] right in the add form",
        commits: ["5d4ccd4"],
      },
      {
        kind: "feature",
        text: "+ EDIT button on every ItemCard — re-link or re-compose any item without backing out to the pantry",
        commits: ["d31ffb4"],
      },
      {
        kind: "safety",
        text: "Delete confirmation — the ✕ on a pantry row now asks \"are you sure?\" before removing it from your kitchen",
        commits: ["084f66c"],
      },
      {
        kind: "ux",
        text: "Long tag lists collapse: items with 6+ ingredients show the first 5 with a \"+N MORE\" toggle so the card stays readable",
        commits: ["389966b"],
      },
      {
        kind: "ux",
        text: "Linking is now a single path — every link/unlink action goes through the ItemCard's + EDIT button, no more parallel quick-link shortcuts",
        commits: ["5d4ccd4"],
      },
      {
        kind: "architecture",
        text: "Foundation work: design tokens for fonts/colors/z-index, a shared modal primitive (swipe-down on every modal as it migrates), migration template, ARCHITECTURE.md doc — quieter changes now that pay off forever",
        commits: ["c3e5109", "08bb022", "87c6618", "5e754cf", "fcacbd5", "e21ca56"],
      },
    ],
    coming_soon: [
      "Spice family hubs — collapse the 70+ spice ingredients into themed groups (Salts, Peppers, Chili Family, etc.) so the picker isn't overwhelming",
      "Post-hoc receipt editing — open a past receipt, fix what the scanner got wrong, fixes propagate to the pantry rows",
      "Scanner extraction from Pantry.jsx — pure refactor for maintainability, no UX change",
      "Per-component proportion slider — \"I used 30% of the salt jar\" recorded on the cook log without weighing anything",
      "Pantry → Kitchen rename — the top-level concept becomes 'Kitchen' so 'Pantry' can mean just the pantry sub-tab",
    ],
  },
];

// Helper: latest entry. Convenience for the notification renderer.
export const LATEST_RELEASE = RELEASE_NOTES[0];
