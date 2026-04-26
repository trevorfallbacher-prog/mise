// Builds the payload handed to the generate-recipe edge function.
//
// The edge function used to see only { name, canonicalId, amount, unit,
// category } per pantry item. That meant Claude couldn't prioritize
// food about to expire, didn't know the user's dietary constraints or
// cooking level, couldn't reach for non-obvious pairings suggested by
// canonical enrichment, and couldn't learn from what the user had
// actually cooked before.
//
// This helper assembles a curated-rich payload. "Curated" rather than
// firehose because:
//
//   - 200K context is fine on Haiku 4.5 but signal dilution is real;
//     a focused prompt produces sharper drafts than a maximal one.
//   - Every field shipped is a new privacy surface. We send only what
//     moves the recipe-combination needle.
//   - More context anchors the model; we still want REGEN variety. The
//     "lean" mode is for REGEN calls so the second draft isn't pinned
//     to the same flavor-profile pairings.
//
// Sanitization policy: every user-sourced string is stripped of
// control characters and backtick-fence markers before entering the
// payload. The edge function's prompt still trusts the shape, but
// the strings themselves can't smuggle instructions.

import { filterPantryByCourse, courseHasPantryFilter } from "./courseCompat";

const MAX_PANTRY_ITEMS   = 40;   // keep the prompt bounded
const EXPIRING_SOON_DAYS = 7;    // "about to spoil" threshold
const COOK_HISTORY_LIMIT = 20;   // recent cooks summarized

/**
 * @param {object} args
 * @param {Array}  args.pantry             — rows from usePantry
 * @param {object} [args.profile]          — row from useProfile
 * @param {object} [args.ingredientInfo]   — { getInfo(canonicalId) → info | null }
 * @param {Array}  [args.cookLogs]         — rows from useCookLog (viewer's cooks)
 * @param {"rich" | "lean"} [args.mode]    — "lean" strips enrichment/profile/history
 *                                           so REGEN doesn't re-anchor on the same
 *                                           pairings as the first draft.
 * @param {string[]} [args.starIngredientIds] — canonical slugs the user has
 *                                           explicitly chosen to build around
 *                                           (from the STAR INGREDIENTS picker).
 *                                           Boosted to the top of the ranked
 *                                           pantry + stamped star:true so the
 *                                           prompt can reference them.
 * @returns {{
 *   pantry:          Array,           // capped, sanitized, star-first then expiring-first
 *   pantryFiltered:  boolean,         // true when course+priority actually trimmed rows
 *   context:         object | null,   // { profile, history } or null in lean mode
 * }}
 */
