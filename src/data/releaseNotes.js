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

export const CURRENT_VERSION = "0.12.5";

export const RELEASE_NOTES = [
  {
    version: "0.12.5",
    date:    "2026-04-18",
    title:   "Admin auto-approve now carries packaging through",
    summary:
      "When an admin creates a new canonical with packaging (0.12.4 " +
      "flow), the admin auto-approve path was writing a minimal " +
      "{_meta} stub to the live ingredient_info table, silently " +
      "clobbering the packaging block that had landed in " +
      "pending_ingredient_info seconds earlier. Net result: Spam " +
      "looked APPROVED on the ItemCard but the next Add Item flow " +
      "showed no PACKAGE SIZE chips. Fixed by plumbing the packaging " +
      "through onLink so the stub merges it inline on the same write.",
    shipped: [
      { kind: "fix",
        text: "Admin-created canonicals with packaging now land in ingredient_info with sizes on the first write — no manual SQL patch needed.",
        commits: [] },
    ],
    coming_soon: [
      "Scan-merge reserve bump — 3 identical SKUs → one row, reserve_count +2.",
      "blendOf linkage in the create flow — 'this is made of pork' so Spam shows up for pork recipes.",
    ],
  },
  {
    version: "0.12.4",
    date:    "2026-04-18",
    title:   "Typical packaging on canonical creation",
    summary:
      "When you add a brand-new canonical (Spam, your favorite " +
      "hot sauce, that obscure regional noodle) the create flow now " +
      "offers an optional 'typical packaging' step. Pick a category, " +
      "adjust the suggested sizes, mark one as typical, and save. " +
      "The next person to add that same canonical gets your sizes " +
      "as tappable chips in Add Item — no more 'what does 1 can " +
      "actually mean?' for future you. Fully skippable if you don't " +
      "know or don't care.",
    shipped: [
      { kind: "feature",
        text: "Packaging step in LinkIngredient's '+ CREATE' flow — category + size editor + typical marker.",
        commits: [] },
      { kind: "architecture",
        text: "Sizes save into pending_ingredient_info.info.packaging so admin review can promote them to the authoritative ingredient_info row.",
        commits: [] },
      { kind: "ux",
        text: "SKIP button preserves the old fast-path for anyone who just wants to tag an ingredient and move on.",
        commits: [] },
    ],
    coming_soon: [
      "Scan-merge reserve bump — 3 identical SKUs on one receipt collapse into one row with reserve_count +2.",
      "blendOf linkage in the create flow — 'this is made of pork' so Spam shows up for pork recipes.",
      "Tap-a-segment to 'open the next can' on pantry rows.",
    ],
  },
  {
    version: "0.12.3",
    date:    "2026-04-18",
    title:   "Segmented gauge — see your stash at a glance",
    summary:
      "The pantry gauge used to be a single bar whether you had " +
      "one can or ten. With reserves tracking, that stopped " +
      "telling the full story: a 12-oz open can half-full next to " +
      "4 sealed reserves should LOOK different from a 12-oz can " +
      "with no reserves. Now it does. Package-mode rows render one " +
      "segment per physical unit — sealed packages full green, the " +
      "open one colored by remaining ratio. One glance tells you " +
      "how many total and which one you're working through.",
    shipped: [
      { kind: "ux",
        text: "Segmented per-package gauge on pantry rows when reserves are present — one block per can/jar/bag/carton.",
        commits: [] },
      { kind: "ux",
        text: "Liquid-mode rows (no packaging) keep the original single bar — zero regression for olive oil, flour by weight, and anything else that doesn't think in discrete packages.",
        commits: [] },
    ],
    coming_soon: [
      "Tap-a-segment to 'open the next can' — explicit consumption action for when you want to skip partial accounting.",
      "Canonical creation flow with packaging — add brand-new canonicals like Spam with typical sizes in one shot.",
      "Scan-merge reserve bump — 3 identical SKUs on one receipt collapse into one row with reserve_count +2.",
    ],
  },
  {
    version: "0.12.2",
    date:    "2026-04-18",
    title:   "One-tap package sizes — no more typing \"12 oz\" every time",
    summary:
      "Added typical packaging sizes to 32 common canned, dried, " +
      "and dairy canonicals — Spam (coming via user-create), tuna, " +
      "beans, rice, pasta, flour, olive oil, milk, eggs, bread, and " +
      "more. When you pick one of these in Add Item, a PACKAGE SIZE " +
      "chip row now shows the typical can / bag / carton sizes for " +
      "that ingredient. Tap the chip and amount + unit prefill " +
      "automatically — pair it with the SEALED stepper from 0.12.0 " +
      "and you've gone from 'type 12 oz, type oz, type reserves' to " +
      "three taps total for \"5 cans of black beans.\"",
    shipped: [
      { kind: "feature",
        text: "PACKAGE SIZE chip row in Add Item — typical sizes for canned goods, dried staples, dairy, and more.",
        commits: [] },
      { kind: "architecture",
        text: "32 bundled canonicals now carry packaging metadata via ingredient_info.packaging.",
        commits: [] },
      { kind: "ux",
        text: "SEED_VERSION bumped to 9 so existing users get the new packaging rows on next app open.",
        commits: [] },
    ],
    coming_soon: [
      "Typical-packaging step on canonical creation — when you add a brand-new canonical (like Spam), pick its sizes on the spot and the next person to scan it gets them for free.",
      "Segmented gauge — visual \"5 sealed blocks + 1 open half-full\" under each pantry row.",
      "Scan-merge reserve bump — 3 identical SKUs on one receipt collapse into one row with reserve_count +2.",
      "blendOf linkage — Spam → pork so the AI considers it for pork recipes.",
    ],
  },
  {
    version: "0.12.1",
    date:    "2026-04-18",
    title:   "Push notifications — mise reaches you even when closed",
    summary:
      "Until now, browser-level notifications only fired when the " +
      "mise tab was already open in the background. Close the tab " +
      "and nothing reached you; open it on a different device and " +
      "you missed the ping. This release adds proper Web Push: " +
      "family pantry edits, scheduled meals, cook-log reviews, and " +
      "badge earns arrive as OS notifications regardless of whether " +
      "mise is open, closed, or on another device entirely. Opt in " +
      "from Settings → Notifications on this device. Private per " +
      "device, not per family — each browser / phone subscribes " +
      "independently and can be turned off without affecting your " +
      "other devices.",
    shipped: [
      { kind: "feature",
        text: "Web Push enablement in Settings — one tap to subscribe, one tap to stop. No startup prompt; opt-in only.",
        commits: [] },
      { kind: "feature",
        text: "Every existing notification source (pantry edits, scheduled meals, cook logs, cook reviews, receipts, pantry scans, badges) now reaches subscribed devices.",
        commits: [] },
      { kind: "ux",
        text: "Tapping a push when mise is open focuses the tab and routes to the deep-link (the receipt, the cook, the profile). When mise is closed, a new tab opens directly on the target.",
        commits: [] },
      { kind: "architecture",
        text: "New send-push Supabase Edge Function signs pushes with VAPID and prunes dead endpoints (404/410) automatically.",
        commits: [] },
      { kind: "safety",
        text: "push_subscriptions rows are private per-user — family members never see each other's device list.",
        commits: [] },
    ],
    coming_soon: [
      "Per-kind mutes (only push cook reviews, mute the rest).",
      "Quiet hours so the family calendar doesn't wake you at 2am.",
      "Badge count on the app icon for at-a-glance unread.",
    ],
  },
  {
    version: "0.12.0",
    date:    "2026-04-18",
    title:   "Sealed reserves — track every can + package in the cupboard",
    summary:
      "Adding six cans of Spam used to force a weird guess: is " +
      "\"amount\" one can? total ounces? The gauge was built for " +
      "olive oil in a bottle, not discrete packages in a cupboard. " +
      "This release adds a two-tier model. The amount field is " +
      "now the CURRENTLY-OPEN package; a tiny + / − stepper next " +
      "to it tracks SEALED reserves waiting behind it. Cook " +
      "through the open can and the pantry pops the next reserve " +
      "automatically instead of deleting the row. Works for every " +
      "canned good and most dried staples — rice, pasta, canned " +
      "tomato, beans, the whole cupboard.",
    shipped: [
      { kind: "feature",
        text: "Sealed-reserve stepper on the Add Item modal — enter one open package + how many more are sealed in the cupboard.",
        commits: [] },
      { kind: "feature",
        text: "ItemCard shows your reserves under the open-unit amount (\"12 oz / 4 sealed\").",
        commits: [] },
      { kind: "ux",
        text: "Cooking through an open package now pops the next sealed reserve automatically — the row survives, the gauge resets to a full package.",
        commits: [] },
      { kind: "architecture",
        text: "Migration 0054 adds package_amount, package_unit, and reserve_count columns to pantry_items. Rows without package data behave exactly as before.",
        commits: [] },
    ],
    coming_soon: [
      "Canonical-level packaging sizes — when someone creates a new canonical (Spam, canned tuna), future users pick from the typical package sizes instead of re-entering.",
      "Segmented gauge — a block-per-package visual so you can see \"5 sealed + 1 open half-full\" at a glance.",
      "Auto-restock on last-reserve-popped — shopping-list integration that recognises \"I just opened my last can of X.\"",
    ],
  },
  {
    version: "0.11.2",
    date:    "2026-04-17",
    title:   "Smarter AI recipes — and \"why I picked this\"",
    summary:
      "The AI draft used to see only your pantry's names and " +
      "categories, which is why the recipes felt a bit generic. " +
      "This update gives Claude a much richer picture: what's about " +
      "to expire, how each item pairs with others (via the canonical " +
      "library), your dietary preferences and cooking level, and a " +
      "short summary of recent cooks (ratings + cuisines). The " +
      "result: drafts that prioritize food before it spoils, respect " +
      "vegetarian / vegan, and lean into what you've been nailing. " +
      "And every draft now comes with a \"Why this dish\" banner — " +
      "Claude writes 1–3 sentences explaining the signals it used, " +
      "so the AI doesn't feel like a black box.",
    shipped: [
      { kind: "feature",
        text: "\"Why this dish\" rationale on every AI draft — Claude cites expiring items, your dietary preferences, recent cuisines, and cooking level.",
        commits: [] },
      { kind: "feature",
        text: "AI now sees expiration dates and prioritizes dishes that use food before it spoils.",
        commits: [] },
      { kind: "feature",
        text: "Dietary flags from ingredient enrichment + your profile are respected — the AI won't propose meat to a vegetarian even if something meaty is in the family pantry.",
        commits: [] },
      { kind: "feature",
        text: "Recent cook history (ratings + top cuisines) feeds the draft so the AI learns what you cook well and leans into those lanes.",
        commits: [] },
      { kind: "ux",
        text: "REGEN uses a leaner context than the first draft so the second suggestion doesn't re-anchor on the same flavor pairings — keeps variety high.",
        commits: [] },
      { kind: "safety",
        text: "User-entered strings (item names, recipe titles) are sanitized before entering the AI prompt. Defensive against the odd edge case; doesn't change what you see.",
        commits: [] },
    ],
    coming_soon: [
      "Family-pantry-aware drafts (recipes that use what's in the shared fridge specifically).",
      "Edit an AI draft in place before saving — tweak an ingredient or a step without regenerating.",
      "Inline image generation for drafted recipes.",
    ],
  },
  {
    version: "0.11.1",
    date:    "2026-04-17",
    title:   "Save, schedule, and recall your recipes",
    summary:
      "Quick Cook got three jobs-to-be-done we punted on in 0.11.0: " +
      "saving a recipe without cooking it right away, scheduling a " +
      "recipe straight to your calendar, and finding a recipe you " +
      "made earlier. The AI preview and the custom builder now show " +
      "SAVE, 📅 SCHEDULE, and COOK IT as separate actions. Your " +
      "saved recipes show up in Quick Cook → Pick a Recipe under " +
      "YOUR RECIPES (custom) and AI DRAFTS, each tagged so you can " +
      "tell them apart from the bundled templates at a glance. " +
      "Recipes are private to you by default — opt in to share with " +
      "family via a toggle on the custom builder, and scheduling a " +
      "recipe auto-shares it so the family calendar actually works. " +
      "Custom recipes you're proud of can also be submitted for admin " +
      "review so they might get promoted into the built-in library.",
    shipped: [
      { kind: "feature",
        text: "SAVE button on AI and custom recipes — persist without entering CookMode.",
        commits: [] },
      { kind: "feature",
        text: "📅 SCHEDULE button — saves the recipe and drops it onto the calendar in one flow.",
        commits: [] },
      { kind: "feature",
        text: "Quick Cook → Pick a Recipe now lists YOUR RECIPES + AI DRAFTS + bundled templates, tagged and searchable.",
        commits: [] },
      { kind: "safety",
        text: "User recipes are private to you by default; family only sees them if you opt in. Scheduling a recipe auto-shares it since the calendar is family-visible.",
        commits: [] },
      { kind: "feature",
        text: "Submit to admin — check a box on the custom builder to queue a recipe for review; admins can approve promising ones for future inclusion in the built-in library.",
        commits: [] },
      { kind: "architecture",
        text: "findRecipe() now resolves user-authored slugs in the calendar and cookbook surfaces so custom/AI meals render correctly everywhere.",
        commits: [] },
    ],
    coming_soon: [
      "Library edit — change an existing saved recipe without re-creating it.",
      "Promote-to-bundled — admin one-click path from the review queue into the built-in library.",
      "Share with a specific family member (not just the whole family).",
    ],
  },
  {
    version: "0.11.0",
    date:    "2026-04-17",
    title:   "Quick Cook — make it, brainstorm it, or follow a template",
    summary:
      "Nav got a rethink. Starting a cook used to mean walking the COOK " +
      "tab's template list; there was no way to save your own recipe and " +
      "no way to ask Claude to draft one against your pantry. This " +
      "release puts a raised ➕ QUICK COOK button in the middle of the " +
      "tab bar that opens a three-way chooser: write your own recipe, " +
      "have Claude draft one from what's on your shelves, or pick a " +
      "template. Custom and AI recipes save to your own library so you " +
      "can cook them again. COOKBOOK stopped being a tab — the full " +
      "archive now lives inside your profile behind VIEW FULL COOKBOOK. " +
      "The old COOK tab's skill-tree content graduated into its own " +
      "COURSES tab, and PLAN was renamed CALENDAR since that's what it " +
      "actually is.",
    shipped: [
      { kind: "feature",
        text: "Floating ➕ QUICK COOK button opens a chooser for Custom / AI / Template recipes.",
        commits: [] },
      { kind: "feature",
        text: "Write your own recipes — multi-step builder with title, timing, ingredients, and steps. Saves so you can cook them again.",
        commits: [] },
      { kind: "feature",
        text: "AI recipes from your pantry — Claude drafts a recipe against what's actually on your shelves, with cuisine/time/difficulty nudges and a notes field.",
        commits: [] },
      { kind: "ux",
        text: "New tab bar: HOME · COURSES · ➕ · CALENDAR · KITCHEN. PLAN was renamed CALENDAR.",
        commits: [] },
      { kind: "ux",
        text: "COURSES tab surfaces the skill-tree progression that used to be buried in COOK → LEARN.",
        commits: [] },
      { kind: "ux",
        text: "Full cookbook moved inside your profile — RECENT COOKS has a VIEW FULL COOKBOOK link that opens the searchable archive right where your stats live.",
        commits: [] },
      { kind: "architecture",
        text: "New user_recipes table (migration 0051) with family-shared RLS and realtime sync, so recipes you or your family create show up on every device.",
        commits: [] },
    ],
    coming_soon: [
      "Edit-in-place for AI recipes so you can tweak a draft without re-running the generator.",
      "Empty-state illustrations on COURSES and the cookbook archive for first-time users.",
      "Press-scale animation on the floating ➕ button.",
    ],
  },
  {
    version: "0.10.0",
    date:    "2026-04-17",
    title:   "Receipt scan honesty + canonical plumbing overhaul",
    summary:
      "Big pass on the two things that were costing you trust: (1) the " +
      "scanner was inventing words that weren't on your receipt, and " +
      "(2) user-created canonicals were drifting between the write and " +
      "read paths so metadata wouldn't stick. Raw text is now the " +
      "source of truth on scan — Claude only rewrites the name when " +
      "it's highly confident, and a ↺ RAW button sits next to any row " +
      "where it did so you can revert to what's literally on the " +
      "receipt. Canonicals got a proper lifecycle: admins auto-approve " +
      "on create (no PENDING for you), user-approved canonicals surface " +
      "in the ingredient picker family-wide, and admin RENAME rewires " +
      "every pantry row stamped with the old slug. Plus: clean delete " +
      "flow on receipts, two migrations to unblock photos + admin " +
      "cleanup, and a version marker so you know what you're running.",
    shipped: [
      { kind: "fix",
        text: "Scan 'raw text is sacred' rewrite. Claude returns both the literal receipt text AND a display name; when confidence is below high it sets them equal so no hallucinated expansions slip through.",
        commits: ["f0de69b"] },
      { kind: "ux",
        text: "↺ RAW chip next to any scan row name that differs from the receipt. One tap restores the receipt text and propagates to sibling rows.",
        commits: ["f0de69b"] },
      { kind: "fix",
        text: "Auto-link threshold lowered 90 → 70 and now pools admin-approved canonicals alongside the bundled registry. Substring + token-overlap matches pre-pair without a tap, and a pepperoni approved once can auto-link every future scan.",
        commits: ["4870d0c", "__auto_link_synthetics__"] },
      { kind: "fix",
        text: "Scan CANONICAL axis is single-pick. The chip opens LinkIngredient in single mode so one tap commits. Multi-tag composition stays multi.",
        commits: ["4910b50"] },
      { kind: "fix",
        text: "PENDING state on scan CANONICAL chip. User-created slugs render with a ✨ + 'PENDING' badge instead of falling back to unset. Hidden for admins.",
        commits: ["bb735c8"] },
      { kind: "feature",
        text: "Admin auto-approves own canonical creations. Scan, AddItemModal, or ItemCard '+ CREATE' upserts an ingredient_info stub so the PENDING badge never shows to the admin.",
        commits: ["114d482"] },
      { kind: "fix",
        text: "Admin-approved canonicals appear in the tag picker family-wide. LinkIngredient merges synthetics from ingredient_info into its fuzzy match list.",
        commits: ["2f60d3d"] },
      { kind: "fix",
        text: "Enrichment key drift eliminated. EnrichmentButton stamps canonical_id on the pantry row before firing so pending + pantry agree on the slug. Admin rename during approval rewires every matching row.",
        commits: ["0568fbe"] },
      { kind: "feature",
        text: "AddItemModal gets a tappable CANONICAL tap line (tan) between NAME and FOOD CATEGORY. Shows the auto-derived canonical dimmed with · AUTO until explicitly locked.",
        commits: ["58ddf9d"] },
      { kind: "ux",
        text: "Identity-stack order is now a universal rule (CLAUDE.md). NAME → CANONICAL → CATEGORY → STORED IN → STATE → INGREDIENTS, same order in every entry point. STATE moved from blue to muted purple to stop colliding with STORED IN.",
        commits: ["0382129"] },
      { kind: "ux",
        text: "INGREDIENT → INGREDIENTS (plural) across ItemCard and AddItemModal.",
        commits: ["8ad7007"] },
      { kind: "fix",
        text: "Receipt delete: inline 'Keep the receipt' / 'Delete forever' flow replaces the browser popup. Full cascade — pantry items linked to the receipt, the storage photo, and the receipt row all go together.",
        commits: ["7d00441", "d00b2ac"] },
      { kind: "feature",
        text: "Admin RECEIPTS tab gets DELETE on every row with the same cascade. Admins can clean up broken scans so families can re-scan.",
        commits: ["a07daa5"] },
      { kind: "feature",
        text: "Admin CANONICALS tab gets RENAME on bundled canonicals (writes an info.display_name override). APPROVE/REJECT still custom-only.",
        commits: ["efb71a4"] },
      { kind: "architecture",
        text: "Migration 0048 creates the 'scans' Storage bucket in SQL. Unblocks receipt + shelf-scan photo uploads that were failing with 'bucket not found'.",
        commits: ["2262a5c"] },
      { kind: "architecture",
        text: "Migration 0049 adds admin-delete policies on receipts, pantry_items, pantry_scans, and storage.objects. 0042 gave admins SELECT bypass; 0049 extends to DELETE on the scan-artifact surface.",
        commits: ["a07daa5"] },
      { kind: "fix",
        text: "YOUR CIRCLE feed no longer flashes 'Quiet around here' on first load while relationships are still resolving. Loading state is held until the family list settles.",
        commits: ["6376709"] },
      { kind: "fix",
        text: "scan-receipt max_tokens bumped 2000 → 4000. Longer receipts (25+ items) stop truncating mid-JSON, which surfaced as 'edge function returned non-2xx'.",
        commits: ["fdd2446"] },
      { kind: "ux",
        text: "Duplicate INGREDIENT [+] separator at the bottom of AddItemModal removed — the tap line in the identity stack is the one entry point.",
        commits: ["c4a8bae"] },
    ],
    coming_soon: [
      "Soft-delete on receipts with an undo grace window",
      "Admin-enrich: canonical create also queues an AI enrichment so metadata lands without a second tap",
      "Revert-raw extended to the ItemCard so edits made after save can still restore the receipt text",
    ],
  },
  {
    version: "0.9.2",
    date:    "2026-04-17",
    title:   "LinkIngredient: ⭐ star + top-3 likely + search",
    summary:
      "The canonical-link picker (tap 🔗 LINK on a scan row) got the " +
      "same star-first rewrite as IDENTIFIED AS and STORED IN. The " +
      "single best canonical match is pinned at the top as the ⭐ " +
      "one-tap default, the next 3 most-likely matches sit directly " +
      "below it (strictly high-to-low by score — no more random " +
      "ordering), and the rest of the registry stays behind a search " +
      "bar. SELECTED accumulator and BLEND PRESETS keep working the " +
      "same way.",
    shipped: [
      { kind: "ux",
        text: "LinkIngredient: ⭐ star pinned at top shows the highest-scoring match as the one-tap default.",
        commits: [] },
      { kind: "ux",
        text: "Top 3 LIKELY matches below the star, sorted strictly descending by match score. No more EXACT below WEAK.",
        commits: [] },
      { kind: "ux",
        text: "Search bar replaces the full-registry dump. Results only render on demand, dedup'd against star/likely so no duplicate rows.",
        commits: [] },
    ],
  },
  {
    version: "0.9.1",
    date:    "2026-04-17",
    title:   "Pick fridge / pantry / freezer at scan time",
    summary:
      "Strawberries you're buying to freeze right away? You no longer " +
      "have to let them land in the pantry and shuffle them over later. " +
      "The STORED IN picker now opens with fridge / pantry / freezer " +
      "pills at the top. Tap the one you want and a JUST USE ❄️ FREEZER " +
      "shortcut appears — one more tap and the row commits with the new " +
      "location, no need to pick a specific shelf. The scan-row chip " +
      "also now shows the destination emoji (🧊/🥫/❄️) at a glance, so " +
      "you can see every row's fate without opening anything.",
    shipped: [
      { kind: "ux",
        text: "Location pills at the top of STORED IN picker. Tap FRIDGE / PANTRY / FREEZER to switch — the star, catalog, and search refilter instantly to that location's shelves.",
        commits: [] },
      { kind: "ux",
        text: "JUST USE ❄️ FREEZER one-tap shortcut. Commits the location change without forcing a specific shelf pick — the heuristic router places it at render time.",
        commits: [] },
      { kind: "ux",
        text: "Scan-confirm row chips now show the destination location emoji (🧊 FRIDGE / 🥫 PANTRY / ❄️ FREEZER) so you can see where every row is heading before you hit STOCK MY PANTRY.",
        commits: [] },
      { kind: "fix",
        text: "addScannedItems now forwards the scan row's explicit location to the pantry_items row. Previously a manual location override got dropped on insert and the row fell through to the category-default location.",
        commits: [] },
    ],
  },
  {
    version: "0.9.0",
    date:    "2026-04-17",
    title:   "⭐ Star-first pickers + scan-text memory",
    summary:
      "Two linked changes to the scan-confirm flow. First, the IDENTIFIED " +
      "AS and STORED IN pickers stopped vomiting the whole WWEIA taxonomy " +
      "(and every tile) at you every time. The ⭐ best guess is pinned at " +
      "the top, CREATE NEW sits right below it, and the rest of the catalog " +
      "hides behind a search bar — no more scrolling 50 rows to add your " +
      "own type. Second, the scanner now remembers your corrections. Relink " +
      "'AQUAMARINE SL' to Imitation Crab once; next scan of that same text " +
      "lands pre-filled with a ⭐ LEARNED badge. Works family-wide — if your " +
      "spouse teaches it 'BURR BALLS → Burrata', you get the benefit too.",
    shipped: [
      { kind: "ux",
        text: "TypePicker: ⭐ star suggestion pinned at top, search bar for the rest. CREATE NEW TYPE is up top, not buried.",
        commits: [] },
      { kind: "ux",
        text: "STORED IN picker: same star-first rewrite, plus a CLEAR · AUTO-ROUTE BY INGREDIENT button on existing items so you can remove a tile assignment entirely.",
        commits: [] },
      { kind: "feature",
        text: "Scan-text memory. Every correction you make on a scan row (rename, relink, change type/canonical, swap emoji) gets remembered against the raw OCR text. Next scan of that same text auto-fills with a ⭐ LEARNED badge.",
        commits: [] },
      { kind: "feature",
        text: "Family-shared corrections: anyone in your household teaches the system once, everyone benefits forever.",
        commits: [] },
      { kind: "architecture",
        text: "New table user_scan_corrections (migration 0046). Keyed on normalized raw_text per user, family-scoped by RLS.",
        commits: [] },
    ],
  },
  {
    version: "0.8.3",
    date:    "2026-04-17",
    title:   "Pantry-scan images come back — missing UPDATE policy fixed",
    summary:
      "Every shelf scan since 0032 has been silently losing its image " +
      "pointer. The JPG uploaded fine to the 'scans' Storage bucket, " +
      "but the follow-up `UPDATE pantry_scans SET image_path = ...` " +
      "hit an RLS wall: we added select/insert/delete policies in 0032 " +
      "and forgot UPDATE entirely. Postgres/Supabase treat a policy-less " +
      "UPDATE as \"zero rows matched\" — no error thrown, just a silent " +
      "no-op. So ReceiptView always saw image_path=null and rendered " +
      "\"No image on file\" for every fridge/pantry/freezer scan even " +
      "though the photo was sitting in Storage the whole time. Receipts " +
      "never had this bug because 0006 stamped self-update from day one. " +
      "Migration 0045 adds the missing policy. Recovery SQL below re-" +
      "links orphaned scans to their Storage objects so old scans come " +
      "back too — including Bella's Gummy Bear if the file survived.",
    shipped: [
      {
        kind: "fix",
        text: "Migration 0045 adds pantry_scans: family-update — the RLS policy that was missing from 0032. Every future shelf scan now persists its image_path after the Storage upload and renders correctly in ReceiptView. Symmetric with receipts (family-editable since 0041)",
        commits: ["__pantry_scans_update__"],
      },
      {
        kind: "safety",
        text: "Recovery query in 0045's docstring — re-links any existing pantry_scans row where image_path is null but a matching file exists in the 'scans' bucket. Non-destructive: only sets image_path where there's a real object, leaves scans that genuinely had no upload untouched",
        commits: ["__pantry_scans_update__"],
      },
      {
        kind: "safety",
        text: "Scan upload path now surfaces failures via toast instead of console.warn-and-forget. Storage upload errors, image_path update errors, AND zero-rows-affected (the exact silent-fail trap that lost Bella's photo) all push a visible warning so the next missing image gets noticed inside of a second, not months",
        commits: ["__scan_upload_toasts__"],
      },
    ],
    coming_soon: [
      "Tap-to-protect UI for keepsake pantry rows",
      "Family-delete for receipts",
    ],
  },
  {
    version: "0.8.2",
    date:    "2026-04-17",
    title:   "Keepsake pantry rows — Bella's Gummy Bear stays forever",
    summary:
      "Some things in the pantry aren't food. Bella's Gummy Bear — the " +
      "one my daughter saved for me — is an inventory row because that's " +
      "where we scanned it, but it shouldn't be tappable-to-delete, and " +
      "it shouldn't get consumed on the next cook that claims a gummy " +
      "bear. Added a `protected` flag per row: delete policy blocks " +
      "DELETE on protected rows at the DB, the Kitchen ✕ swaps to a " +
      "🔒 badge, and the cook decrement path skips protected rows so " +
      "an innocent recipe never zeroes out a keepsake. Protection is " +
      "set via a one-line SQL bootstrap — no client UI for toggling " +
      "the flag yet (deliberate: keepsakes are rare, and requiring DB " +
      "access to mark one keeps the surface area tight).",
    shipped: [
      {
        kind: "feature",
        text: "pantry_items.protected column (0044). Default false on every row — no existing item changes behavior. Delete policy rebuilt to require `protected = false` before a DELETE can land, so even a buggy client can't remove a protected row. Update policy unchanged: name, amount, emoji, location, etc. are still editable",
        commits: ["__protected_row__"],
      },
      {
        kind: "ux",
        text: "Kitchen tile hides the ✕ on protected rows and shows a small 🔒 in its place. Tapping the tile still opens ItemCard for viewing; only the destructive control is swapped out. The delete-confirm sheet never appears for protected rows because its entry point is gone",
        commits: ["__protected_row__"],
      },
      {
        kind: "safety",
        text: "CookComplete skips protected rows entirely in the decrement loop. If a recipe would have zeroed out Bella's Gummy Bear (or any other keepsake), the row stays untouched — no delete, no amount reduction. Belt-and-suspenders with the DB policy",
        commits: ["__protected_row__"],
      },
    ],
    coming_soon: [
      "Tap-to-protect UI on ItemCard so the flag isn't DB-only (deferred until we know it's needed more than once a year)",
      "Admin panel surface for viewing / un-protecting rows",
      "Family-delete for receipts",
      "Expiration cancel-to-null (still blocked on a repro)",
    ],
  },
  {
    version: "0.8.1",
    date:    "2026-04-17",
    title:   "Hotfix — expiration crash, delete receipts, tighter badges",
    summary:
      "Three-line hotfix on top of 0.8.0. Tapping a wrap-up (cheese, " +
      "bread, etc.) crashed with \"DAYS_MS is not defined\" because " +
      "the constant was pulled into pantryFormat.js during refactor but " +
      "Kitchen.jsx still referenced it locally — now imported properly. " +
      "Receipts grew a tap-to-delete action at the bottom of the " +
      "ReceiptView sheet (owner-only per policy; related pantry rows " +
      "stay, only the scan artifact + photo are removed). Badge grid " +
      "gap tightened 10→6 and per-cell padding 6→3 so the icons read " +
      "bigger without changing column count.",
    shipped: [
      {
        kind: "fix",
        text: "Kitchen renderHubCard no longer crashes when opening a wrap-up hub (cheese, bread, any aggregated ingredient family). expirationPct called a local DAYS_MS that had been promoted to pantryFormat.js — imported explicitly now, so the meter renders correctly",
        commits: ["__hotfix_days_ms__"],
      },
      {
        kind: "feature",
        text: "ReceiptView gained a DELETE RECEIPT / DELETE SHELF SCAN action at the bottom of the sheet. Confirm prompt notes that linked pantry rows stay — only the scan record + photo are removed. RLS still enforces owner-only delete (0041 kept family-update but not family-delete), so non-owners get a surfaced error rather than silent failure",
        commits: ["__receipt_delete__"],
      },
      {
        kind: "ux",
        text: "Badge grid on UserProfile tightened — gap 10→6, cell padding 6→3, icon fills 94% (was 80%). Icons now read meaningfully at a glance instead of feeling like stickers on a foam board",
        commits: ["__badge_spacing__"],
      },
      {
        kind: "fix",
        text: "idiot-sandwich.svg landed in public/badges/ and was renamed from Idiot-Sandwich.svg to match the lowercase path migration 0024 stamped into the badges table. Ramsay's easter-egg badge now renders instead of falling back to 🏅",
        commits: ["__idiot_sandwich_svg__"],
      },
    ],
    coming_soon: [
      "Family-delete for receipts (currently owner-only) once we decide the right guardrail for accidental mass delete",
      "Expiration cancel-to-null (still blocked on a repro)",
    ],
  },
  {
    version: "0.8.0",
    date:    "2026-04-17",
    title:   "Plan tab extends backwards — a week in review, not just a week ahead",
    summary:
      "The Plan tab used to be future-only — today plus 14 days of " +
      "scheduled meals. Nothing reminded you what your family actually " +
      "cooked last week. Now the same timeline extends 7 days into the " +
      "past: scroll up to see every cook your family logged since last " +
      "Thursday, in chronological order, with chef attribution and " +
      "cook-time. Tap a past cook → its full detail in Cookbook. The " +
      "view auto-lands on TODAY when you open the tab so scheduling " +
      "forward stays the default, and past-day cards dim + drop their " +
      "+ ADD / REQUEST buttons since planning backwards is a " +
      "category error.",
    shipped: [
      {
        kind: "feature",
        text: "Plan tab now renders 21 days: 7 past + today + 14 future. Past days show completed cook_logs (family-scoped per the 0013 RLS policy — your cooks + family's + any meal you were a diner on) rather than scheduled meals. Past-day cards use a dimmer background + lose the + ADD / REQUEST buttons so planning backwards isn't a tempting misclick",
        commits: ["__plan_past_week__"],
      },
      {
        kind: "feature",
        text: "Past cook cards render emoji + title + \"✓ COOKED\" badge + timestamp + chef name (or YOU) + diner count. Green-tinted background distinguishes them from grey \"missed planning\" cards for past days where a scheduled meal never became a cook",
        commits: ["__plan_past_week__"],
      },
      {
        kind: "feature",
        text: "Tap a past cook → opens that cook's detail in Cookbook via the existing deep-link path (same one UserProfile uses). Cross-tab navigation reuses the openCook callback so the cook detail stays the single source of truth",
        commits: ["__plan_past_week__"],
      },
      {
        kind: "ux",
        text: "Tab auto-scrolls to TODAY on first paint — with 7 past days above, the default scroll-top would have landed on a week ago, which is the wrong anchor for a tab whose primary job is \"what's on the board now?\". scrollIntoView runs once via a ref latch",
        commits: ["__plan_past_week__"],
      },
      {
        kind: "ux",
        text: "YESTERDAY label replaces the generic weekday short for -1 day, mirroring the TOMORROW label that already existed for +1. Makes the \"last night's dinner\" row pop visually",
        commits: ["__plan_past_week__"],
      },
      {
        kind: "architecture",
        text: "Past cooks loaded inline in Plan.jsx via a useEffect-gated supabase query on cook_logs filtered by cooked_at window. No new hook — the surface is narrow (one component, one date range) and duplicating useCookLog's realtime subscription across the Plan tab would have been wasted overhead",
        commits: ["__plan_past_week__"],
      },
    ],
    coming_soon: [
      "Realtime for past-cook arrivals (a family cook landing while you're on Plan tab)",
      "Month view — zoom out from the week-strip for a grid overview",
      "Cook-log backdating: complete a cook today but mark it as last night's dinner when the app was offline",
      "Expiration cancel-to-null (still blocked on a repro)",
    ],
  },
  {
    version: "0.7.9",
    date:    "2026-04-17",
    title:   "One amount, one slider — fill_level walked back",
    summary:
      "0.7.6–0.7.8 built a parallel fill_level concept alongside " +
      "amount, then layered chips, sliders, and mode toggles on top. " +
      "The right simplification (caught by you): amount already has " +
      "a max (the row's high-water mark, tracked on every add) and " +
      "the Kitchen amount bar already uses it. Drop fill_level; " +
      "a single slider drives amount directly, range 0..max. Half a " +
      "bag of chips eaten — slide the bar to where it looks, amount " +
      "updates, everyone moves on. No separate tracking concept, no " +
      "fractions, no ⅛/¼/⅓ chips.",
    shipped: [
      {
        kind: "architecture",
        text: "usePantry stops reading/writing pantry_items.fill_level. The 0043 column stays in the DB dormant so there's no write-time risk on mixed-version clients; a later migration can DROP COLUMN once it's been dead long enough",
        commits: ["__pull_fill_level__"],
      },
      {
        kind: "ux",
        text: "ItemCard: FILL LEVEL card removed. QUANTITY card gains a range slider under the amount+unit input, range 0..max (high-water amount), color-keyed accent (red ≤¼, amber ≤½, green above). Drag writes amount live through onUpdate",
        commits: ["__item_card_slider__"],
      },
      {
        kind: "ux",
        text: "Kitchen row: fill chip removed. The amount bar becomes a <button> — tap to expand an inline amount slider with a current/max readout and ✕ to close. Drag = live amount update + bar color tracks",
        commits: ["__kitchen_row_slider__"],
      },
      {
        kind: "ux",
        text: "Cook used-items: fraction chip picker (⅛ ¼ ⅓ ½ ⅔ ¾ ALL) removed. Each ingredient card keeps its amount+unit input and gains a slider below with range 0..source.amount. Slide to estimate — you used about that much. Mode toggle gone, only one measurement at a time",
        commits: ["__cook_used_slider__"],
      },
      {
        kind: "ux",
        text: "Cook confirm-removal: FINE-TUNE slider (was only on fraction entries) removed. Cards return to the single-row layout since every entry is now amount-mode — one source of truth. The used-items slider already lets you fine-tune before hitting REMOVE",
        commits: ["__cook_confirm_simplify__"],
      },
      {
        kind: "architecture",
        text: "buildRemovalPlan loses the mode discriminator + fraction branch. Back to one pathway: amount-in, amount-out, unit-convertible-or-not. Save loop re-collapsed to the historical shape",
        commits: ["__removal_plan_simplify__"],
      },
    ],
    coming_soon: [
      "Dropping pantry_items.fill_level column via migration once the dormant field has stabilized across clients",
      "Amount slider on AddItem + Scan rows (estimate starting amount when stocking from a gift or half-used donation)",
      "Expiration cancel-to-null (still blocked on a repro)",
    ],
  },
  {
    version: "0.7.8",
    date:    "2026-04-17",
    title:   "Drag-to-set fill level — slider in Kitchen, ItemCard, and post-cook",
    summary:
      "The chip picker (⅛ ¼ ⅓ ½ ⅔ ¾ FULL) is fine for common stops, " +
      "but a bottle is rarely exactly ⅓ full — it's more like 42%. " +
      "This ships a continuous drag slider in the three places the " +
      "chips already live: the ItemCard FILL LEVEL editor (primary, " +
      "precision pick), the Kitchen row fill chip (tap to expand an " +
      "inline slider under the row — no ItemCard drill needed for a " +
      "quick adjustment), and the post-cook confirm-removal screen " +
      "(fine-tune where the fraction decrement lands before saving). " +
      "Chips stay on every surface as quick-picks — the slider is " +
      "additive precision, not a replacement.",
    shipped: [
      {
        kind: "feature",
        text: "ItemCard FILL LEVEL editor gets a <input type=\"range\"> at the top of the edit block. Color-keyed accent (red ≤¼, amber ≤½, green above) matches the bar. Chips stay below as quick-picks for common stops",
        commits: ["__fill_slider_itemcard__"],
      },
      {
        kind: "feature",
        text: "Kitchen row fill chip is now a button — tap expands an inline slider + shortcut chips (EMPTY / ¼ / ½ / ¾ / FULL / ✕) under the row. Live onChange so the chip + bar colors update as you drag. Tap ✕ or the chip again to close",
        commits: ["__fill_slider_kitchen__"],
      },
      {
        kind: "feature",
        text: "Post-cook confirm-removal screen shows a FINE-TUNE slider (0–100%) under every fraction-mode entry. Writes back through the matching used-items row so the resulting LEAVES-LEFT readout recomputes on drag. Lets you commit 42% instead of ⅓ or ½",
        commits: ["__fill_slider_cook__"],
      },
    ],
    coming_soon: [
      "Visual bottle/jar silhouettes that fill proportionally to fill_level (SVG iconography path)",
      "Fraction mode on AddItem + Scan rows (stock a new half-used bottle from a gift)",
      "Expiration cancel-to-null (still blocked on a repro)",
    ],
  },
  {
    version: "0.7.7",
    date:    "2026-04-17",
    title:   "Cook it by feel — \"I used ⅓ of the bottle\" decrements the fill",
    summary:
      "Part A of the proportional-inventory pair, closing the six-" +
      "version \"per-component proportion slider\" backlog. When you " +
      "cook a recipe and the ingredient's source pantry row is " +
      "fill-tracked (bottles, jars, blocks), each used-item card " +
      "gets a row of fraction chips — ⅛ ¼ ⅓ ½ ⅔ ¾ ALL. Picking one " +
      "measures by feel instead of making you convert tablespoons: " +
      "the source row's fill_level decrements multiplicatively (half " +
      "a half-full bottle = quarter left) and the confirm-removal " +
      "screen shows \"−⅓ OF WHAT'S LEFT · LEAVES ⅔ LEFT\" so the math " +
      "is auditable before you hit save. Counted items (eggs, cans, " +
      "sticks of butter) keep their amount/unit flow — the fraction " +
      "row only shows up for items YOU opted into fill-tracking on.",
    shipped: [
      {
        kind: "feature",
        text: "Used-item cards gain a fraction chip row (⅛ / ¼ / ⅓ / ½ / ⅔ / ¾ / ALL) whenever the matched source pantry row has fillLevel != null. Picking one flips that row to fraction-mode — the amount input fades to 35% opacity so it's clear only one measure is active. ✕ returns to amount mode",
        commits: ["__cook_fraction_picker__"],
      },
      {
        kind: "feature",
        text: "Confirm-removal screen renders fraction-mode entries with a different readout: \"−⅓ · OF WHAT'S LEFT\" on the right, \"LEAVES ⅔ LEFT\" on the source-row summary. When the fraction drains a single-container row (amount ≤ 1) it reads ITEM CLEARS; when there are more containers behind it, OPENS NEXT with the new count",
        commits: ["__cook_fraction_ui__"],
      },
      {
        kind: "architecture",
        text: "buildRemovalPlan gains a mode discriminator ('fraction' | 'amount'). Fraction entries carry newFillLevel instead of newAmount and skip the unit-converter path entirely. Save loop branches on mode — fraction mode decrements pantry_items.fill_level multiplicatively (relative: new = old × (1 − fraction)), matching how a cook reasons about \"how much is left\"",
        commits: ["__cook_removal_plan__"],
      },
      {
        kind: "ux",
        text: "Multi-container handling: when a fraction cook empties the open container but amount > 1, the row's count drops by one and fill_level resets to FULL for the next unopened one. No silent deletes when the user still has stock",
        commits: ["__cook_removal_plan__"],
      },
    ],
    coming_soon: [
      "Auto-nudge to shopping list when a tracked row crosses ¼ after a fraction cook",
      "Fraction mode on AddItem + Scan rows (stock new bottles partially-filled, for restocks / gifts)",
      "Per-component proportion slider on user-composed items (not just recipe cooks)",
      "Expiration cancel-to-null (still blocked on a repro)",
    ],
  },
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
