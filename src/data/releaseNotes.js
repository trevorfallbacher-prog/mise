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

export const CURRENT_VERSION = "0.7.6";

export const RELEASE_NOTES = [
  {
    version: "0.7.6",
    date:    "2026-04-17",
    title:   "Proportional inventory — how full is the jar, not just how many",
    summary:
      "For items you can't really count — bottles of olive oil, jars " +
      "of pickles, blocks of cheese, cartons of milk — a count was " +
      "never the right answer. \"1 bottle\" said nothing about whether " +
      "it was brand new or scraped-the-label empty. This ships Part B " +
      "of the proportional-inventory work that's been on the roadmap " +
      "since 0.2.0: a fill_level column on pantry_items, a tap-to-set " +
      "fraction picker on every ItemCard (⅛ ¼ ⅓ ½ ⅔ ¾ FULL), and a " +
      "small color-keyed chip on Kitchen rows when the level drops " +
      "below full. Null by default so counted items stay clean. " +
      "Opt in by tapping FILL LEVEL on an item you actually want to " +
      "track this way; ✕ UNTRACK puts it back.",
    shipped: [
      {
        kind: "architecture",
        text: "Migration 0043 adds pantry_items.fill_level (numeric 0..1, nullable, CHECK-constrained). Null = not tracked (the default for counted items); 0..1 = tracked proportion, same semantics as the CookComplete leftover picker",
        commits: ["__fill_level_0043__"],
      },
      {
        kind: "feature",
        text: "ItemCard shows a new FILL LEVEL card below QUANTITY/LOCATION/EXPIRES. Untracked rows show \"— TAP TO TRACK (bottles, jars, cartons)\". Tapping opens a fraction-chip row (EMPTY / ⅛ / ¼ / ⅓ / ½ / ⅔ / ¾ / FULL). Horizontal fill bar + fraction label render once a level is set, colored red below ¼, amber ¼–½, green above",
        commits: ["__fill_level_itemcard__"],
      },
      {
        kind: "feature",
        text: "Kitchen rows get a compact fraction chip (⅓, ½, ¾…) next to the name when a row is tracked AND below FULL. Same color thresholds as the ItemCard bar. FULL rows and untracked rows show no chip so the signal only surfaces when there's something to act on",
        commits: ["__fill_level_kitchen__"],
      },
      {
        kind: "ux",
        text: "\"✕ UNTRACK\" affordance in the ItemCard editor puts a row back to null fill so a mistaken track can be reversed without a DB trip. Counted items (eggs, cans) stay clean — the whole feature is opt-in per row",
        commits: ["__fill_level_itemcard__"],
      },
    ],
    coming_soon: [
      "Part A: per-component proportion slider on Cook — \"I used ⅓ of the olive oil bottle in this meal\" auto-decrements the source row's fill_level",
      "Low-fill reminder on Kitchen: when a tracked row crosses ¼, nudge into the shopping list",
      "Fill-level on hub aggregate displays (average across bottled items of the same hub)",
      "Expiration cancel-to-null (still blocked on a repro)",
    ],
  },
  {
    version: "0.7.5",
    date:    "2026-04-16",
    title:   "Admin build — elevated permissions, first cut",
    summary:
      "First slice of admin tooling for the app owner. A new role " +
      "column on profiles + an is_admin() SECURITY-DEFINER helper " +
      "underpins RLS-bypass SELECT policies on profiles and receipts " +
      "— admin can now see every user and every receipt across all " +
      "families for moderation + debugging. The UI surfaces as a " +
      "🛠 ADMIN TOOLS row in Settings, visible only to role='admin' " +
      "profiles. First panel has two tabs: USERS (every profile row, " +
      "role-badged) and RECEIPTS (newest 500 across all families). " +
      "Deliberately read-only in this cut — admin writes land one " +
      "screen at a time behind their own policy additions.",
    shipped: [
      {
        kind: "architecture",
        text: "Migration 0042 adds profiles.role ('user' | 'admin', default 'user' with a CHECK constraint) plus public.is_admin(uid) as a SECURITY-DEFINER helper so admin-check reads bypass the profiles RLS without recursing",
        commits: ["__admin_0042__"],
      },
      {
        kind: "feature",
        text: "Admin-SELECT bypass policies on profiles and receipts — additive, so non-admins' access stays identical. Admin INSERT/UPDATE/DELETE policies explicitly NOT added yet; bypass writes ship one table at a time alongside the screen that needs them",
        commits: ["__admin_0042__"],
      },
      {
        kind: "feature",
        text: "AdminPanel modal with USERS + RECEIPTS tabs. Users tab shows id prefix, name, role badge (admin rows highlighted red), created date, dietary, XP. Receipts tab shows store, date, item count, total, uploader prefix",
        commits: ["__admin_panel__"],
      },
      {
        kind: "ux",
        text: "Settings → ADMIN section appears only when the viewer's profile.role === 'admin'. Red accent + 🛠 glyph so it's obviously distinct from regular user tooling",
        commits: ["__admin_panel__"],
      },
    ],
    coming_soon: [
      "Admin-DELETE on receipts (for clearing mis-OCR'd duplicate rows)",
      "Admin view of pantry_items + pantry_scans across families",
      "User detail drill-down (tap a user → their kitchen, their receipts, their cook logs)",
      "Expiration cancel-to-null (still blocked on a repro)",
    ],
  },
  {
    version: "0.7.4",
    date:    "2026-04-16",
    title:   "Review it like an ItemCard — nothing baked in, everything tappable",
    summary:
      "A design pass on the scan-confirm screen, driven by the same " +
      "feedback loop: if the OCR misfires (it will), you should be " +
      "able to fix EVERY field about a row before it lands in your " +
      "kitchen. Linking an item to a canonical no longer overwrites " +
      "your display name — \"Frank's Best Cheese Dogs\" stays your " +
      "display, with \"🌭 Hot Dog IS-A\" surfacing underneath so you " +
      "see both. Tapping FOOD CATEGORY or STORED IN opens the same " +
      "pickers the AddItemModal uses, so overrides feel familiar. " +
      "Tap the emoji to pick a better one from a 35-glyph grid. The " +
      "row now reads like a preview of the ItemCard it's about to " +
      "become — nothing surprises you after STOCK. Receipts got the " +
      "same treatment: tap the store or date in ReceiptView to fix " +
      "it (any family member can), tap any item to drill into its " +
      "ItemCard without losing the receipt view underneath, and tap " +
      "the green GROCERIES THIS MONTH banner to browse every receipt " +
      "you've ever scanned, grouped by month.",
    shipped: [
      {
        kind: "fix",
        text: "Linking a scan row to a canonical no longer overwrites your display name. \"Frank's Best Cheese Dogs\" stays; the canonical surfaces as a smaller \"🌭 Hot Dog IS-A\" line under your name — same pattern ItemCard uses. Previous behavior stomped on your text on every link",
        commits: ["fbde843"],
      },
      {
        kind: "feature",
        text: "Tap the green GROCERIES THIS MONTH banner on Kitchen → new Receipt History modal lists every receipt you or your family have scanned, grouped by month with per-month totals. Tap any row to open the receipt photo + items — no more drilling in through a specific item to find a scan from last week",
        commits: ["fbde843"],
      },
      {
        kind: "feature",
        text: "Scan-row FOOD CATEGORY chip is tappable — opens TypePicker (same one AddItemModal uses). Override the OCR's guess before stocking. Suggested type from name-inference still leads the list",
        commits: ["b4e53ed"],
      },
      {
        kind: "feature",
        text: "Scan-row STORED IN chip is tappable — opens IdentifiedAsPicker. Tile placement propagates to duplicate rows with the same raw scanner read (receipt \"3 × CHOBANI\" all land in one tile after one tap). Unset shows a dashed \"+ set location\" affordance so inference gaps are visible",
        commits: ["b4e53ed"],
      },
      {
        kind: "feature",
        text: "Scan-row emoji is tappable — opens a 35-glyph food-first grid. Propagates to duplicates. OCR's 🥫 fallback no longer leaks into your Kitchen",
        commits: ["a912be2"],
      },
      {
        kind: "ux",
        text: "Scan-row name switched to Fraunces italic (same typography as ItemCard) so the row reads like the card it's about to become. Edit input matches the card's yellow-highlighted edit style",
        commits: ["ec0ad72"],
      },
      {
        kind: "feature",
        text: "Tap the store name or date on a receipt in ReceiptView to fix it inline. Any family member can correct a mis-OCR'd store — migration 0041 adds a family-update RLS policy mirroring the existing family-select. Optimistic local update with SAVING… indicator",
        commits: ["aca8e05"],
      },
      {
        kind: "ux",
        text: "Tapping an item in ReceiptView no longer closes the receipt before opening its ItemCard. ItemCard stacks on top; dismissing the card drops you back in the receipt view so you can review the next item in the list",
        commits: ["aca8e05"],
      },
      {
        kind: "architecture",
        text: "Receipt-family modals re-layered: ReceiptHistoryModal (315) → ReceiptView (318) → ItemCard (320) → LinkIngredient (340). Stacking now reflects drill depth, not modal-mount order",
        commits: ["aca8e05"],
      },
    ],
    coming_soon: [
      "Expiration cancel-to-null (still need a repro for the defaults-to-today case)",
      "Receipt total editable from ReceiptView (store + date shipped; total is next)",
      "Per-item edits from ReceiptView without stacking the full ItemCard (lighter inline edit for quick fixes)",
      "Scan-row amount and unit joined to the chip row so every field reads consistent",
    ],
  },
  {
    version: "0.7.3",
    date:    "2026-04-16",
    title:   "P0 sweep — receipts save, scans prune, bells deep-link",
    summary:
      "A bug-queue cleanup pass, not a new concept. Receipts were " +
      "silently failing to save on certain date formats — that's fixed " +
      "and now fails loudly with a toast if it ever happens again. The " +
      "scan-confirm ✕ button became destructive: one tap arms a " +
      "\"REMOVE?\" prompt, the next tap physically splices the row out " +
      "so your list shrinks as you prune batteries and M&Ms instead of " +
      "making you scroll through 50 dimmed entries. Receipt " +
      "notifications in the bell are now tappable — one tap lands " +
      "straight on the receipt photo + item list. And when a scan " +
      "bumps your monthly groceries total, the number pulses green " +
      "with a floating +$X.XX pill so you see the scan actually " +
      "register. Also: fixing one ACQUAMAR FLA row in scan-confirm now " +
      "propagates the link to every duplicate of the same raw scanner " +
      "read — no more relinking the same item twice.",
    shipped: [
      {
        kind: "fix",
        text: "Receipts save again. A stray timestamp in the scanner's date field was breaking the Postgres DATE column silently — now we validate YYYY-MM-DD before insert and toast any insert failure so it can never disappear quietly again",
        commits: ["9b31631"],
      },
      {
        kind: "ux",
        text: "Scan-confirm's ✕ button is destructive with a confirm gate. Tap ✕ → red \"REMOVE?\" pill appears → tap ✓ to splice the row out, gray ✕ to cancel. Your list shrinks as you prune — no more scrolling past dimmed rows you already rejected",
        commits: ["bec8a45"],
      },
      {
        kind: "feature",
        text: "Tap a receipt notification in the bell → ReceiptView opens directly on the photo, total, and item list. Same for fridge/pantry/freezer shelf scans. Three-tap drill-down (Kitchen → item → provenance) reduced to one",
        commits: ["6c905db"],
      },
      {
        kind: "ux",
        text: "Correction propagation on scan-confirm. Fix one ACQUAMAR FLA row (rename or relink to Imitation Crab) and every duplicate of the same raw scanner read inherits the identity — not the quantity, so \"2 × ACQUAMAR FLA\" stays two separate entries you can verify independently",
        commits: ["9b31631"],
      },
      {
        kind: "ux",
        text: "Kitchen monthly-groceries banner pulses green + floats a +$X.XX pill when your scan adds to the total. No more re-tapping STOCK wondering if it saved",
        commits: ["5c45802"],
      },
      {
        kind: "feature",
        text: "Dedup-warning notifications (\"Heads up — you already logged a $47 receipt from Trader Joe's recently\") are now tappable too — lands on the new receipt for side-by-side compare against the earlier one",
        commits: ["6c905db"],
      },
      {
        kind: "architecture",
        text: "Pantry.jsx renamed to Kitchen.jsx. Matches the tab label; domain names (pantry_items, pantry_scans) stay as-is. Migration 0040 redefines notify_family_receipt + notify_family_pantry_scan to populate target_kind/target_id on notifications",
        commits: ["837839f", "6c905db"],
      },
    ],
    coming_soon: [
      "Expiration cancel-to-null (still reproducing the defaults-to-today case)",
      "Inline corrections from ReceiptView — tap an item in the viewer and edit without leaving the modal",
      "Swipe-left-to-reject on scan rows (benched behind the tap-confirm pattern, may return as an alt gesture)",
      "Receipt store-name editing (the store OCR'd wrong? Fix it from ReceiptView)",
    ],
  },
  {
    version: "0.7.2",
    date:    "2026-04-16",
    title:   "Identity ≠ composition — four clean layers, no pollution",
    summary:
      "0.7.1 got one thing wrong: I stuffed the canonical identity " +
      "(hot_dog, green_onion, mayo) into your ingredient_ids[] array. " +
      "But your hot dog isn't AN INGREDIENT of your hot dog — it IS " +
      "the hot dog. 0.7.2 untangles this. Every pantry row now has " +
      "four clean layers: your brand name (\"Frank's Best Cheese " +
      "Dogs\"), the canonical thing (\"Hot Dog\" — USDA), the food " +
      "category (Sausages, Hot Dogs, Pizza — the grouping), and " +
      "stored-in (Meat & Poultry — physical placement). Composition " +
      "(what's INSIDE your version: cheddar + ground pork, or beef + " +
      "bun, or tofu + bun — your call, always) stays on ingredient_ids[] " +
      "free and untouched by our identity inference. Recipes still " +
      "find your custom hot dogs via the canonical bridge — now on " +
      "its own column (canonical_id) where it belongs.",
    shipped: [
      {
        kind: "feature",
        text: "New canonical_id column on pantry_items + templates (migration 0039). Holds the USDA \"final resting name\" of the thing (hot_dog, mayo, green_onion). Separate from ingredient_ids[] which stays YOUR composition — the app stops telling you what's in your hot dog",
        commits: ["__18j_canonical_id__"],
      },
      {
        kind: "feature",
        text: "Every ItemCard now shows the canonical line (🌭 Hot Dog) right under your custom name. You see your version (\"Frank's Best Cheese Dogs\") AND what kind of thing it is (\"Hot Dog\") at a glance — no drill-down",
        commits: ["__18j_canonical_id__"],
      },
      {
        kind: "feature",
        text: "AddItemModal shows a live canonical preview as you type: \"Frank's Best Cheese Dogs\" → 🌭 Hot Dog IS-A. Auto-derives from name first (name-match wins over type defaults), type-picker fallback after",
        commits: ["__18j_canonical_id__"],
      },
      {
        kind: "feature",
        text: "Recipe matcher (tileMatching.js) gets a new canonical-identity path. Recipe calls for 'hot_dog' → every row where canonical_id='hot_dog' matches exactly. Same tier as your ingredient_ids tag match; your custom branded items finally show up for recipe slots they ARE, without polluting your composition",
        commits: ["__18j_canonical_id__"],
      },
      {
        kind: "ux",
        text: "\"IDENTIFIED AS\" label renamed to \"FOOD CATEGORY\" everywhere — matches how you actually talk about it (\"Sausages is a category, hot_dog is the thing\")",
        commits: ["__18j_canonical_id__"],
      },
      {
        kind: "fix",
        text: "0.7.1's ingredient_ids[] pollution is rolled back. Upgrading family kitchens stay clean — canonical_id column is additive, no back-migration needed. Future cleanup sweep if any polluted rows linger",
        commits: ["__18j_canonical_id__"],
      },
    ],
    coming_soon: [
      "Receipt storage regression fix (P0 bug)",
      "Correction propagation: fix one ACQUAMAR FLA row in scan-confirm → the other duplicates inherit the link",
      "Expiration cancel-to-null (so we can use smart defaults instead of stamping today)",
      "Receipt viewer + family-edit flow (see the photo, fix wrong links, reopen later)",
      "Kitchen +$X pulse when scans add new stock",
    ],
  },
  {
    version: "0.7.1",
    date:    "2026-04-16",
    title:   "The canonical bridge — your brand names finally match recipe calls",
    summary:
      "The missing link. When a recipe says \"20 hot dogs\" our system now " +
      "sees your Franks Best Cheese Dogs — because IDENTIFIED AS Hot Dogs " +
      "tags the item with the canonical hot_dog behind the scenes. Same " +
      "for Mama Bear's Garden Fresh Green Onion → green_onion, your " +
      "Hellmann's → mayo, your homemade pesto → pesto. The type axis now " +
      "writes through to ingredient_ids[] so the recipe matcher's exact-" +
      "match path finds every branded/custom item you own. YOUR RECENTS " +
      "also got a long-overdue cleanup: starred items (used 2+ times) " +
      "pin to the top, the list caps at 5 idle, and a search bar tucks " +
      "the rest behind a keystroke.",
    shipped: [
      {
        kind: "feature",
        text: "Canonical bridge: ~22 WWEIA types now carry a canonicalIds mapping (Hot dogs → hot_dog, Green onions → green_onion, Mayo → mayo, Pasta → pasta, …). Picking IDENTIFIED AS on a custom item auto-tags its ingredient_ids so recipe matching finds it via exact match, same as a vanilla canonical item",
        commits: ["__18h_canonical_bridge__"],
      },
      {
        kind: "feature",
        text: "Hot dogs split out from Sausages as their own WWEIA type — \"Franks Best Cheese Dogs\" now identifies specifically as Hot dogs and carries hot_dog, not the broader sausage. Salami, chorizo, pepperoni stay under Sausages",
        commits: ["__18h_canonical_bridge__"],
      },
      {
        kind: "feature",
        text: "Green onions split out from Vegetables as their own WWEIA type — recipes calling for scallions/green onions specifically now bridge to your custom green-onion entries",
        commits: ["__18h_canonical_bridge__"],
      },
      {
        kind: "feature",
        text: "New hot_dog + green_onion canonicals added to the bundled ingredient registry. These were the most-requested recipe terms that had no canonical to bind to",
        commits: ["__18h_canonical_bridge__"],
      },
      {
        kind: "ux",
        text: "YOUR RECENTS redesign: starred items (⭐ used 2+ times) pin to the top, the idle list caps at 5 rows with a hint showing how many more are tucked away, and a search box above filters across name AND component ids (\"hot dog\" finds your Franks Best Cheese Dogs via its components)",
        commits: ["__18i_recents_ui__"],
      },
      {
        kind: "ux",
        text: "Re-picking IDENTIFIED AS on an existing item now rewrites the canonical bridge tags automatically — switching from Hot dogs to Sausages swaps hot_dog for sausage in ingredient_ids instead of accumulating both",
        commits: ["__18h_canonical_bridge__"],
      },
    ],
    coming_soon: [
      "Canonical bridge on user-created types too (family-curated \"in our house it's a sandwich\" that still matches recipes)",
      "Drill-into-type: tap IDENTIFIED AS anywhere to filter the pantry to all items of that type",
      "Type-aware recipe matcher fallback: recipe wants spaghetti, you have Cavatappi Pasta — same type, count as close match",
      "Persistent per-template starring (not just use-count-derived)",
      "Admin-promoted types: popular user-created types get blessed into the bundled set",
    ],
  },
  {
    version: "0.7.0",
    date:    "2026-04-16",
    title:   "IDENTIFIED AS + STORED IN — two axes, USDA-seeded, yours to override",
    summary:
      "Big architectural upgrade. Your kitchen now tracks what each item IS " +
      "(IDENTIFIED AS — Pizza, Cheese, Sausages, Mayo) separately from WHERE " +
      "it lives (STORED IN — Frozen Meals, Dairy, Condiments). They usually " +
      "go together but not always — Italian Blend identifies as Cheese but " +
      "might be stored in Frozen Meals. The IDENTIFIED AS catalog is seeded " +
      "from USDA's What We Eat in America food classifications (~48 types), " +
      "and you can create your own if USDA doesn't have your family's " +
      "flavor. Scan-confirm now shows both inferred placements upfront.",
    shipped: [
      {
        kind: "feature",
        text: "IDENTIFIED AS line on every item — what KIND of thing it is. Pizza, Cheese, Sausages, Mayo, Pasta. Picking a type auto-suggests where it's stored, but you can override either axis independently",
        commits: ["7d2909c", "af4f820", "f0b3051"],
      },
      {
        kind: "feature",
        text: "USDA-seeded bundled types: ~48 food categories lifted from WWEIA (What We Eat in America) classifications. When users disagree with \"is a hot dog a sandwich?\", USDA's call is the defensible default",
        commits: ["7d2909c"],
      },
      {
        kind: "feature",
        text: "Create your own family types: tap + CREATE NEW TYPE in the picker to add household-specific categories like \"Kids Snacks\", \"Dad's Weird Sauces\", \"Sunday Leftovers\" — family-shared, realtime",
        commits: ["3d63e96", "2a905fc", "4745143"],
      },
      {
        kind: "feature",
        text: "Scan-confirm auto-inference: every scanned row shows inferred IDENTIFIED AS + STORED IN chips upfront. No more clicking through 24 items to place 24 items — the system guesses, you only tap when it's wrong",
        commits: ["0dd2ec9"],
      },
      {
        kind: "feature",
        text: "Templates carry both axes now — once you set a type on your family's Home Run Inn Pizza template, every family member's future re-add inherits it automatically via 0.6.0's scan-side template matching",
        commits: ["af4f820", "0dd2ec9"],
      },
      {
        kind: "ux",
        text: "The old \"IDENTIFIED AS\" picker is renamed to \"STORED IN\" (it was always about placement, not type) — the new IDENTIFIED AS layer covers the semantic identity it was missing",
        commits: ["3d878d9"],
      },
    ],
    coming_soon: [
      "Drill-into-type: tap IDENTIFIED AS anywhere to filter the pantry to all items of that type (\"show me all my pizzas\")",
      "Type-aware recipe matcher fallback: recipe wants spaghetti, you have Cavatappi Pasta — same type, count as close match",
      "Admin-promoted types: popular user-created types across families get blessed into the bundled WWEIA-level set",
      "Per-component proportion slider",
      "Type edit/rename flow for user-created types",
    ],
  },
  {
    version: "0.6.0",
    date:    "2026-04-16",
    title:   "Your kitchen, your scans — brand names survive the scanner",
    summary:
      "The app's top-level storage concept is now called \"Kitchen\" " +
      "(the sub-tab stays \"Pantry\" — the pantry is a location inside " +
      "your kitchen). And when you scan a receipt, your family's saved " +
      "templates win over generic canonicals — \"Home Run Inn Pizza\" " +
      "stays \"Home Run Inn Pizza\" and lands on whatever tile you put " +
      "it on before, instead of collapsing to generic pizza.",
    shipped: [
      {
        kind: "feature",
        text: "Pantry → Kitchen rename at the top-level (the nav tab, the view header, \"your pantry\" → \"your kitchen\" throughout). The Pantry sub-tab inside your Kitchen stays named Pantry — it's the shelf-stable LOCATION",
        commits: ["a6f926b"],
      },
      {
        kind: "feature",
        text: "Scan-side template matching: when a receipt has \"HOME RUN INN PIZZA\" on it, we match your family's saved template first — keeping your brand name, your tile placement, your component tags. No more re-naming and re-tagging every grocery run",
        commits: ["ba88f61"],
      },
      {
        kind: "ux",
        text: "Bottom-nav icon updated from 🥫 to 🍽️ to match the broader Kitchen concept (🥫 reads specifically as pantry-shelf)",
        commits: ["a6f926b"],
      },
    ],
    coming_soon: [
      "Tile-aware substitution suggestions in CookMode — \"you have Cavatappi Pasta, recipe wants spaghetti, swap?\"",
      "Admin-promoted community tier — popular user templates + tiles get blessed into a global set",
      "Per-component proportion slider — \"I used 30% of the salt jar\" without weighing",
      "Enrichment seed pass for the new flour + pasta canonicals (descriptions, flavor profiles, substitutes)",
      "Admin dashboard for template/tile promotion workflow",
    ],
  },
  {
    version: "0.5.0",
    date:    "2026-04-16",
    title:   "IDENTIFIED AS — place anything in any tile, or make a new one",
    summary:
      "The organizational layer of the kitchen got a real upgrade. Every " +
      "item now has an IDENTIFIED AS line — the tile where it lives. " +
      "You can pick from built-ins (Pasta & Grains, Dairy, Frozen Meals, " +
      "etc.) OR create your own family-shared tile on the spot if the " +
      "built-ins don't fit your kitchen. We also expanded the pasta " +
      "registry by 14 canonicals (cavatappi, fusilli, macaroni, tortellini, " +
      "gnocchi, and more) so typing \"cavatappi pasta\" finds a real match " +
      "instead of collapsing to flour.",
    shipped: [
      {
        kind: "feature",
        text: "IDENTIFIED AS picker on every Add Item — pick a tile to place the item (Pasta & Grains, Dairy, Frozen Meals, etc.) or tap + CREATE NEW IDENTIFIED AS to invent your own category",
        commits: ["f62a17e", "ba677a3"],
      },
      {
        kind: "feature",
        text: "Family-shared custom tiles — create \"Kids Snacks\", \"Protein Powders\", \"Grandma's Spice Kit\" and the whole household sees them in their picker in realtime",
        commits: ["3afc8ab"],
      },
      {
        kind: "feature",
        text: "Smart tile suggestions: as you type the item's name, the picker highlights the most-likely tile with a ⭐ SUGGESTED treatment. 200+ keywords across 20 tiles",
        commits: ["47a8948"],
      },
      {
        kind: "feature",
        text: "14 new pasta canonicals + a generic \"Pasta\" fallback: cavatappi, fusilli, rotini, farfalle (bow-tie), elbow macaroni, bucatini, linguine, angel hair, ziti, orecchiette, tortellini, ravioli, gnocchi. Each with proper weight-to-volume for recipe math",
        commits: ["46a24a9"],
      },
      {
        kind: "ux",
        text: "ItemCard now distinguishes IDENTIFIED AS (what kind of thing is this — the tile) from MADE OF (what is it composed of — the components). Tap IDENTIFIED AS to re-pick",
        commits: ["ba677a3"],
      },
      {
        kind: "architecture",
        text: "tile_id now flows end-to-end from pick -> template -> pantry row. Recipe matcher infrastructure for tile-fallback matching (\"you have cavatappi, recipe wants spaghetti, count as close match\") landed behind a helper — UI layer coming in a future chunk",
        commits: ["af4a8b4"],
      },
    ],
    coming_soon: [
      "Scan-side template + tile matching — when a receipt has \"Home Run Inn Pizza\", match your template first AND inherit its tile_id",
      "Tile-aware substitution suggestions in CookMode — \"you have Cavatappi Pasta in your Pasta & Grains, recipe wants spaghetti, swap?\"",
      "Admin-promoted community tier — popular user tiles + templates across families get blessed into a global set",
      "Per-component proportion slider — \"I used 30% of the salt jar\" without weighing",
      "Enrichment seed pass for the new flour + pasta canonicals",
      "Pantry -> Kitchen rename",
    ],
  },
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
