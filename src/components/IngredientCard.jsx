import { useEffect, useMemo, useState } from "react";
import { findIngredient, getIngredientInfo, isInSeason, unitLabel } from "../data/ingredients";
import { RECIPES, findRecipe, totalTimeMin, difficultyLabel } from "../data/recipes";
import { SKILL_TREE } from "../data";
import { useIngredientInfo } from "../lib/useIngredientInfo";
import EnrichmentButton from "./EnrichmentButton";
import GenerateImageButton from "./GenerateImageButton";

// Month labels for seasonality. 1-indexed to match peakMonths convention
// in the ingredient schema.
const MONTHS = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// v2 schema display helpers.
// Dietary chip rendering — label, short pos/neg symbol, + color. Only
// rendered when the ingredient's diet object carries the field.
const DIET_CHIP_META = {
  vegan:      { label: "Vegan",        color: "#a3d977", icon: "🌱" },
  vegetarian: { label: "Vegetarian",   color: "#a3d977", icon: "🥗" },
  keto:       { label: "Keto-friendly", color: "#d9b877", icon: "🥓" },
  halal:      { label: "Halal",        color: "#a3c9d9", icon: "☪" },
  nightshade: { label: "Nightshade",   color: "#d98a8a", icon: "🍆" },
  allium:     { label: "Allium",       color: "#d9a877", icon: "🧄" },
};
const KOSHER_META = {
  meat:      { label: "Kosher (meat)",   color: "#d9a877" },
  dairy:     { label: "Kosher (dairy)",  color: "#a3c9d9" },
  pareve:    { label: "Kosher (pareve)", color: "#d9c8a0" },
  nonkosher: { label: "Not kosher",      color: "#d98a8a" },
};
const FODMAP_META = {
  low:      { label: "Low FODMAP",      color: "#a3d977" },
  moderate: { label: "Moderate FODMAP", color: "#d9c877" },
  high:     { label: "High FODMAP",     color: "#d98a8a" },
};

// Market chip rendering — price tier gets a $/$$/$$$/$$$$ glyph, availability
// gets a short label.
const PRICE_TIER = {
  budget:   { glyph: "$",     label: "Budget"   },
  moderate: { glyph: "$$",    label: "Moderate" },
  premium:  { glyph: "$$$",   label: "Premium"  },
  luxury:   { glyph: "$$$$",  label: "Luxury"   },
};
const AVAILABILITY_LABEL = {
  supermarket: "Supermarket",
  specialty:   "Specialty store",
  online:      "Online",
  seasonal:    "Seasonal market",
};

// Skill difficulty tone.
const DIFFICULTY_META = {
  easy:      { label: "Easy",      color: "#a3d977" },
  moderate:  { label: "Moderate",  color: "#d9c877" },
  technical: { label: "Technical", color: "#e07a3a" },
  expert:    { label: "Expert",    color: "#d98a8a" },
};

// Flavor-tag palette — keeps the chip row readable at a glance.
const FLAVOR_TAG_META = {
  sweet:  { label: "Sweet",  color: "#d9a8c7" },
  sour:   { label: "Sour",   color: "#d9c877" },
  salt:   { label: "Salt",   color: "#c8d9e0" },
  bitter: { label: "Bitter", color: "#a88a6b" },
  umami:  { label: "Umami",  color: "#d9a877" },
  fat:    { label: "Fat",    color: "#e8d4a0" },
  heat:   { label: "Heat",   color: "#e07a3a" },
};

// Intensity → filled-dots visualization (0..3).
const INTENSITY_DOTS = {
  mild:       1,
  moderate:   2,
  strong:     3,
  aggressive: 4,
};

// Substitution tier display order + tone. `direct` first, `pro` last.
const SUB_TIERS = [
  { id: "direct",    label: "DIRECT SUBS",       color: "#a3d977" },
  { id: "emergency", label: "EMERGENCY SUBS",    color: "#d9c877" },
  { id: "dietary",   label: "DIETARY ALTS",      color: "#a3c9d9" },
  { id: "pro",       label: "PRO UPGRADE",       color: "#f5c842" },
];

// Turn [5,6,7,8] into "May – Aug". Handles year-wrap (e.g. [11,12,1,2]
// → "Nov – Feb") for winter produce. Falls back to a comma list when
// the set isn't a single contiguous range.
function formatPeakMonths(months) {
  if (!Array.isArray(months) || months.length === 0) return "";
  const sorted = [...months].sort((a, b) => a - b);
  // Detect simple contiguous range first.
  const contiguous = sorted.every((m, i) => i === 0 || m === sorted[i - 1] + 1);
  if (contiguous) return `${MONTHS[sorted[0]]} – ${MONTHS[sorted[sorted.length - 1]]}`;
  // Year-wrap (e.g. [1,2,11,12] → Nov–Feb).
  const gaps = sorted.slice(1).map((m, i) => m - sorted[i]);
  const splitAt = gaps.findIndex(g => g > 1);
  if (splitAt >= 0) {
    const tail = sorted.slice(splitAt + 1);
    const head = sorted.slice(0, splitAt + 1);
    const wraps = tail.concat(head);
    const wrapsContiguous = wraps.every((m, i) => {
      if (i === 0) return true;
      const prev = wraps[i - 1];
      return m === prev + 1 || (prev === 12 && m === 1);
    });
    if (wrapsContiguous) return `${MONTHS[wraps[0]]} – ${MONTHS[wraps[wraps.length - 1]]}`;
  }
  return sorted.map(m => MONTHS[m]).join(", ");
}

