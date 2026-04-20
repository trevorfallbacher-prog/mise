import { useMemo, useState } from "react";
import { findIngredient, fuzzyMatchIngredient, HUBS } from "../data/ingredients";
import { BLEND_PRESETS } from "../data/blendPresets";
import { slugifyIngredientName, useIngredientInfo } from "../lib/useIngredientInfo";
import { suggestedPackaging, DEFAULT_PACKAGING_BY_CATEGORY } from "../data/defaultPackaging";
import { supabase } from "../lib/supabase";
import { enrichIngredient } from "../lib/enrichIngredient";

// Turn an admin-approved ingredient_info slug ("pepperoni") into a
// synthetic canonical object so the picker can surface it alongside
// bundled INGREDIENTS. Pulls a display name from info.display_name when
// the admin renamed the canonical, else decases the slug.
function syntheticCanonicalForSlug(slug, info) {
  const displayOverride = info?.display_name;
  const name = (typeof displayOverride === "string" && displayOverride.trim())
    ? displayOverride.trim()
    : slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return {
    id: slug,
    name,
    emoji: info?.emoji || "✨",
    category: info?.category || "user",
    shortName: null,
    parentId: undefined,
    // Legal unit list — keep it permissive so toBase/unitLabel don't
    // blow up when user-canonical rows get quantities assigned.
    units: [
      { id: "unit", label: "unit", toBase: 1 },
      { id: "oz",   label: "oz",   toBase: 1 },
      { id: "g",    label: "g",    toBase: 1 },
    ],
  };
}

// Lightweight fuzzy scorer for synthetic (admin-approved) canonicals
// since scoreIngredientMatch lives inside ingredients.js and isn't
// exported. Substring match + exact-slug match are enough to get them
// to surface in the picker; the registry's ranking is still canonical
// for ordering overall.
function scoreSynthetic(needle, canon) {
  const n = (needle || "").toLowerCase().trim();
  if (!n) return 0;
  const nameLow = canon.name.toLowerCase();
  const slugLow = canon.id.toLowerCase();
  if (nameLow === n || slugLow === n) return 100;
  if (slugLow === n.replace(/\s+/g, "_")) return 100;
  if (nameLow.startsWith(n) || slugLow.startsWith(n.replace(/\s+/g, "_"))) return 80;
  if (nameLow.includes(n) || slugLow.includes(n.replace(/\s+/g, "_"))) return 60;
  return 0;
}

// Confidence bucketing for the match list — the raw 0–120 score reads as
// noise; these labels give the user something to decide on. Thresholds
// picked by eyeballing real scan misidentifications.
function confidenceTone(score) {
  if (score >= 90) return { label: "Exact",  color: "#4ade80" };
  if (score >= 60) return { label: "Likely", color: "#a3d977" };
  if (score >= 40) return { label: "Maybe",  color: "#f59e0b" };
  return { label: "Weak", color: "#666" };
}

/**
 * LinkIngredient — bottom-sheet picker that tags a pantry row with one or
 * more canonical ingredient ids.
 *
 * UX shape (star-first rewrite, mirroring TypePicker):
 *
 *   1. SELECTED accumulator at the top — every tag currently on deck.
 *      Tap a ✕ on any chip to remove. CLEAR ALL drops everything.
 *   2. ⭐ STAR — the single highest-scoring canonical for the needle.
 *      Rendered bigger so it reads as the default one-tap add.
 *   3. TOP 3 LIKELY — the next three fuzzy matches, sorted strictly
 *      high-to-low by score. No more random ordering; no more
 *      "EXACT below WEAK" confusion. Each still carries its
 *      Exact/Likely/Maybe/Weak confidence chip.
 *   4. BLEND PRESETS — composite tags applied in one tap (Italian
 *      Blend → mozzarella + provolone). Unchanged from before.
 *   5. SEARCH bar + on-demand results. The full canonical catalog
 *      stays behind the search — no whole-registry dump.
 *
 * Multi-select accumulator flow (6a, unchanged):
 *   Tapping a match or preset APPENDS to the selection instead of
 *   committing + closing. DONE commits the full array via onLink().
 *
 * Initial selection: pre-populates from item.ingredientIds /
 * item.ingredientId so re-opening the sheet on an already-tagged
 * item shows the current tags.
 *
 * Props:
 *   item           — the pantry row being linked ({ name, emoji, ingredientIds, … })
 *   mode           — "multi" (default) accumulates tags; "single" commits
 *                    immediately on any tap (scan CANONICAL axis).
 *   onLink(ids)    — called with an ARRAY of canonical ids when the user
 *                    taps DONE. Always an array; pass [] to clear tagging.
 *   onClose()      — dismiss without committing.
 */