export function buildAIContext({
  pantry = [],
  profile,
  ingredientInfo,
  cookLogs = [],
  mode = "rich",
  starIngredientIds = [],
  // Classic-priority pantry filter. When the user picks a tight
  // course (bake / dessert / prep) AND priority === "classic", we
  // pre-filter the pantry rows Claude sees to items compatible with
  // that category. Claude physically can't draft a hot-dog skillet
  // under Baked Goods when hot dogs aren't in the palette. Pass-
  // through (no filter) for course="any" / main / side / appetizer,
  // for priority="chefs_choice" (chef wants free hand), and for
  // priority="pantry" (every pantry row is part of the source list,
  // hiding compatibility-incompatible rows would mislead the user).
  course,
  priority,
} = {}) {
  const rich = mode === "rich";
  const now = Date.now();
  // Pre-filter BEFORE the ranking pass so starred incompatible items
  // don't get hoisted to the top only to produce narrative pressure
  // for Claude to respect them. pantryFiltered lets the edge fn's
  // PRECEDENCE block say the truth about what Claude is looking at
  // (historically it claimed the pantry was filtered even when no
  // filter had run — Claude then wove expiring savory items into
  // bakes and main-course drafts ignored the category entirely).
  const pantryFiltered = courseHasPantryFilter(course, priority);
  pantry = filterPantryByCourse(pantry, course, priority);
  const getInfo = rich && ingredientInfo?.getInfo
    ? (id) => ingredientInfo.getInfo(id)
    : () => null;

  const starSet = new Set(
    Array.isArray(starIngredientIds) ? starIngredientIds.filter(Boolean) : []
  );

  // Rank pantry: user-starred items first (beats every other tier —
  // the user's explicit ask overrides any expiring-soon heuristic),
  // then expiring-within-window, then by most recently added. Ties
  // broken by name for stable output.
  const ranked = [...pantry]
    .map(p => ({
      item: p,
      isStar: starSet.size > 0 && (
        starSet.has(p.ingredientId) || starSet.has(p.canonicalId)
      ),
      daysToExpiry: daysUntil(p.expiresAt, now),
      purchasedMs:  p.purchasedAt ? +new Date(p.purchasedAt) : 0,
    }))
    .sort((a, b) => {
      if (a.isStar !== b.isStar) return a.isStar ? -1 : 1;
      const aSoon = a.daysToExpiry != null && a.daysToExpiry <= EXPIRING_SOON_DAYS;
      const bSoon = b.daysToExpiry != null && b.daysToExpiry <= EXPIRING_SOON_DAYS;
      if (aSoon !== bSoon) return aSoon ? -1 : 1;
      if (aSoon && bSoon) return (a.daysToExpiry ?? 99) - (b.daysToExpiry ?? 99);
      return (b.purchasedMs - a.purchasedMs) ||
             String(a.item.name || "").localeCompare(String(b.item.name || ""));
    })
    .slice(0, MAX_PANTRY_ITEMS);

  // Shape per-item — always send the basic identity axes plus state /
  // expiresAt / location / ingredientIds[]. In rich mode we add the
  // enrichment triplet (flavorProfile / pairs / diet) because those
  // three fields are what actually drive "what goes with what."
  const pantryOut = ranked.map(({ item, daysToExpiry, isStar }) => {
    const out = {
      // Display name intentionally NOT sent. The AI's job is to reason
      // about identity (canonical + cut + state + brand), and the
      // display name is a client-side derivation of those axes. Sending
      // it creates a competing label the model has to reconcile ("is
      // 'Mission Tortillas' the same as id:tortillas?") instead of
      // acting on the canonical. Display is derived on the client for
      // any human-facing output.
      canonicalId:   item.ingredientId || null,
      ingredientIds: Array.isArray(item.ingredientIds) ? item.ingredientIds : [],
      amount:        item.amount ?? null,
      unit:          item.unit ?? null,
      category:      item.category ?? null,
      // Brand (migration 0061) — manufacturer label parsed off the raw
      // name. Kept as its own axis so the AI can distinguish
      // "Great Value Butter" from "Kerrygold Butter" when dietary
      // claims differ, without polluting the canonical identity.
      brand:         item.brand ?? null,
      state:         item.state ?? null,
      // Cut axis (migration 0122). "breast" / "thigh" / "ribeye" /
      // etc. Surfaced so the AI knows anatomy without subbing away.
      cut:           item.cut ?? null,
      location:      item.location ?? null,
      daysToExpiry:  daysToExpiry,            // negative = already expired
      kind:          item.kind ?? null,       // "ingredient" | "leftovers" | "compound"
      // Flag for the prompt — "user explicitly wants this in the
      // recipe." Prompt rules treat starred rows as the anchor
      // ingredient, overriding the expiring-soon default.
      ...(isStar ? { star: true } : {}),
    };
    if (rich) {
      const info = getInfo(item.ingredientId);
      if (info) {
        // Pull only the three enrichment fields that directly affect
        // recipe combination. Nutrition / storage / skillDev / cultural
        // notes would be nice but blow up the per-item footprint for
        // relatively low signal.
        out.enrichment = {
          flavorProfile: safeStr(info.flavorProfile).slice(0, 200) || null,
          pairs:         Array.isArray(info.pairs) ? info.pairs.slice(0, 12) : [],
          diet:          info.diet || null,
        };
      }
    }
    return out;
  });

  if (!rich) return { pantry: pantryOut, pantryFiltered, context: null };

  // Cook-history summary — bucket ratings, surface the top cuisines +
  // titles the user has leaned into. Never send raw notes (free-text
  // is the highest prompt-injection surface and low signal for
  // drafting).
  const history = summarizeCooks(cookLogs.slice(0, COOK_HISTORY_LIMIT));

  // Profile slice — only the fields that shape the draft. Skip xp,
  // streak, cuisines_cooked (rolled up in history), name.
  const profileSlice = profile ? {
    dietary:    safeStr(profile.dietary)   || null,
    veganStyle: safeStr(profile.vegan_style) || null,
    level:      safeStr(profile.skill_self_report) || null,
    goal:       safeStr(profile.goal)      || null,
    // Top skills by level, 3 at most. Surfaces what the user is
    // actively practicing so the draft picks appropriately-difficult
    // techniques.
    topSkills: topSkills(profile.skill_levels, 3),
  } : null;

  return {
    pantry: pantryOut,
    pantryFiltered,
    context: {
      profile: profileSlice,
      history,
    },
  };
}

// ───────────────────────────────────────────────────────────────────

function daysUntil(when, nowMs) {
  if (!when) return null;
  const t = +new Date(when);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - nowMs) / (24 * 60 * 60 * 1000));
}

// Strip control chars + code-fence markers from user-entered strings
// so they can't smuggle prompt instructions into the edge function.
// Conservative: we drop `, not escape it, since nothing legitimate in
// an ingredient name uses a backtick.
function safeStr(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")  // control chars
    .replace(/`+/g, "")                        // code-fence markers
    .trim();
}

function topSkills(levels, n) {
  if (!levels || typeof levels !== "object") return [];
  return Object.entries(levels)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, n)
    .map(([id, v]) => ({ id, level: Number(v) }));
}

function summarizeCooks(logs) {
  if (!logs.length) return { cookCount: 0 };
  const ratingCounts = { nailed: 0, good: 0, meh: 0, rough: 0, unrated: 0 };
  const cuisineCounts = {};
  // "nailed" is the proxy for "loved it" — cook_log_favorites is a
  // separate join (per-viewer favorites) that we'd have to fetch
  // independently. Rating=nailed is captured on the log row itself
  // so it comes for free. Good enough as a "what does the user
  // cook well and return to" signal.
  const nailedTitles = [];

  for (const log of logs) {
    const r = log.rating || null;
    if (r && ratingCounts[r] != null) ratingCounts[r]++;
    else ratingCounts.unrated++;
    const c = safeStr(log.recipeCuisine || log.cuisine || "").toLowerCase();
    if (c) cuisineCounts[c] = (cuisineCounts[c] || 0) + 1;
    if (r === "nailed" && log.recipeTitle) {
      nailedTitles.push(safeStr(log.recipeTitle));
    }
  }
  const topCuisines = Object.entries(cuisineCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, count]) => ({ id, count }));

  // Dedup titles so a user who nailed the same recipe 3 times doesn't
  // waste prompt tokens on the repeat.
  const uniqNailed = [...new Set(nailedTitles)].slice(0, 3);

  return {
    cookCount: logs.length,
    ratingCounts,
    topCuisines,
    topFavoritedTitles: uniqNailed,
  };
}