// Shelf-life as a human string. "3 days" / "2 weeks" / "4 months".
function formatShelfLife(days) {
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return null;
  if (days < 14)        return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 90)        return `${Math.round(days / 7)} weeks`;
  if (days < 365)       return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} year${days < 730 ? "" : "s"}`;
}

const LOCATION_META = {
  fridge:  { emoji: "🧊", label: "Fridge"  },
  pantry:  { emoji: "🥫", label: "Pantry"  },
  freezer: { emoji: "❄️", label: "Freezer" },
};

/**
 * IngredientCard — tap an ingredient in Cook Mode (or the Pantry list) to
 * see a full dossier: pantry stock, description, storage, substitutions,
 * nutrition, origin, pairings, and cross-recipe references.
 *
 * Renders every info section conditionally so sparse-metadata ingredients
 * still look clean. As the INGREDIENT_INFO catalog fills in (buildout
 * plan — recipe-referenced ingredients first), the card fills with them
 * automatically — no per-ingredient UI code.
 *
 * Props:
 *   ingredientId   — canonical id (e.g. "butter")
 *   fallbackName   — what to show if the id isn't in the registry
 *   fallbackEmoji  — idem
 *   pantry         — current pantry (array of {id,ingredientId,amount,unit,...})
 *   currentRecipeSlug — recipe the user is looking at now, excluded from "also in"
 *   onPickRecipe(recipe) — optional; called when a linked recipe is tapped
 *   onClose()      — dismiss
 */
export default function IngredientCard({
  ingredientId, fallbackName, fallbackEmoji,
  pantry = [], currentRecipeSlug, onPickRecipe, onClose,
  // Viewer's admin flag — gates the "Generate image" / "Regenerate
  // image" button below the hero slot. Recraft is a paid upstream;
  // only admins can trigger generation. Non-admins never see the
  // button, and the edge function enforces the same check server-
  // side so a bypassed client check still 403s.
  isAdmin = false,
  // Viewer's user id. Stamped onto info.imageLockedBy when an admin
  // taps Lock as final, so Plan / audit surfaces know who sealed
  // the canonical's image.
  userId = null,
  // When true, the card renders its CONTENT only — no backdrop, no fixed
  // positioning, no bottom Close button. Used by ItemCard to embed the
  // canonical deep-dive below its own item-specific section. The parent
  // owns the modal shell and dismissal.
  embedded = false,
  // Enrichment source — optional. When the card is rendered for a
  // user-custom pantry item (no canonical id), pass the raw display name
  // and the pantry row id here. The empty-state "Add AI Enrichment"
  // button then targets the source_name path of the edge function
  // instead of the canonical_id path, so the pending row lands keyed
  // by slugified source name.
  sourceName = null,
  pantryItemId = null,
  // When true, start in a compact "preview" state — header + pantry
  // stock + truncated description + a SEE FULL DETAILS toggle. The
  // heavy sections (flavor wheel, substitutions, pairs, diet chips,
  // market, skill dev, cultural notes) stay hidden until the user
  // explicitly expands. Used by ItemCard to keep the outer item-level
  // view focused. Also hides the empty-state "Add AI Enrichment"
  // button since the parent already exposes an item-level one.
  preview = false,
}) {
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const showFullSections = !preview || previewExpanded;
  // Internal id we actually display. Seeded from prop; substitution pill
  // taps flip it without closing the card, so "butter → clarified butter
  // → ghee" chained learning feels natural.
  const [viewingId, setViewingId] = useState(ingredientId);
  useEffect(() => { setViewingId(ingredientId); }, [ingredientId]);

  const canonical = useMemo(() => findIngredient(viewingId), [viewingId]);
  // DB-first, JS-fallback, pending-enrichment fallback. getInfo returns
  // the approved JSONB row from Supabase (or null if unseeded / empty).
  // getPendingInfo returns the caller's own unapproved AI-enrichment
  // draft for this canonical id, if any — lets the user see their
  // freshly-generated metadata before an admin approves it.
  // getIngredientInfo layers: DB(approved OR user's pending) > JS > subcategory.
  const { getInfo, getPendingInfo } = useIngredientInfo();
  const dbOverride = viewingId ? (getInfo(viewingId) || getPendingInfo(viewingId)) : null;
  const isPendingOnly = Boolean(!getInfo(viewingId) && getPendingInfo(viewingId));
  const info       = useMemo(() => getIngredientInfo(canonical, dbOverride), [canonical, dbOverride]);

  // Aggregate pantry rows for THIS ingredient (family members may each
  // have their own row). Summed in whichever unit the first row has.
  const pantryRows = useMemo(
    // Multi-canonical aware (migration 0033): an item with ingredientIds
    // containing viewingId counts even if ingredientId (the primary
    // display tag) is something else. Lets a frozen pizza appear under
    // mozzarella, sausage, AND dough in their respective cards.
    //
    // Canonical-identity aware (0039): an item whose canonical_id
    // equals viewingId counts even when ingredient_ids is something
    // else (Hot Dog = canonical hot_dog, made-of [ground_pork,
    // sandwich_bread]). Without this branch the card says "Not in
    // kitchen" on a row literally open in front of the user.
    () => viewingId
      ? pantry.filter(p =>
          p.ingredientId === viewingId ||
          p.canonicalId === viewingId ||
          (Array.isArray(p.ingredientIds) && p.ingredientIds.includes(viewingId))
        )
      : [],
    [pantry, viewingId]
  );
  const totalAmount = pantryRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const displayUnit = pantryRows[0]?.unit;
  const unitText    = canonical ? unitLabel(canonical, displayUnit) : (displayUnit || "");

  // Other library recipes using this ingredient, excluding the current one.
  const otherRecipes = useMemo(() => {
    if (!viewingId) return [];
    return RECIPES.filter(r =>
      r.slug !== currentRecipeSlug &&
      (r.ingredients || []).some(i => i.ingredientId === viewingId)
    );
  }, [viewingId, currentRecipeSlug]);

  const name  = canonical?.name  || fallbackName  || "Ingredient";
  const emoji = canonical?.emoji || fallbackEmoji || "🥫";

  const stockLabel =
    pantryRows.length === 0 ? "Not in kitchen"
    : totalAmount <= 0       ? "Out of stock"
    :                          `${Math.round(totalAmount * 10) / 10} ${unitText}`;
  const stockColor =
    pantryRows.length === 0 ? "#888"
    : totalAmount <= 0       ? "#f87171"
    :                          "#a3d977";

  // Resolve substitution names from the registry. Stale ids (ingredient
  // was renamed or removed) fall back to "(removed)" so the card never
  // dead-ends.
  const substitutions = useMemo(() => {
    return (info?.substitutions || []).map(s => {
      const sub = findIngredient(s.id);
      return {
        id: s.id,
        name: sub?.name || s.id,
        emoji: sub?.emoji || "🥫",
        note: s.note || "",
        resolved: !!sub,
      };
    });
  }, [info]);

  // Pairs — same pattern, resolve ids to names.
  const pairs = useMemo(() => {
    return (info?.pairs || []).map(id => {
      const p = findIngredient(id);
      return { id, name: p?.name || id, emoji: p?.emoji || "🥫", resolved: !!p };
    });
  }, [info]);

  const shelfLife = info?.storage?.shelfLifeDays ? formatShelfLife(info.storage.shelfLifeDays) : null;
  // Prefer v2 hemisphere-aware peakMonthsN, fall back to legacy peakMonths.
  // Southern hemisphere is handled by isInSeason; the chip label stays
  // "Peak <months>" either way (labeling both hemispheres inline gets noisy
  // for the 98% of users in the northern hemisphere — we'll treat S as a
  // user preference later).
  const peakMonths = info?.seasonality?.peakMonthsN || info?.seasonality?.peakMonths;
  const peakLabel  = peakMonths ? formatPeakMonths(peakMonths) : "";
  const locMeta    = info?.storage?.location ? LOCATION_META[info.storage.location] : null;

  // v2: in-season banner. Only shown when we have seasonality data AND the
  // ingredient isn't year-round (no point saying "in season" for garlic).
  const inSeasonNow = useMemo(() => {
    if (!info?.seasonality) return false;
    if (info.seasonality.yearRound) return false;
    if (!peakMonths || !peakMonths.length) return false;
    return isInSeason(info.seasonality, "N");
  }, [info, peakMonths]);

  // v2: group substitutions by tier. Untiered entries default to "direct".
  const subsByTier = useMemo(() => {
    const groups = { direct: [], emergency: [], dietary: [], pro: [] };
    for (const s of substitutions) {
      const raw = (info?.substitutions || []).find(x => x.id === s.id);
      const tier = raw?.tier && groups[raw.tier] ? raw.tier : "direct";
      groups[tier].push(s);
    }
    return groups;
  }, [substitutions, info]);

  // v2: resolve skillDev.skills (["knife","heat"]) to full SKILL_TREE
  // entries for colored badge rendering. Unknown ids pass through with a
  // generic look.
  const skills = useMemo(() => {
    if (!info?.skillDev?.skills?.length) return [];
    return info.skillDev.skills.map(id => {
      const s = SKILL_TREE.find(x => x.id === id);
      return s || { id, name: id, emoji: "🏅", color: "#888" };
    });
  }, [info]);

  // v2: allergen display — prefer specific names ("almonds") when
  // allergenDetail has them, otherwise the generic category ("treenut").
  const allergensDisplay = useMemo(() => {
    if (!info?.allergens?.length) return [];
    return info.allergens.map(flag => {
      const specific = info.allergenDetail?.[flag];
      if (Array.isArray(specific) && specific.length) return specific.join(", ");
      return flag;
    });
  }, [info]);

  // In embedded mode, skip the outer backdrop + inner scroll container —
  // the parent (ItemCard) provides both. The drag handle and the bottom
  // Close button are also suppressed via the `embedded` checks inside.
  const content = (
    <>
        <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 16px" }} />

        {/* Header. Hero slot = AI-generated image when info.imageUrl
            is present (admin hit "Generate image" at some point),
            otherwise falls back to the canonical's emoji at large
            scale. Admins get a compact Generate/Regenerate button
            underneath the hero so they can iterate on the output
            without leaving the card. */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {/* Image slot + optional 🔒 FINAL lock pip in the top-
                right corner. Lock pip renders for everyone (not just
                admins) so family members viewing the canonical see
                that the image has been sealed — consistency across
                viewers, not just a curator-only signal. */}
            <div style={{ position: "relative" }}>
              {info?.imageUrl ? (
                <img
                  src={info.imageUrl}
                  alt={name}
                  style={{
                    width: 72, height: 72, borderRadius: 14,
                    objectFit: "cover",
                    background: "#0f0f0f",
                    border: info?.imageLocked ? "1px solid #2a3a1e" : "1px solid #242424",
                    display: "block",
                  }}
                />
              ) : (
                <div style={{
                  width: 72, height: 72, borderRadius: 14,
                  background: "#0f0f0f", border: "1px solid #242424",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 44,
                }}>
                  {emoji}
                </div>
              )}
              {info?.imageUrl && info?.imageLocked && (
                <span
                  title="Locked as final by an admin"
                  style={{
                    position: "absolute", top: -6, right: -6,
                    background: "#0f1a0f", border: "1px solid #2a3a1e",
                    color: "#a3d977",
                    fontFamily: "'DM Mono',monospace", fontSize: 8,
                    fontWeight: 700, letterSpacing: "0.1em",
                    padding: "2px 5px", borderRadius: 4,
                    lineHeight: 1,
                  }}
                >
                  🔒 FINAL
                </span>
              )}
            </div>
            {viewingId && (
              <GenerateImageButton
                canonicalId={viewingId}
                canonicalName={name}
                hasExistingImage={!!info?.imageUrl}
                isLocked={!!info?.imageLocked}
                isAdmin={isAdmin}
                userId={userId}
                compact
              />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
              {(canonical?.category || "INGREDIENT").toUpperCase()}
              {canonical?.subcategory ? ` · ${canonical.subcategory.toUpperCase()}` : ""}
            </div>
            <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 26, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </h2>
            {info?.origin && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", marginTop: 3 }}>
                📍 {info.origin}
              </div>
            )}
          </div>
        </div>

        {/* Pantry stock */}
        <div style={{
          padding: "12px 14px", background: "#0f0f0f",
          border: "1px solid #1e1e1e", borderRadius: 12,
          display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
        }}>
          <span style={{ fontSize: 20 }}>🥫</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.1em" }}>
              IN YOUR KITCHEN
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: stockColor, marginTop: 2 }}>
              {stockLabel}
            </div>
          </div>
          {pantryRows.length > 1 && (
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#888", letterSpacing: "0.08em" }}>
              {pantryRows.length} ROWS
            </span>
          )}
        </div>

        {/* Pending-review badge — info was generated by Claude but not yet
            admin-approved. The card still renders the content; this just
            flags that it might change once an admin reviews. */}
        {isPendingOnly && info?.description && (
          <div style={{
            padding: "8px 12px", background: "#2a2205", border: "1px solid #f5c84244",
            borderRadius: 10, marginBottom: 14,
            fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842",
            letterSpacing: "0.1em", display: "flex", alignItems: "center", gap: 8,
          }}>
            ✨ AI-GENERATED · PENDING REVIEW
          </div>
        )}

        {/* Empty-state enrichment CTA — shown when the canonical has no
            approved metadata AND no user-scoped pending draft. Clicking
            fires the enrich-ingredient edge function; on success the
            context refreshes and this block disappears. Custom items
            (sourceName set, no canonical id) use the source_name path;
            everything else uses the canonical id. */}
        {!preview && (viewingId || sourceName) && !info?.description && !info?.flavorProfile && !info?.storage && (
          <div style={{
            padding: "16px 14px", background: "#0f0f0f",
            border: "1px dashed #2a2a2a", borderRadius: 12,
            marginBottom: 14, textAlign: "center",
          }}>
            <div style={{
              fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888",
              marginBottom: 10, lineHeight: 1.5,
            }}>
              No metadata yet for this ingredient.<br/>
              Generate a full profile with AI — it'll appear here in a few seconds.
            </div>
            {sourceName ? (
              <EnrichmentButton
                sourceName={sourceName}
                pantryItemId={pantryItemId}
              />
            ) : (
              <EnrichmentButton canonicalId={viewingId} />
            )}
          </div>
        )}

        {/* Description — truncated in preview mode until the user
            taps SEE FULL DETAILS, full-length otherwise. */}
        {info?.description && (() => {
          const full = info.description;
          const truncated = preview && !previewExpanded && full.length > 180
            ? `${full.slice(0, 180).trimEnd()}…`
            : full;
          return (
            <p style={{
              fontFamily: "'DM Sans',sans-serif", fontSize: 14, lineHeight: 1.55,
              color: "#ccc", margin: "0 0 14px",
            }}>
              {truncated}
            </p>
          );
        })()}

        {/* Preview-mode expand toggle. Everything below this point is
            gated on `showFullSections` so the embedded card stays
            compact until the user opts in. */}
        {preview && !previewExpanded && (
          <button
            onClick={() => setPreviewExpanded(true)}
            style={{
              width: "100%", padding: "10px 12px", marginBottom: 14,
              background: "transparent", border: "1px dashed #3a2f10",
              borderRadius: 10, cursor: "pointer",
              fontFamily: "'DM Mono',monospace", fontSize: 11,
              color: "#f5c842", letterSpacing: "0.1em", fontWeight: 600,
            }}
          >
            + SEE FULL DETAILS
          </button>
        )}

        {/* Flavor profile (prose) */}
        {showFullSections && info?.flavorProfile && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>
              FLAVOR PROFILE
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#bbb", fontStyle: "italic", lineHeight: 1.5 }}>
              {info.flavorProfile}
            </div>
          </div>
        )}

        {/* v2: structured flavor — primary tags, intensity dots, heat-change */}
        {showFullSections && info?.flavor && (info.flavor.primary?.length || info.flavor.intensity || info.flavor.heatChange) && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              FLAVOR WHEEL
            </div>
            {info.flavor.primary?.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: info.flavor.intensity || info.flavor.heatChange ? 8 : 0 }}>
                {info.flavor.primary.map(tag => {
                  const m = FLAVOR_TAG_META[tag] || { label: tag, color: "#bbb" };
                  return (
                    <span key={tag} style={{ padding: "3px 9px", background: `${m.color}18`, border: `1px solid ${m.color}44`, borderRadius: 12, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: m.color }}>
                      {m.label}
                    </span>
                  );
                })}
              </div>
            )}
            {info.flavor.intensity && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: info.flavor.heatChange ? 8 : 0 }}>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.08em" }}>INTENSITY</span>
                <div style={{ display: "flex", gap: 3 }}>
                  {[1,2,3,4].map(i => (
                    <span key={i} style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: i <= (INTENSITY_DOTS[info.flavor.intensity] || 0) ? "#f5c842" : "#2a2a2a",
                    }} />
                  ))}
                </div>
                <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#999", fontStyle: "italic" }}>
                  {info.flavor.intensity}
                </span>
              </div>
            )}
            {info.flavor.heatChange && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                {["raw","cooked","charred"].map(k => info.flavor.heatChange[k] ? (
                  <div key={k} style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#999", lineHeight: 1.4 }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.08em", marginRight: 6 }}>{k.toUpperCase()}</span>
                    {info.flavor.heatChange[k]}
                  </div>
                ) : null)}
              </div>
            )}
          </div>
        )}

        {/* v2: dietary / lifestyle flags — compact chip row. Only populated
            fields render; sparse ingredients skip the whole section. */}
        {showFullSections && info?.diet && (() => {
          const chips = [];
          const d = info.diet;
          for (const key of ["vegan","vegetarian","keto","halal","nightshade","allium"]) {
            if (d[key] === true) {
              const m = DIET_CHIP_META[key];
              chips.push({ key, label: m.label, color: m.color, icon: m.icon });
            }
          }
          if (d.kosher) {
            const m = KOSHER_META[d.kosher];
            if (m) chips.push({ key: "kosher", label: m.label, color: m.color, icon: "✡" });
          }
          if (d.fodmap) {
            const m = FODMAP_META[d.fodmap];
            if (m) chips.push({ key: "fodmap", label: m.label, color: m.color, icon: "🧬" });
          }
          if (!chips.length) return null;
          return (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
                DIETARY
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {chips.map(c => (
                  <span key={c.key} style={{
                    padding: "3px 9px",
                    background: `${c.color}18`,
                    border: `1px solid ${c.color}44`,
                    borderRadius: 12,
                    fontFamily: "'DM Sans',sans-serif",
                    fontSize: 11, color: c.color,
                  }}>
                    {c.icon} {c.label}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Cultural notes — separate section so the origin chip up top
            stays compact and we can let the story breathe. */}
        {showFullSections && info?.culturalNotes && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "#161208", border: "1px solid #2a2015", borderRadius: 10 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 6 }}>
              THE STORY
            </div>
            <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 13, color: "#d9c8a0", lineHeight: 1.55 }}>
              {info.culturalNotes}
            </div>
          </div>
        )}

        {/* Storage — location chip + shelf-life (per-location when v2 map
            present) + tips. v2 also adds spoilage signs, freezability, and
            a prep-yield line if the entry carries them. */}
        {showFullSections && info?.storage && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              STORAGE
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: info.storage.tips ? 6 : 0 }}>
              {locMeta && (
                <span style={{ padding: "4px 10px", background: "#0f1a0f", border: "1px solid #1e3a1e", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#a3d977" }}>
                  {locMeta.emoji} {locMeta.label}
                </span>
              )}
              {/* v2: per-location shelf life map takes precedence; fall back
                  to the legacy single shelfLifeDays chip when absent. */}
              {info.storage.shelfLife
                ? ["fridge","freezer","pantry"].map(loc => {
                    const days = info.storage.shelfLife[loc];
                    const human = formatShelfLife(days);
                    if (!human) return null;
                    const m = LOCATION_META[loc];
                    return (
                      <span key={loc} style={{ padding: "4px 10px", background: "#0f0f0f", border: "1px solid #2a2a2a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb" }}>
                        {m?.emoji} {human}
                      </span>
                    );
                  })
                : shelfLife && (
                    <span style={{ padding: "4px 10px", background: "#0f0f0f", border: "1px solid #2a2a2a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb" }}>
                      Keeps ~{shelfLife}
                    </span>
                  )}
              {info.storage.freezable === true && !info.storage.shelfLife?.freezer && (
                <span style={{ padding: "4px 10px", background: "#0f1420", border: "1px solid #1e2a3a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#a3c9e0" }}>
                  ❄️ Freezes well
                </span>
              )}
            </div>
            {info.storage.tips && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", fontStyle: "italic", lineHeight: 1.5 }}>
                {info.storage.tips}
              </div>
            )}
            {/* v2: how to tell if it's bad — the actionable spoilage line. */}
            {info.storage.spoilageSigns && (
              <div style={{ marginTop: 8, padding: "8px 10px", background: "#1a0f0f", border: "1px solid #2a1515", borderRadius: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, lineHeight: 1.2 }}>🚫</span>
                <div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#d98a8a", letterSpacing: "0.1em", marginBottom: 2 }}>
                    IF IT'S BAD
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#ccc", lineHeight: 1.5 }}>
                    {info.storage.spoilageSigns}
                  </div>
                </div>
              </div>
            )}
            {/* v2: freeze notes (only if the user has something more useful
                than just "yes freezable" — procedure matters). */}
            {info.storage.freezeNotes && (
              <div style={{ marginTop: 6, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#7a9dc0", lineHeight: 1.5 }}>
                ❄️ {info.storage.freezeNotes}
              </div>
            )}
            {/* v2: prep yield (whole vs. prepped — answers "how many onions
                is a cup of chopped onions?"). */}
            {info.storage.prepYield?.whole && info.storage.prepYield?.yields && (
              <div style={{ marginTop: 6, fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#888", lineHeight: 1.5 }}>
                ⚖ {info.storage.prepYield.whole} → {info.storage.prepYield.yields}
              </div>
            )}
          </div>
        )}

        {/* Prep tips */}
        {showFullSections && info?.prepTips && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>
              PREP TIP
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#ccc", lineHeight: 1.5 }}>
              {info.prepTips}
            </div>
          </div>
        )}

        {/* Nutrition — compact 4-tile readout */}
        {showFullSections && info?.nutrition && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em" }}>
                NUTRITION
              </div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.08em" }}>
                PER {(info.nutrition.per || "100G").toUpperCase()}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {[
                { label: "kcal",    value: info.nutrition.kcal },
                { label: "protein", value: info.nutrition.protein_g, unit: "g" },
                { label: "fat",     value: info.nutrition.fat_g,     unit: "g" },
                { label: "carbs",   value: info.nutrition.carb_g,    unit: "g" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10, padding: "8px 4px", textAlign: "center" }}>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: "#f0ece4", fontWeight: 500 }}>
                    {s.value != null ? s.value : "—"}{s.unit && s.value != null ? s.unit : ""}
                  </div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, color: "#666", letterSpacing: "0.08em", marginTop: 2 }}>
                    {s.label.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
            {(info.nutrition.fiber_g != null || info.nutrition.sodium_mg != null) && (
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", marginTop: 6, letterSpacing: "0.06em" }}>
                {info.nutrition.fiber_g  != null && `Fiber ${info.nutrition.fiber_g}g`}
                {info.nutrition.fiber_g  != null && info.nutrition.sodium_mg != null && "  ·  "}
                {info.nutrition.sodium_mg != null && `Sodium ${info.nutrition.sodium_mg}mg`}
              </div>
            )}
          </div>
        )}

        {/* v2: irreplaceable callout — rendered instead of (or above) the
            substitutions list when the ingredient has no real sub. */}
        {showFullSections && info?.irreplaceable && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "#1a1408", border: "1px solid #3a2a15", borderRadius: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 18, lineHeight: 1.2 }}>🚫</span>
            <div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 4 }}>
                IRREPLACEABLE
              </div>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#d9c8a0", lineHeight: 1.5, fontStyle: "italic" }}>
                {info.irreplaceableNote || "No real substitute. Nothing else behaves the same way."}
              </div>
            </div>
          </div>
        )}

        {/* Substitutions — grouped by tier (v2). Untiered entries land in
            the "direct" group so older data still renders cleanly. Taps
            swap the displayed ingredient. */}
        {substitutions.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              SUBSTITUTIONS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {SUB_TIERS.map(tier => {
                const items = subsByTier[tier.id];
                if (!items || !items.length) return null;
                // Only show the tier header label when we have >1 tier
                // populated; single-tier entries (old-schema ingredients) get
                // a clean plain list without noise.
                const populatedTiers = SUB_TIERS.filter(t => subsByTier[t.id]?.length).length;
                return (
                  <div key={tier.id}>
                    {populatedTiers > 1 && (
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: tier.color, letterSpacing: "0.1em", marginBottom: 4 }}>
                        {tier.label}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map(s => (
                        <button
                          key={s.id}
                          onClick={s.resolved ? () => setViewingId(s.id) : undefined}
                          disabled={!s.resolved}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "9px 12px", background: "#161616",
                            border: `1px solid ${populatedTiers > 1 ? tier.color + "44" : "#2a2a2a"}`,
                            borderRadius: 10,
                            cursor: s.resolved ? "pointer" : "default",
                            textAlign: "left", width: "100%",
                          }}
                        >
                          <span style={{ fontSize: 20 }}>{s.emoji}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
                              {s.name}
                            </div>
                            {s.note && (
                              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#888", marginTop: 1, fontStyle: "italic" }}>
                                {s.note}
                              </div>
                            )}
                          </div>
                          {s.resolved && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#f5c842" }}>→</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pairs with */}
        {pairs.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              PAIRS WITH
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {pairs.map(p => (
                <button
                  key={p.id}
                  onClick={p.resolved ? () => setViewingId(p.id) : undefined}
                  disabled={!p.resolved}
                  style={{
                    padding: "4px 10px", background: "#0f0f0f",
                    border: "1px solid #2a2a2a", borderRadius: 14,
                    fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb",
                    cursor: p.resolved ? "pointer" : "default",
                  }}
                >
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Allergens + seasonality + sourcing — grouped info strip. Each
            chip rendered only when its field is populated. v2: allergens
            use allergenDetail for specificity ("almonds" vs. generic
            "treenut") when available, and we add an "IN SEASON NOW"
            badge when the current month hits peakMonthsN. */}
        {(allergensDisplay.length > 0 || peakLabel || inSeasonNow || info?.sourcing) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              GOOD TO KNOW
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: info.sourcing ? 6 : 0 }}>
              {allergensDisplay.length > 0 && (
                <span style={{ padding: "4px 10px", background: "#1a0f0f", border: "1px solid #3a1a1a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#d98a8a" }}>
                  ⚠ Contains {allergensDisplay.join(", ")}
                </span>
              )}
              {inSeasonNow && (
                <span style={{ padding: "4px 10px", background: "#0a1a0a", border: "1px solid #2a5a2a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#7edd7e", fontWeight: 600 }}>
                  🌱 In season now
                </span>
              )}
              {peakLabel && (
                <span style={{ padding: "4px 10px", background: "#0f1a14", border: "1px solid #1e3a2a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#a3d9b4" }}>
                  🗓 Peak {peakLabel}
                </span>
              )}
              {info.seasonality?.yearRound && (
                <span style={{ padding: "4px 10px", background: "#0f1a14", border: "1px solid #1e3a2a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#a3d9b4" }}>
                  🗓 Year-round
                </span>
              )}
            </div>
            {info.sourcing && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", fontStyle: "italic", lineHeight: 1.5 }}>
                💡 {info.sourcing}
              </div>
            )}
          </div>
        )}

        {/* v2: market — price tier + availability chips + "worth buying nice"
            callout when qualityMatters. Keeps the long-form sourcing prose
            above for detail; these chips are scannable. */}
        {showFullSections && info?.market && (info.market.priceTier || info.market.availability || info.market.qualityMatters || info.market.organicCommon) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              MARKET
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: info.market.qualityMatters && info.market.qualityNote ? 8 : 0 }}>
              {info.market.priceTier && PRICE_TIER[info.market.priceTier] && (
                <span style={{ padding: "4px 10px", background: "#0f0f0f", border: "1px solid #2a2a2a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#d9c877" }}>
                  {PRICE_TIER[info.market.priceTier].glyph} {PRICE_TIER[info.market.priceTier].label}
                </span>
              )}
              {info.market.availability && AVAILABILITY_LABEL[info.market.availability] && (
                <span style={{ padding: "4px 10px", background: "#0f0f0f", border: "1px solid #2a2a2a", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb" }}>
                  🛒 {AVAILABILITY_LABEL[info.market.availability]}
                </span>
              )}
              {info.market.organicCommon === true && (
                <span style={{ padding: "4px 10px", background: "#0f1a0f", border: "1px solid #1e3a1e", borderRadius: 14, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#a3d977" }}>
                  🌿 Organic common
                </span>
              )}
            </div>
            {info.market.qualityMatters && (
              <div style={{ padding: "8px 10px", background: "#161208", border: "1px solid #2a2015", borderRadius: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, lineHeight: 1.2 }}>✨</span>
                <div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#f5c842", letterSpacing: "0.1em", marginBottom: 2 }}>
                    WORTH BUYING NICE
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#d9c8a0", lineHeight: 1.5 }}>
                    {info.market.qualityNote || "Cheap versions really don't cut it here."}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* v2: skill development — badges for skills this ingredient exercises,
            difficulty tone, and a "make from scratch" link when proFromScratch. */}
        {showFullSections && info?.skillDev && (skills.length > 0 || info.skillDev.difficulty || info.skillDev.proFromScratch) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              BUILDS SKILLS
            </div>
            {skills.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {skills.map(s => (
                  <span key={s.id} style={{
                    padding: "3px 9px",
                    background: `${s.color}18`,
                    border: `1px solid ${s.color}44`,
                    borderRadius: 12,
                    fontFamily: "'DM Sans',sans-serif",
                    fontSize: 11, color: s.color,
                  }}>
                    {s.emoji} {s.name}
                  </span>
                ))}
              </div>
            )}
            {info.skillDev.difficulty && DIFFICULTY_META[info.skillDev.difficulty] && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", marginBottom: 4 }}>
                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.08em", marginRight: 6 }}>DIFFICULTY</span>
                <span style={{ color: DIFFICULTY_META[info.skillDev.difficulty].color }}>
                  {DIFFICULTY_META[info.skillDev.difficulty].label}
                </span>
              </div>
            )}
            {info.skillDev.proFromScratch && !info.skillDev.fromScratchRecipeId && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#d9c8a0", fontStyle: "italic", lineHeight: 1.5 }}>
                🎓 Can be made from scratch
              </div>
            )}
          </div>
        )}

        {/* ─── Compound ingredient: scratch recipe + "made from" list ───
            When this ingredient has a working scratch recipe linked
            (info.skillDev.fromScratchRecipeId + the recipe file exists),
            we surface two things:
              1. A big tappable card for the recipe itself — opens via
                 onPickRecipe so the Cook flow picks it up naturally.
              2. A "MADE FROM" row of ingredient chips parsed from the
                 recipe's ingredients[]. Each chip with a known
                 ingredientId is tappable → navigates this same card to
                 that sub-ingredient (setViewingId). "Learn the recipe
                 by drilling into its pieces" UX.
            Primitive ingredients (basil, flour) never render this
            section — only compounds you can actually build. */}
        {(() => {
          const scratchRecipe = info?.skillDev?.fromScratchRecipeId
            ? findRecipe(info.skillDev.fromScratchRecipeId)
            : null;
          if (!scratchRecipe) return null;

          // Tracked ingredients (have ingredientId) become tappable chips.
          // Untracked ones still render as chips but grey/non-interactive
          // — they're real ingredients (pine nuts, red pepper flakes)
          // we just haven't added to the registry yet.
          const recipeIngredients = (scratchRecipe.ingredients || [])
            .filter(i => i.item && !/^(to taste|for |salt$|water$)/i.test(i.item));

          const totalMin = totalTimeMin(scratchRecipe);
          const difficulty = difficultyLabel(scratchRecipe.difficulty);

          return (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
                🔪 MAKE FROM SCRATCH
              </div>
              <button
                onClick={() => onPickRecipe?.(scratchRecipe)}
                disabled={!onPickRecipe}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 14px",
                  background: "linear-gradient(135deg,#1e1a0e 0%,#141008 100%)",
                  border: "1px solid #f5c84244", borderRadius: 12,
                  cursor: onPickRecipe ? "pointer" : "default",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 32, flexShrink: 0 }}>{scratchRecipe.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Fraunces',serif", fontSize: 17, color: "#f0ece4", fontWeight: 400 }}>
                    {scratchRecipe.title}
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", fontStyle: "italic", marginTop: 2 }}>
                    {scratchRecipe.subtitle}
                  </div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#f5c842", letterSpacing: "0.08em", marginTop: 6 }}>
                    {totalMin}m · {difficulty.toUpperCase()}
                    {scratchRecipe.produces?.yield && (
                      <span style={{ color: "#888", marginLeft: 8 }}>
                        · YIELDS {scratchRecipe.produces.yield.amount} {scratchRecipe.produces.yield.unit.replace("_", " ").toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: 18, color: "#f5c842", flexShrink: 0 }}>→</span>
              </button>

              {recipeIngredients.length > 0 && (
                <>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", margin: "14px 0 8px" }}>
                    MADE FROM
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {recipeIngredients.map((ri, i) => {
                      const subIng = ri.ingredientId ? findIngredient(ri.ingredientId) : null;
                      const tappable = !!subIng;
                      // Chip label: prefer the canonical short name when we
                      // have one (fits more chips in a row), else the
                      // recipe's "item" string trimmed to the first
                      // comma (so "garlic, smashed" reads as "garlic").
                      const label = subIng?.shortName || subIng?.name || ri.item.split(",")[0];
                      const emoji = subIng?.emoji || "•";
                      return (
                        <button
                          key={i}
                          onClick={() => tappable && setViewingId(ri.ingredientId)}
                          disabled={!tappable}
                          title={tappable ? `Open ${label}` : ri.item}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            padding: "5px 10px",
                            background: tappable ? "#161616" : "#0d0d0d",
                            border: `1px solid ${tappable ? "#2a2a2a" : "#1a1a1a"}`,
                            borderRadius: 12,
                            fontFamily: "'DM Sans',sans-serif",
                            fontSize: 12,
                            color: tappable ? "#f0ece4" : "#666",
                            cursor: tappable ? "pointer" : "default",
                          }}
                        >
                          <span style={{ fontSize: 14 }}>{emoji}</span>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#444", marginTop: 8, letterSpacing: "0.06em" }}>
                    TAP ANY INGREDIENT TO DIVE IN
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* Wine pairings */}
        {showFullSections && info?.winePairings?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              GOES WITH
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {info.winePairings.map(w => (
                <span key={w} style={{
                  padding: "4px 10px", background: "#1a1408",
                  border: "1px solid #3a2a15", borderRadius: 14,
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#d9b877",
                }}>
                  🍷 {w}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Other library recipes that use this ingredient */}
        {otherRecipes.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              ALSO IN
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {otherRecipes.map(r => (
                <button
                  key={r.slug}
                  onClick={() => onPickRecipe?.(r)}
                  disabled={!onPickRecipe}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px", background: "#161616",
                    border: "1px solid #2a2a2a", borderRadius: 10,
                    cursor: onPickRecipe ? "pointer" : "default",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 22 }}>{r.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Fraunces',serif", fontSize: 14, color: "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.title}
                    </div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.08em", marginTop: 2 }}>
                      {(r.cuisine || "").toUpperCase()} · {(r.category || "").toUpperCase()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Suggested ideas from the info dictionary (subcategory fallback). */}
        {showFullSections && info?.recipes?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.12em", marginBottom: 8 }}>
              GOOD FOR
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 18px", fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
              {info.recipes.slice(0, 5).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}

        {!embedded && <button
          onClick={onClose}
          style={{
            width: "100%", padding: "14px", marginTop: 6,
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            color: "#888", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12,
            letterSpacing: "0.08em", cursor: "pointer",
          }}
        >
          CLOSE
        </button>}
    </>
  );

  // Embedded: caller owns the shell. We emit content with a small top pad
  // so it reads as a section, not a hard-edge fragment.
  if (embedded) {
    return <div style={{ padding: "6px 0 0" }}>{content}</div>;
  }

  // Standalone: render the full modal shell.
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 320,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "20px 22px 36px",
        maxHeight: "88vh", overflowY: "auto",
      }}>
        {content}
      </div>
    </div>
  );
}