export default function LinkIngredient({ item, mode = "multi", onLink, onClose }) {
  const singleMode = mode === "single";
  const [search, setSearch] = useState("");
  const needle = search.trim() || item.name;

  // Admin-approved canonicals that aren't in the bundled registry.
  // `dbMap` from the IngredientInfo context is keyed by ingredient_id;
  // any row whose id isn't in INGREDIENTS is a user-minted canonical
  // that an admin approved. Those need to show up in this picker or
  // users who created them can never re-tag another item with them.
  const { dbMap, refreshDb: refreshDbInfo } = useIngredientInfo();
  const approvedSynthetics = useMemo(() => {
    const out = [];
    for (const [slug, info] of Object.entries(dbMap || {})) {
      if (!slug) continue;
      if (findIngredient(slug)) continue; // bundled handles itself
      out.push(syntheticCanonicalForSlug(slug, info));
    }
    return out;
  }, [dbMap]);

  // Combined match list: bundled fuzzy + synthetic substring, merged
  // and re-sorted by score. Synthetics score 60-100 depending on
  // match-type so an exact "pepperoni" outranks a weak bundled match.
  const mergedMatches = useMemo(() => {
    const bundled = fuzzyMatchIngredient(needle, 40);
    const bundledIds = new Set(bundled.map(m => m.ingredient.id));
    const synth = [];
    for (const canon of approvedSynthetics) {
      if (bundledIds.has(canon.id)) continue;
      const score = scoreSynthetic(needle, canon);
      if (score > 0) synth.push({ ingredient: canon, score });
    }
    return [...bundled, ...synth].sort((a, b) => b.score - a.score);
  }, [needle, approvedSynthetics]);

  // fuzzyMatchIngredient returns matches sorted descending by score.
  // We slice to 4 = 1 star + 3 likely. Search mode pulls more.
  const topMatches = useMemo(() => mergedMatches.slice(0, 4), [mergedMatches]);
  const searchNeedle = search.trim();
  const searchMatches = useMemo(() => {
    if (!searchNeedle) return [];
    // Up to 20 for search mode — catalog-on-demand, capped so the
    // sheet doesn't explode on generic terms like "cheese".
    const bundled = fuzzyMatchIngredient(searchNeedle, 20);
    const bundledIds = new Set(bundled.map(m => m.ingredient.id));
    const synth = [];
    for (const canon of approvedSynthetics) {
      if (bundledIds.has(canon.id)) continue;
      const score = scoreSynthetic(searchNeedle, canon);
      if (score > 0) synth.push({ ingredient: canon, score });
    }
    return [...bundled, ...synth].sort((a, b) => b.score - a.score).slice(0, 20);
  }, [searchNeedle, approvedSynthetics]);

  // Seed the selection from the item's current tags so re-opening the
  // sheet on an already-tagged item lets the user incrementally adjust
  // instead of starting from zero. Prefers ingredientIds (plural, 0033)
  // and falls back to the legacy scalar. Resolves against bundled
  // first, then admin-approved synthetics (dbMap-keyed).
  const resolveAny = (id) => {
    const bundled = findIngredient(id);
    if (bundled) return bundled;
    const info = dbMap?.[id];
    if (info !== undefined) return syntheticCanonicalForSlug(id, info);
    return null;
  };
  const [selected, setSelected] = useState(() => {
    const seed = Array.isArray(item?.ingredientIds) && item.ingredientIds.length
      ? item.ingredientIds
      : (item?.ingredientId ? [item.ingredientId] : []);
    return seed
      .map(id => ({ id, canonical: resolveAny(id) }))
      .filter(s => s.canonical);
  });
  const selectedIds = useMemo(() => new Set(selected.map(s => s.id)), [selected]);

  const toggleTag = (id) => {
    const canonical = resolveAny(id);
    if (!canonical) return;
    if (singleMode) {
      // Single-axis pick (scan CANONICAL chip): commit and close on tap.
      onLink([id]);
      return;
    }
    setSelected(prev =>
      prev.some(s => s.id === id)
        ? prev.filter(s => s.id !== id)
        : [...prev, { id, canonical }]
    );
  };
  // Append a preset's component ids in order, skipping any already on deck.
  const addPreset = (ids) => {
    setSelected(prev => {
      const have = new Set(prev.map(s => s.id));
      const next = [...prev];
      for (const id of ids) {
        if (have.has(id)) continue;
        const canonical = findIngredient(id);
        if (!canonical) continue;
        next.push({ id, canonical });
        have.add(id);
      }
      return next;
    });
  };
  const removeTag = (id) => setSelected(prev => prev.filter(s => s.id !== id));
  const clearAll  = () => setSelected([]);

  // Create a brand-new canonical from the user's typed query. The slug
  // becomes the canonicalId; later enrichment (pending_ingredient_info)
  // fills in metadata. findIngredient() will miss on this id until
  // then, so we attach a synthetic canonical object to the selection
  // so the UI chip renders with the user's name right away.
  //
  // The old PackagingStep that used to pop up here — asking users to
  // enter typical package sizes for admin review — was annihilated in
  // favor of observation-learned sizes (popular_package_sizes RPC,
  // migration 0063). New canonicals start with zero suggestions and
  // the first user's declared size becomes the corpus seed.
  // `creating` stays as a no-op state for back-compat; nothing reads
  // it anymore.
  const [creating, setCreating] = useState(null); // deprecated — kept to avoid ripple

  const createNewFromQuery = (raw) => {
    const name = (raw || "").trim();
    if (name.length < 2) return;
    const id = slugifyIngredientName(name);
    if (!id) return;
    // Commit the new canonical directly — no packaging step, no
    // pending_ingredient_info write from this path. Future users'
    // declared sizes fill the observation corpus (popular_package_sizes
    // RPC) which becomes the chip source in ItemCard / AddItemModal.
    if (singleMode) {
      onLink([id]);
    } else {
      setSelected(prev => {
        if (prev.some(s => s.id === id)) return prev;
        const existing = findIngredient(id);
        return [...prev, {
          id,
          canonical: existing || { id, name, emoji: "✨", category: "user" },
        }];
      });
      setSearch("");
    }
    // Auto-fire AI enrichment in the background — no button press,
    // no admin queue. The edge function now auto-approves the
    // write (edit in 0063 chunk); the user just sees the description
    // / sourcing / tips show up on the card as soon as Claude
    // finishes. Fire-and-forget so slow network doesn't block the
    // commit. Only triggers when the slug ISN'T already in the
    // registry (bundled canonicals are already enriched).
    if (!findIngredient(id)) {
      enrichIngredient({ canonical_id: id }).then(() => {
        refreshDbInfo?.();
      }).catch(err => {
        console.warn("[auto-enrich] failed for", id, err?.message);
      });
    }
  };

  // Called by the packaging step when the user commits (with or
  // without a packaging block). Performs the original commit that
  // createNewFromQuery used to do directly.
  const finalizeCreate = (maybePackaging) => {
    if (!creating) return;
    const { id, name } = creating;
    // The PackagingStep now hands back an object that may contain
    // either packaging sizes, a parentId hub pointer, or both. Older
    // callers got only sizes — this code keeps that contract by
    // splitting the bundle here so each downstream consumer (the
    // pending_ingredient_info insert, the admin auto-approve onLink
    // arg) gets what it expects.
    const packaging = maybePackaging?.sizes ? {
      sizes: maybePackaging.sizes,
      defaultIndex: maybePackaging.defaultIndex,
    } : null;
    const parentId = maybePackaging?.parentId || null;
    const hasAnyPayload = !!packaging || !!parentId;
    if (hasAnyPayload) {
      // Stash as pending_ingredient_info so admin review will promote
      // packaging + parentId into the authoritative ingredient_info row.
      // Fire-and-forget — a transient failure shouldn't block adding
      // the item to pantry. The in-app canonical binding works regardless.
      //
      // For admin callers, onLink below ALSO receives the data as a
      // second arg so their auto-approve path can write it straight
      // to ingredient_info — otherwise the admin's '{_meta}' stub
      // would clobber the pending row we just wrote (auto-approve
      // goes to the same canonical id via a different table, and
      // ingredient_info wins because it's the live read source).
      (async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const info = {};
          if (packaging) info.packaging = packaging;
          if (parentId) info.parentId = parentId;
          await supabase.from("pending_ingredient_info").upsert({
            user_id: user.id,
            slug: id,
            source_name: name,
            info,
            status: "pending",
          }, { onConflict: "user_id,slug" });
        } catch (e) {
          console.error("[linkIngredient] packaging save failed:", e);
        }
      })();
    }
    // Hand the bundle to the caller's onLink so admin auto-approve
    // paths can fold both packaging + parentId into their
    // ingredient_info stub on the same transaction — non-admin
    // callers simply ignore the second arg.
    const extra = hasAnyPayload ? {
      ...(packaging ? { packaging } : {}),
      ...(parentId ? { parentId } : {}),
    } : undefined;
    if (singleMode) {
      onLink([id], extra);
    } else {
      setSelected(prev => {
        if (prev.some(s => s.id === id)) return prev;
        const existing = findIngredient(id);
        return [...prev, {
          id,
          canonical: existing || { id, name, emoji: "✨", category: "user" },
        }];
      });
      setSearch("");
    }

    // XP: +15 for creating a canonical. Only fires for genuinely new
    // canonicals (slug not yet in the bundled registry). The
    // canonical_approved follow-up (+25) lands via DB trigger when the
    // ingredient_info approval row is later written.
    if (!findIngredient(id)) {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { error: xpErr } = await supabase.rpc("award_xp", {
          p_user_id:   user.id,
          p_source:    "canonical_create",
          p_ref_table: "ingredient_info",
          p_ref_id:    null,
        });
        if (xpErr) console.error("[award_xp] canonical_create failed:", xpErr);
      })();
    }

    setCreating(null);
  };

  // Surface a preset whenever the item name / search matches a blend
  // label or any of its component names.
  const presetMatches = useMemo(() => {
    const n = (needle || "").toLowerCase();
    if (!n) return [];
    return BLEND_PRESETS.filter(preset => {
      const resolved = preset.ingredientIds.every(id => !!findIngredient(id));
      if (!resolved) return false;
      if (preset.label.toLowerCase().includes(n)) return true;
      if (preset.description.toLowerCase().includes(n)) return true;
      return preset.ingredientIds.some(id => {
        const ing = findIngredient(id);
        return ing?.name.toLowerCase().includes(n);
      });
    }).slice(0, 4);
  }, [needle]);

  const commit = () => {
    onLink(selected.map(s => s.id));
  };

  // Split into star + likely. Star is the highest-scoring match;
  // the next 3 are "likely." Both come from the SAME sort so we can
  // guarantee top-down descending order.
  const star = topMatches[0] || null;
  const likely = topMatches.slice(1, 4);

  // Shared row renderer for star / likely / search rows. `variant`
  // controls size + border treatment.
  const renderMatchRow = (match, variant) => {
    const { ingredient, score } = match;
    const tone = confidenceTone(score);
    const already = selectedIds.has(ingredient.id);
    const isStar = variant === "star";
    return (
      <button
        key={`${variant}-${ingredient.id}`}
        onClick={() => toggleTag(ingredient.id)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: isStar ? "14px 14px" : "10px 12px",
          background: already
            ? "#1a1608"
            : isStar ? "#1e1a0e" : "#161616",
          border: `1px solid ${
            already ? "#f5c842"
            : isStar ? "#f5c842"
            : `${tone.color}33`
          }`,
          borderRadius: 10,
          cursor: "pointer", textAlign: "left", width: "100%",
        }}
      >
        <span style={{ fontSize: isStar ? 26 : 22, flexShrink: 0 }}>
          {isStar ? "⭐" : (ingredient.emoji || "🥫")}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'DM Sans',sans-serif",
            fontSize: isStar ? 15 : 14,
            color: already ? "#f5c842" : "#f0ece4",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {isStar && (
              <span style={{ fontSize: 18 }}>{ingredient.emoji || "🥫"}</span>
            )}
            <span>{ingredient.name}</span>
          </div>
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            color: isStar ? "#f5c842" : "#555",
            letterSpacing: "0.08em", marginTop: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {isStar
              ? "⭐ BEST MATCH · TAP TO ADD"
              : <>
                  {(ingredient.category || "").toUpperCase()}
                  {ingredient.subcategory ? ` · ${ingredient.subcategory.toUpperCase()}` : ""}
                </>}
          </div>
        </div>
        <span style={{
          fontFamily: "'DM Mono',monospace", fontSize: 9,
          letterSpacing: "0.08em",
          color: already ? "#f5c842" : tone.color,
          background: already ? "#2a2110" : `${tone.color}18`,
          border: `1px solid ${already ? "#3a2f10" : `${tone.color}44`}`,
          padding: "2px 7px", borderRadius: 4, flexShrink: 0,
        }}>
          {already ? "✓ ADDED" : tone.label.toUpperCase()}
        </span>
      </button>
    );
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000dd", zIndex: 340,
      display: "flex", alignItems: "flex-end",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{
        width: "100%", background: "#141414",
        borderRadius: "20px 20px 0 0", padding: "20px 22px 28px",
        maxHeight: "85vh", overflowY: "auto",
      }}>
        <div style={{ width: 36, height: 4, background: "#2a2a2a", borderRadius: 2, margin: "0 auto 16px" }} />

        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
          LINK TO CANONICAL
        </div>
        <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 24, color: "#f0ece4", fontWeight: 300, fontStyle: "italic", margin: "4px 0 6px" }}>
          <span style={{ fontSize: 20, marginRight: 6 }}>{item.emoji || "🥫"}</span>
          "{item.name}"
        </h2>
        <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.5, margin: "0 0 14px" }}>
          {singleMode
            ? "Pick one canonical. Tap a match to commit, or type to search / create."
            : "Tap to add ingredients to this row. Multi-tag for composed items — burritos, pizzas, shredded blends."}
        </p>

        {/* PackagingStep modal removed — no more admin-curated
            packaging. Observation-learned chips from
            popular_package_sizes (migration 0063) replace the
            per-canonical size bank. New canonicals commit
            immediately with no size prompt. */}

        {/* SELECTED — the accumulator. Shown at the very top so the
            user always sees what's on deck before committing. Hidden
            in single mode since every tap commits immediately. */}
        {!singleMode && (
        <div style={{
          padding: "10px 12px", marginBottom: 14,
          background: selected.length ? "#1a1608" : "#0f0f0f",
          border: `1px solid ${selected.length ? "#3a2f10" : "#1e1e1e"}`,
          borderRadius: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: selected.length ? 8 : 0 }}>
            <div style={{ flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 9, color: selected.length ? "#f5c842" : "#666", letterSpacing: "0.12em" }}>
              SELECTED ({selected.length})
            </div>
            {selected.length > 0 && (
              <button
                onClick={clearAll}
                style={{
                  background: "transparent", border: "none",
                  color: "#888", cursor: "pointer",
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  letterSpacing: "0.1em",
                }}
              >
                CLEAR ALL
              </button>
            )}
          </div>
          {selected.length === 0 ? (
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: "#666", fontStyle: "italic" }}>
              No tags yet — tap ⭐ below, or commit empty to keep as free text.
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {selected.map(s => (
                <button
                  key={s.id}
                  onClick={() => removeTag(s.id)}
                  aria-label={`Remove ${s.canonical.name}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 8px 5px 8px",
                    background: "#0a0a0a", border: "1px solid #3a2f10",
                    borderRadius: 16, cursor: "pointer",
                    fontFamily: "'DM Mono',monospace", fontSize: 10,
                    color: "#f5c842", letterSpacing: "0.04em",
                  }}
                >
                  <span style={{ fontSize: 13 }}>{s.canonical.emoji || "🥣"}</span>
                  <span>{s.canonical.name}</span>
                  <span style={{ color: "#888", marginLeft: 2, fontSize: 11 }}>✕</span>
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        {/* ⭐ STAR — the top-scoring canonical for the needle. */}
        {star && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {renderMatchRow(star, "star")}
          </div>
        )}

        {/* LIKELY — next 3 matches, strictly descending by score. */}
        {likely.length > 0 && (
          <>
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 9,
              color: "#888", letterSpacing: "0.12em",
              margin: "4px 0 6px",
            }}>
              OR PICK FROM THESE
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {likely.map(m => renderMatchRow(m, "likely"))}
            </div>
          </>
        )}

        {/* BLEND PRESETS — composite tags applied in one tap. Hidden in
            single mode since blends are inherently multi-tag. */}
        {!singleMode && presetMatches.length > 0 && (
          <>
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 9,
              color: "#7eb8d4", letterSpacing: "0.12em",
              margin: "4px 0 6px",
            }}>
              OR A BLEND · TAP TO ADD ALL
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {presetMatches.map(preset => {
                const already = preset.ingredientIds.filter(id => selectedIds.has(id)).length;
                const allAlready = already === preset.ingredientIds.length;
                return (
                  <button
                    key={preset.id}
                    onClick={() => addPreset(preset.ingredientIds)}
                    disabled={allAlready}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 12px",
                      background: allAlready ? "#0a0f14" : "#0f1620",
                      border: `1px solid ${allAlready ? "#162330" : "#1f3040"}`,
                      borderRadius: 10,
                      cursor: allAlready ? "default" : "pointer",
                      textAlign: "left", width: "100%",
                      opacity: allAlready ? 0.45 : 1,
                    }}
                  >
                    <span style={{ fontSize: 22 }}>{preset.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#f0ece4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {preset.label}
                      </div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#7eb8d4", letterSpacing: "0.05em", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {preset.description}
                      </div>
                    </div>
                    <span style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.08em",
                      color: "#7eb8d4", background: "#1a2430",
                      border: "1px solid #2a3a4a",
                      padding: "2px 7px", borderRadius: 4,
                    }}>
                      {allAlready ? "ADDED" : `+${preset.ingredientIds.length - already}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* SEARCH — catalog on demand. Star/likely keep their top-of-
            fuzzy rank; search lets the user widen when none of those
            are right. */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={star
            ? "Not one of these? Search the registry…"
            : "Search ingredients…"}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "10px 12px", marginBottom: 10,
            background: "#0f0f0f", border: "1px solid #2a2a2a",
            borderRadius: 10, color: "#f0ece4",
            fontFamily: "'DM Sans',sans-serif", fontSize: 14, outline: "none",
          }}
        />

        {/* Search results — only when the user typed something AND
            what they typed reached past the top 4 already shown. The
            guard (slicing from index 4) skips star + 3 likely so
            we don't duplicate rows in the list. Also surfaces a
            "+ CREATE "<query>"" row whenever the registry has no
            exact name match so users can tag with their own
            canonical without waiting for enrichment. */}
        {searchNeedle && (() => {
          const shownIds = new Set([
            ...(star ? [star.ingredient.id] : []),
            ...likely.map(m => m.ingredient.id),
          ]);
          const extras = searchMatches.filter(m => !shownIds.has(m.ingredient.id));
          const nLower = searchNeedle.toLowerCase();
          const exactInRegistry = searchMatches.some(m =>
            m.ingredient.name.toLowerCase() === nLower ||
            m.ingredient.id === slugifyIngredientName(searchNeedle)
          );
          const showCreate = !exactInRegistry && searchNeedle.length >= 2;
          const createButton = showCreate && (
            <button
              onClick={() => createNewFromQuery(searchNeedle)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px",
                background: "#1a1508",
                border: "1px dashed #b8a878",
                borderRadius: 10,
                cursor: "pointer", textAlign: "left", width: "100%",
              }}
            >
              <span style={{ fontSize: 22 }}>✨</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 14,
                  color: "#d4c9ac",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  + CREATE “{searchNeedle}”
                </div>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  color: "#b8a878", letterSpacing: "0.08em", marginTop: 2,
                }}>
                  NEW CANONICAL · ENRICH LATER
                </div>
              </div>
              <span style={{
                fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.08em",
                color: "#b8a878", background: "#2a2110",
                border: "1px solid #3a2f10",
                padding: "2px 7px", borderRadius: 4,
              }}>
                + ADD
              </span>
            </button>
          );
          if (extras.length === 0 && searchMatches.length > 0) {
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                {createButton}
                <div style={{
                  padding: "8px 8px", textAlign: "center",
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                  color: "#666", fontStyle: "italic",
                }}>
                  All close matches are already shown above.
                </div>
              </div>
            );
          }
          if (extras.length === 0) {
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                {createButton}
                {!showCreate && (
                  <div style={{
                    padding: "16px 8px", textAlign: "center",
                    fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                    color: "#666",
                  }}>
                    No matches for "{searchNeedle}". Commit empty to keep as free text.
                  </div>
                )}
              </div>
            );
          }
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {createButton}
              {extras.map(m => renderMatchRow(m, "search"))}
            </div>
          );
        })()}

        {/* Primary action bar. In multi mode: DONE commits the full
            accumulator. In single mode: taps commit immediately, so
            the bar is just CANCEL + a "CLEAR" shortcut when there's
            currently a canonical on the row. */}
        {singleMode ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: "12px",
                background: "#1a1a1a", border: "1px solid #2a2a2a",
                color: "#888", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 12,
                letterSpacing: "0.08em", cursor: "pointer",
              }}
            >
              CANCEL
            </button>
            {selected.length > 0 && (
              <button
                onClick={() => onLink([])}
                style={{
                  flex: 1, padding: "12px",
                  background: "transparent", border: "1px solid #3a1a1a",
                  color: "#d98a8a", borderRadius: 12,
                  fontFamily: "'DM Mono',monospace", fontSize: 12,
                  letterSpacing: "0.08em", cursor: "pointer",
                }}
              >
                CLEAR CANONICAL
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: "12px",
                background: "#1a1a1a", border: "1px solid #2a2a2a",
                color: "#888", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 12,
                letterSpacing: "0.08em", cursor: "pointer",
              }}
            >
              CANCEL
            </button>
            <button
              onClick={commit}
              style={{
                flex: 2, padding: "12px",
                background: "#f5c842", border: "none",
                color: "#111", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600,
                letterSpacing: "0.08em", cursor: "pointer",
              }}
            >
              {selected.length === 0
                ? "KEEP AS FREE TEXT"
                : `DONE · ${selected.length} TAG${selected.length === 1 ? "" : "S"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// PackagingStep — compact inline form shown in LinkIngredient right
// after the user taps + CREATE on a brand-new canonical. Also
// reusable as an EDIT surface (AdminPanel → EditPackagingModal)
// since it fully round-trips the ingredient_info packaging shape.
// Captures the typical package sizes (Spam → 12oz can, rice → 5lb
// bag) so the next person who adds this canonical sees the chips
// instead of typing amount+unit by hand.
//
// Output (maybePackaging handed back via onCommit) is the packaging
// block shape that ingredient_info consumes:
//   { sizes: [{ amount, unit, label }, …], defaultIndex, parentId? }
//
// SKIP commits null (create flow: canonical goes in as-is; edit
// flow: caller should treat as cancel). SAVE commits the block.
// Callers decide whether that block lands in pending_ingredient_info
// (create flow, awaiting admin approval) or directly in
// ingredient_info (admin edit flow).
//
// Props:
//   name     — the canonical's display name (copy only)
//   slug     — the canonical's id (copy only)
//   onCommit — fired with { sizes?, defaultIndex?, parentId? } | null
//   onCancel — dismiss without committing
//   initial  — optional { category, sizes, typicalIdx, parentId } to
//              seed the form for edit flows. Omit for fresh creates.
export function PackagingStep({ name, slug, onCommit, onCancel, initial }) {
  const CATEGORIES = Object.keys(DEFAULT_PACKAGING_BY_CATEGORY);
  // Seed from `initial` when provided; otherwise fall back to the
  // create-flow defaults. Infer category from the initial sizes
  // (matches a CATEGORY whose default sizes look similar) only if
  // we don't have an explicit initial.category.
  const seedCategory = initial?.category
    || (initial?.sizes?.length ? "canned" : "canned");
  const [category, setCategory] = useState(seedCategory);
  const [sizes, setSizes] = useState(() => {
    if (Array.isArray(initial?.sizes) && initial.sizes.length > 0) {
      return initial.sizes.map(s => ({
        amount: Number(s.amount) || 1,
        unit: String(s.unit || "oz"),
        label: s.label || "",
      }));
    }
    return suggestedPackaging(seedCategory).sizes;
  });
  const [typicalIdx, setTypicalIdx] = useState(() => {
    if (typeof initial?.typicalIdx === "number") return initial.typicalIdx;
    if (typeof initial?.defaultIndex === "number") return initial.defaultIndex;
    return suggestedPackaging(seedCategory).defaultIndex;
  });
  // PARENT GROUP — optional pointer to one of the 13 bundled hubs
  // (pasta_hub, bean_hub, etc). Lazy name-inference only in create
  // flow; edit flow honors the existing saved value (even null).
  const [parentId, setParentId] = useState(
    () => initial ? (initial.parentId || null) : inferHubFromName(name)
  );

  // Re-seed sizes when the user picks a new category — keeps the
  // flow fast if they realize they miscategorized.
  const pickCategory = (cat) => {
    setCategory(cat);
    const sug = suggestedPackaging(cat);
    setSizes(sug.sizes);
    setTypicalIdx(sug.defaultIndex);
  };

  const updateSize = (i, patch) => {
    setSizes(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  };
  const removeSize = (i) => {
    setSizes(prev => prev.filter((_, idx) => idx !== i));
    // Clamp the typical pointer if we removed the typical row.
    setTypicalIdx(prev => prev >= i ? Math.max(0, prev - 1) : prev);
  };
  const addSize = () => {
    setSizes(prev => [...prev, { amount: 1, unit: "oz", label: "custom" }]);
  };

  const handleSkip = () => onCommit(null);
  const handleSave = () => {
    const cleaned = sizes
      .filter(s => Number(s.amount) > 0 && String(s.unit || "").trim())
      .map(s => ({
        amount: Number(s.amount),
        unit: String(s.unit).trim(),
        label: String(s.label || "").trim() || null,
      }));
    // Always commit something when there's a parent group OR sizes.
    // A user who only picks a parent (no sizes) still wants the
    // grouping to apply, so we ship the parentId even if sizes
    // ended up empty.
    if (cleaned.length === 0 && !parentId) return onCommit(null);
    const safeTypical = Math.min(Math.max(0, typicalIdx), Math.max(0, cleaned.length - 1));
    const out = {};
    if (cleaned.length > 0) {
      out.sizes = cleaned;
      out.defaultIndex = safeTypical;
    }
    if (parentId) out.parentId = parentId;
    onCommit(out);
  };

  return (
    <div style={{
      marginBottom: 14, padding: "14px 14px 12px",
      background: "#0f0f0f", border: "1px solid #2a2a2a", borderRadius: 12,
    }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 6 }}>
        TYPICAL PACKAGING FOR "{name}"
      </div>
      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.5, marginBottom: 12 }}>
        Pick the sizes this usually comes in. Next person to add "{name}" sees these as taps instead of typing. Skip if you're not sure — you can always come back later.
      </div>

      {/* Parent group — optional pointer to a bundled hub. When set,
          the Kitchen tile view groups this canonical's pantry rows
          under that hub (Pasta, Beans, Rice, etc) alongside the
          bundled members. Pre-seeded by name inference so common
          cases auto-suggest. Tap "—" to clear. */}
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em", marginBottom: 6 }}>
        WRAPS UNDER GROUP {parentId ? <span style={{ color: "#7ec87e" }}>· auto-suggested</span> : <span>· optional</span>}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          onClick={() => setParentId(null)}
          style={{
            padding: "4px 10px",
            background: !parentId ? "#1a1608" : "transparent",
            border: `1px solid ${!parentId ? "#f5c842" : "#2a2a2a"}`,
            color: !parentId ? "#f5c842" : "#666",
            borderRadius: 14,
            fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.05em",
            cursor: "pointer",
          }}
        >
          —
        </button>
        {HUBS.map(h => (
          <button
            key={h.id}
            onClick={() => setParentId(h.id)}
            style={{
              padding: "4px 10px",
              background: parentId === h.id ? "#1a1608" : "transparent",
              border: `1px solid ${parentId === h.id ? "#f5c842" : "#2a2a2a"}`,
              color: parentId === h.id ? "#f5c842" : "#888",
              borderRadius: 14,
              fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.05em",
              cursor: "pointer",
            }}
          >
            {h.emoji} {h.name.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em", marginBottom: 6 }}>
        CATEGORY
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => pickCategory(cat)}
            style={{
              padding: "4px 10px",
              background: category === cat ? "#1a1608" : "transparent",
              border: `1px solid ${category === cat ? "#f5c842" : "#2a2a2a"}`,
              color: category === cat ? "#f5c842" : "#888",
              borderRadius: 14,
              fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.05em",
              cursor: "pointer",
            }}
          >
            {cat.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", letterSpacing: "0.1em", marginBottom: 6 }}>
        SIZES · tap "typical" to mark the default
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {sizes.map((s, i) => {
          const isTypical = i === typicalIdx;
          return (
            <div key={i} style={{
              display: "flex", gap: 6, alignItems: "center",
              padding: "6px 8px",
              background: "#141414",
              border: `1px solid ${isTypical ? "#3a2f10" : "#222"}`,
              borderRadius: 8,
            }}>
              <input
                type="number" inputMode="decimal" min="0" step="any"
                value={s.amount}
                onChange={e => updateSize(i, { amount: e.target.value })}
                style={{
                  width: 58, padding: "4px 6px",
                  background: "#0a0a0a", border: "1px solid #2a2a2a",
                  color: "#f0ece4", borderRadius: 6,
                  fontFamily: "'DM Mono',monospace", fontSize: 12, outline: "none",
                }}
              />
              <input
                value={s.unit || ""}
                onChange={e => updateSize(i, { unit: e.target.value })}
                placeholder="unit"
                style={{
                  width: 66, padding: "4px 6px",
                  background: "#0a0a0a", border: "1px solid #2a2a2a",
                  color: "#f0ece4", borderRadius: 6,
                  fontFamily: "'DM Mono',monospace", fontSize: 11, outline: "none",
                }}
              />
              <input
                value={s.label || ""}
                onChange={e => updateSize(i, { label: e.target.value })}
                placeholder="label (optional)"
                style={{
                  flex: 1, minWidth: 0, padding: "4px 6px",
                  background: "#0a0a0a", border: "1px solid #2a2a2a",
                  color: "#aaa", borderRadius: 6,
                  fontFamily: "'DM Sans',sans-serif", fontSize: 11, outline: "none",
                }}
              />
              <button
                onClick={() => setTypicalIdx(i)}
                title="Mark typical"
                style={{
                  padding: "4px 7px",
                  background: isTypical ? "#f5c842" : "transparent",
                  border: `1px solid ${isTypical ? "#f5c842" : "#2a2a2a"}`,
                  color: isTypical ? "#111" : "#666",
                  borderRadius: 6,
                  fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {isTypical ? "★" : "☆"}
              </button>
              <button
                onClick={() => removeSize(i)}
                disabled={sizes.length <= 1}
                aria-label="remove"
                style={{
                  padding: "4px 7px",
                  background: "transparent",
                  border: "1px solid #2a2a2a",
                  color: sizes.length <= 1 ? "#333" : "#888",
                  borderRadius: 6,
                  fontFamily: "'DM Mono',monospace", fontSize: 11,
                  cursor: sizes.length <= 1 ? "not-allowed" : "pointer",
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={addSize}
        style={{
          padding: "6px 10px", marginBottom: 12,
          background: "transparent", border: "1px dashed #3a3a3a",
          color: "#888", borderRadius: 8,
          fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.06em",
          cursor: "pointer",
        }}
      >
        + ADD SIZE
      </button>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onCancel}
          style={{
            padding: "10px 14px",
            background: "transparent", border: "1px solid #2a2a2a",
            color: "#888", borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.08em",
            cursor: "pointer",
          }}
        >
          ✕ CANCEL
        </button>
        <button
          onClick={handleSkip}
          style={{
            flex: 1,
            padding: "10px 14px",
            background: "#1a1a1a", border: "1px solid #2a2a2a",
            color: "#aaa", borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.08em",
            cursor: "pointer",
          }}
        >
          SKIP
        </button>
        <button
          onClick={handleSave}
          style={{
            flex: 1,
            padding: "10px 14px",
            background: "#f5c842", border: "none",
            color: "#111", borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            cursor: "pointer",
          }}
        >
          SAVE & USE
        </button>
      </div>
    </div>
  );
}

// Cheap name-based hub inference. Maps obvious shape/product names to
// the bundled hub they belong under so the PackagingStep can pre-
// suggest a parent without making the user pick from 13 options.
// Conservative — when none match, returns null and the user can
// still pick manually or leave it ungrouped.
function inferHubFromName(rawName) {
  const n = String(rawName || "").toLowerCase();
  if (!n) return null;
  // Pasta shapes — long tail. Most are user-encountered specialty
  // brands (gemelli, fusilli, rigatoni). Includes the literal
  // "pasta" / "noodle" hint for catch-all SKUs.
  const PASTA_HINTS = [
    "pasta", "noodle", "spaghetti", "linguine", "fettuccine", "penne",
    "rigatoni", "ziti", "macaroni", "fusilli", "rotini", "gemelli",
    "cavatappi", "orecchiette", "bucatini", "cavatelli", "campanelle",
    "conchiglie", "farfalle", "lasagna", "tortellini", "ravioli",
    "gnocchi", "ramen", "udon", "soba", "rice noodle",
  ];
  if (PASTA_HINTS.some(h => n.includes(h))) return "pasta_hub";
  // Beans + legumes
  if (/\b(beans?|chickpeas?|lentils?|garbanzo|cannellini|kidney|pinto|black beans?|navy beans?)\b/.test(n)) return "bean_hub";
  // Rice family
  if (/\b(rice|jasmine|basmati|arborio|risotto)\b/.test(n)) return "rice_hub";
  // Bread family
  if (/\b(bread|loaf|baguette|ciabatta|sourdough|pita|focaccia)\b/.test(n)) return "bread_hub";
  // Cheese family — broad; specific cheeses (cheddar, mozz) are bundled.
  if (/\b(cheese|cheddar|mozzarella|parmesan|pecorino|gruy|brie|gouda|feta|comte|emmental|burrata)\b/.test(n)) return "cheese_hub";
  // Chicken
  if (/\b(chicken|hen|capon|cornish)\b/.test(n)) return "chicken_hub";
  // Beef
  if (/\b(beef|steak|brisket|chuck|sirloin|ribeye|filet|ground beef|hamburger)\b/.test(n)) return "beef_hub";
  // Pork
  if (/\b(pork|bacon|ham|sausage|prosciutto|guanciale|pancetta|chorizo|salami|spam)\b/.test(n)) return "pork_hub";
  // Turkey
  if (/\b(turkey)\b/.test(n)) return "turkey_hub";
  // Seafood
  if (/\b(fish|salmon|tuna|cod|halibut|shrimp|scallop|crab|lobster|sardine|anchov)\b/.test(n)) return "seafood_hub";
  // Milk
  if (/\b(milk|buttermilk|cream)\b/.test(n)) return "milk_hub";
  // Yogurt
  if (/\b(yogurt|yoghurt|greek)\b/.test(n)) return "yogurt_hub";
  // Flour
  if (/\b(flour|meal|semolina)\b/.test(n)) return "flour_hub";
  return null;
}
