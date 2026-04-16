import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { findIngredient, unitLabel } from "../data/ingredients";

// Completion flow shown when the user taps the final "DONE! LOG IT"
// button in CookMode. Phases:
//   1. celebrate      — confetti + "+XP" pulse, "Continue →"
//   2. ingredientsUsed— (Phase 2) what did you actually use / from which
//                       pantry row? Each recipe ingredient shows up as an
//                       editable row; ✕ drops a row the user didn't
//                       actually consume (subs, leftovers, already-out).
//   3. diners         — multi-select family + friends who ate with you
//   4. rating         — 4-face scale (rough / meh / good / nailed)
//   5. notes          — optional free-text, then save
//
// On save, we insert one row into `cook_logs`. The DB's INSERT trigger fans
// out a rating-aware notification to every diner. Positive ratings mark the
// row as a favorite so the Cookbook can surface it immediately.
//
// Props:
//   recipe       — the recipe being logged (needs slug, title, emoji, etc.)
//   userId       — chef's user id (for the row's user_id)
//   family       — [{ otherId, other: { name, ... } }] accepted family
//   friends      — [{ otherId, other: { name, ... } }] accepted friends
//   onFinish()   — called after the row is saved (or the user bailed out).
//                  Typically the parent navigates to the Cookbook here.
//
// Copy is deliberately warm — a finished meal is a celebration, not a form.

const RATINGS = [
  { id: "rough",  emoji: "😬", label: "Rough one",   color: "#ef4444", bg: "#1a0a0a", border: "#3a1a1a" },
  { id: "meh",    emoji: "😐", label: "Meh",         color: "#888",    bg: "#161616", border: "#2a2a2a" },
  { id: "good",   emoji: "😊", label: "Pretty good", color: "#4ade80", bg: "#0f1a0f", border: "#1e3a1e" },
  { id: "nailed", emoji: "🤩", label: "Nailed it",   color: "#f5c842", bg: "#1a1608", border: "#3a2f10" },
];

// Sum up the "xp per cook" weights on the recipe's skills so the celebration
// screen can show a pulsing "+N XP" number. If the recipe has no skill block,
// fall back to a token 10 XP so there's something to land on.
function totalXpForRecipe(recipe) {
  const skills = recipe?.skills;
  if (!Array.isArray(skills) || skills.length === 0) return 10;
  return skills.reduce((sum, s) => sum + (Number(s.xp) || 0), 0);
}

// Build one row per recipe ingredient for the "what did you use" phase.
// Each row carries:
//   recipeIng    — the original entry from recipe.ingredients[]
//   canonical    — the INGREDIENTS registry def (null for untracked free-text)
//   matches      — pantry rows for this ingredient (kind='ingredient' only)
//   selectedRowId— which pantry row the user is drawing from (first match by
//                  default; the multi-match picker will swap it in a follow-up)
//   usedAmount / usedUnit — initial estimate from recipe.qty, editable in the
//                  phase. Untracked rows have both null and a ✕-only card.
//   skipped      — user tapped ✕. Final removal plan ignores skipped rows.
// Pure function — no React, easy to unit test once we add a test harness.
export function buildInitialUsedItems(recipe, pantry) {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const list = Array.isArray(pantry) ? pantry : [];
  return ingredients.map((ing, idx) => {
    const canonical = ing.ingredientId ? findIngredient(ing.ingredientId) : null;
    const matches = ing.ingredientId
      ? list.filter(p =>
          p.ingredientId === ing.ingredientId &&
          (p.kind || "ingredient") === "ingredient" &&
          Number(p.amount) > 0
        )
      : [];
    const defaultMatch = matches[0] || null;
    return {
      idx,
      recipeIng: ing,
      canonical,
      matches,
      skipped: false,
      selectedRowId: defaultMatch?.id || null,
      usedAmount: ing.qty?.amount ?? null,
      usedUnit:   ing.qty?.unit   ?? (defaultMatch?.unit ?? null),
    };
  });
}

export default function CookComplete({ recipe, userId, family = [], friends = [], pantry = [], setPantry, onFinish }) {
  const [phase, setPhase] = useState("celebrate");
  const [selectedDiners, setSelectedDiners] = useState(() => new Set());
  const [rating, setRating] = useState(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // usedItems captures the user's "what did I actually use" decisions across
  // the ingredients-used → confirm-removal → save sequence. Seeded once from
  // the initial pantry snapshot; realtime pantry changes during the flow are
  // intentionally ignored so the user's edits don't flip out from under them.
  const [usedItems, setUsedItems] = useState(() => buildInitialUsedItems(recipe, pantry));

  const xp = useMemo(() => totalXpForRecipe(recipe), [recipe]);
  // Merge family + friends, dedupe by otherId (someone could be tagged as
  // both in weird invite flows), preserve family-first ordering.
  const connections = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const row of [...family, ...friends]) {
      if (!row?.otherId || seen.has(row.otherId)) continue;
      seen.add(row.otherId);
      const name = row.other?.name || "Friend";
      out.push({
        id: row.otherId,
        name,
        first: name.split(/\s+/)[0],
        kind: row.kind,                        // "family" | "friend"
        initial: (name[0] || "?").toUpperCase(),
      });
    }
    return out;
  }, [family, friends]);

  const toggleDiner = (id) => setSelectedDiners(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const save = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      user_id: userId,
      recipe_slug:    recipe.slug,
      recipe_title:   recipe.title,
      recipe_emoji:   recipe.emoji || "🍽️",
      recipe_cuisine: recipe.cuisine || null,
      recipe_category: recipe.category || null,
      rating,
      notes: notes.trim() || null,
      xp_earned: xp,
      diners: [...selectedDiners],
      is_favorite: rating === "good" || rating === "nailed",
    };
    const { error: err } = await supabase.from("cook_logs").insert(payload);
    if (err) {
      console.error("[cook_logs] insert failed:", err);
      setError(err.message || "Couldn't save. Try again?");
      setSaving(false);
      return;
    }
    setSaving(false);
    onFinish?.({ saved: true, rating });
  };

  // ── shared modal shell ───────────────────────────────────────────────────
  const shell = (children) => (
    <div style={{ position:"fixed", inset:0, background:"#080808", zIndex:220, maxWidth:480, margin:"0 auto", display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden" }}>
      {children}
      <style>{`
        @keyframes fall { 0%{transform:translateY(-120px) rotate(0deg); opacity:0} 10%{opacity:1} 100%{transform:translateY(110vh) rotate(520deg); opacity:0.9} }
        @keyframes pulse-xp { 0%,100%{transform:scale(1); text-shadow:0 0 30px #f5c84266} 50%{transform:scale(1.08); text-shadow:0 0 50px #f5c842aa} }
        @keyframes rise { from{opacity:0; transform:translateY(16px)} to{opacity:1; transform:translateY(0)} }
      `}</style>
    </div>
  );

  // ── phase 1: celebrate ───────────────────────────────────────────────────
  if (phase === "celebrate") {
    // 28 confetti pieces, scattered deterministically so they don't re-roll
    // on every re-render (avoids the "flicker" when typing/tapping).
    const confetti = Array.from({ length: 28 }, (_, i) => ({
      left: `${(i * 37) % 100}%`,
      delay: `${(i % 14) * 0.12}s`,
      color: ["#f5c842","#4ade80","#7eb8d4","#f59e0b","#e07a3a","#d4a8c7"][i % 6],
      size: 6 + (i % 4) * 2,
      rot: (i * 47) % 360,
    }));
    return shell(
      <>
        <div style={{ position:"absolute", inset:0, pointerEvents:"none", overflow:"hidden" }}>
          {confetti.map((c, i) => (
            <span key={i} style={{
              position:"absolute", top:-20, left:c.left,
              width:c.size, height:c.size*1.6, background:c.color,
              transform:`rotate(${c.rot}deg)`,
              animation:`fall 2.6s ${c.delay} ease-in forwards`,
              borderRadius:1,
            }} />
          ))}
        </div>
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:40, textAlign:"center", position:"relative", zIndex:1 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4ade80", letterSpacing:"0.18em", marginBottom:14, animation:"rise 0.4s ease" }}>
            ✓ MEAL COMPLETE
          </div>
          <div style={{ fontSize:80, marginBottom:12, animation:"rise 0.5s 0.1s ease backwards" }}>{recipe.emoji || "🍽️"}</div>
          <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:34, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6, animation:"rise 0.5s 0.2s ease backwards" }}>
            You cooked {recipe.title}!
          </h1>
          <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#888", marginBottom:28, animation:"rise 0.5s 0.3s ease backwards" }}>
            That's a whole meal out of your kitchen. Take a breath.
          </p>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:44, color:"#f5c842", fontWeight:600, animation:"pulse-xp 1.6s ease-in-out infinite" }}>
            +{xp} XP
          </div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.15em", marginTop:4, marginBottom:36 }}>
            SKILL POINTS EARNED
          </div>
          <button
            onClick={() => setPhase(usedItems.length > 0 ? "ingredientsUsed" : (connections.length > 0 ? "diners" : "rating"))}
            style={{ width:"100%", maxWidth:320, padding:"16px", background:"#f5c842", color:"#111", border:"none", borderRadius:14, fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer", boxShadow:"0 0 30px #f5c84244" }}
          >
            CONTINUE →
          </button>
        </div>
      </>
    );
  }

  // ── phase 2: what did you actually use? ──────────────────────────────────
  //
  // First screen of the pantry-reconcile flow. Shows every recipe.ingredients
  // row as an editable card; the user can tweak how much they really used,
  // or ✕ any row they didn't consume (sub, already-out, "I used yesterday's
  // leftover chicken"). Untracked free-text ingredients (no ingredientId)
  // render as greyed info-only cards — they don't have a pantry row to
  // decrement, but we still show them so the user sees the whole ingredient
  // list and can ✕ the ones they swapped out mentally.
  //
  // Default behavior: each tracked ingredient pre-fills the recipe's quantity
  // and defaults to the first matching pantry row. The multi-match picker
  // (expiration + location labels) lands in a follow-up commit; for now the
  // card surfaces a "+N more" count so nothing is hidden.
  if (phase === "ingredientsUsed") {
    const setRow = (idx, patch) =>
      setUsedItems(prev => prev.map(r => r.idx === idx ? { ...r, ...patch } : r));

    // Step counter. The downstream ingredients-used → confirm-removal →
    // leftovers chain is still being built; for now we hold the denominator
    // at the existing "diners/rating/notes" counts so the step ratio stays
    // honest in this commit.
    const baseSteps = connections.length > 0 ? 3 : 2;
    const totalSteps = baseSteps + 1;

    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px", overflowY:"auto" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>STEP 1 OF {totalSteps}</div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          What did you use?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:20 }}>
          Tweak the amounts or tap ✕ on anything you swapped out or skipped. We'll pull these from your pantry next.
        </p>

        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10, marginBottom:18 }}>
          {usedItems.map(row => {
            const ing = row.canonical;
            const tracked = Boolean(ing);
            const match = tracked && row.selectedRowId
              ? row.matches.find(m => m.id === row.selectedRowId) || null
              : null;
            const extraMatches = tracked ? Math.max(0, row.matches.length - 1) : 0;
            const emoji = ing?.emoji || row.recipeIng.emoji || "🥣";
            const displayName = ing?.name || row.recipeIng.item || "Ingredient";
            const unitOptions = ing?.units || [];
            const canEditAmount = tracked && row.usedUnit;
            // Card styling: active rows have the yellow underline, skipped
            // rows dim way down so they read as "we won't touch this".
            return (
              <div
                key={row.idx}
                style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"12px 14px",
                  background: row.skipped ? "#0c0c0c" : "#141414",
                  border: `1px solid ${row.skipped ? "#1a1a1a" : (tracked ? "#2a2a2a" : "#1e1e1e")}`,
                  borderRadius:12,
                  opacity: row.skipped ? 0.45 : 1,
                  transition:"all 0.15s",
                }}
              >
                <span style={{ fontSize:22, flexShrink:0 }}>{emoji}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"'Fraunces',serif", fontSize:15, color: row.skipped ? "#555" : "#f0ece4", fontStyle:"italic", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {displayName}
                  </div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", marginTop:2, letterSpacing:"0.05em" }}>
                    {tracked
                      ? (match
                          ? `FROM ${(match.location || "pantry").toUpperCase()}${extraMatches > 0 ? ` · +${extraMatches} MORE` : ""}`
                          : "NOT IN PANTRY")
                      : "UNTRACKED"}
                    {" · RECIPE: "}{row.recipeIng.amount || "—"}
                  </div>
                </div>
                {canEditAmount && !row.skipped ? (
                  <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                    <input
                      type="number" min="0" step="any"
                      value={row.usedAmount ?? ""}
                      onChange={e => setRow(row.idx, { usedAmount: e.target.value === "" ? null : Number(e.target.value) })}
                      style={{ width:56, padding:"6px 8px", background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:13, color:"#f0ece4", textAlign:"right", outline:"none" }}
                    />
                    <select
                      value={row.usedUnit || ""}
                      onChange={e => setRow(row.idx, { usedUnit: e.target.value })}
                      style={{ padding:"6px 4px", background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:8, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#ccc", outline:"none" }}
                    >
                      {unitOptions.map(u => (
                        <option key={u.id} value={u.id}>{unitLabel(ing, u.id)}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <button
                  onClick={() => setRow(row.idx, { skipped: !row.skipped })}
                  aria-label={row.skipped ? "Re-include" : "Skip this ingredient"}
                  style={{
                    width:30, height:30, flexShrink:0,
                    background: row.skipped ? "#1a1608" : "transparent",
                    color: row.skipped ? "#f5c842" : "#666",
                    border:`1px solid ${row.skipped ? "#3a2f10" : "#2a2a2a"}`,
                    borderRadius:8, cursor:"pointer",
                    fontFamily:"'DM Mono',monospace", fontSize:12,
                  }}
                >
                  {row.skipped ? "↺" : "✕"}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ display:"flex", gap:10, marginTop:"auto" }}>
          <button onClick={() => setPhase("celebrate")}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button onClick={() => setPhase(connections.length > 0 ? "diners" : "rating")}
            style={{ flex:2, padding:"14px", background:"#f5c842", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color:"#111", cursor:"pointer", letterSpacing:"0.08em" }}>
            CONTINUE →
          </button>
        </div>
      </div>
    );
  }

  // ── phase 3: who ate with you? ───────────────────────────────────────────
  if (phase === "diners") {
    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px", overflowY:"auto" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          STEP {usedItems.length > 0 ? "2" : "1"} OF {(usedItems.length > 0 ? 1 : 0) + 3}
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          Who ate with you?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:22 }}>
          They'll get a heads-up and can leave their own review later. Skip if you flew solo.
        </p>

        <div style={{ flex:1, display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10, alignContent:"start" }}>
          {connections.map(c => {
            const selected = selectedDiners.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleDiner(c.id)}
                style={{
                  display:"flex", flexDirection:"column", alignItems:"center", gap:6,
                  padding:"14px 6px",
                  background: selected ? "#1e1a0e" : "#161616",
                  border: `1px solid ${selected ? "#f5c842" : "#2a2a2a"}`,
                  borderRadius:14, cursor:"pointer", transition:"all 0.2s",
                }}
              >
                <div style={{
                  width:44, height:44, borderRadius:"50%",
                  background: selected ? "#f5c842" : "#222",
                  color: selected ? "#111" : "#aaa",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:500,
                }}>
                  {c.initial}
                </div>
                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color: selected ? "#f5c842" : "#ccc", textAlign:"center", lineHeight:1.2 }}>
                  {c.first}
                </span>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:8, color:"#666", letterSpacing:"0.1em" }}>
                  {c.kind.toUpperCase()}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={() => setPhase("rating")}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            I ATE ALONE
          </button>
          <button onClick={() => setPhase("rating")}
            style={{ flex:2, padding:"14px", background:"#f5c842", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color:"#111", cursor:"pointer", letterSpacing:"0.08em" }}>
            {selectedDiners.size > 0 ? `CONTINUE WITH ${selectedDiners.size} →` : "CONTINUE →"}
          </button>
        </div>
      </div>
    );
  }

  // ── phase 3: rating ──────────────────────────────────────────────────────
  if (phase === "rating") {
    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          STEP {(usedItems.length > 0 ? 1 : 0) + (connections.length > 0 ? 2 : 1)} OF {(usedItems.length > 0 ? 1 : 0) + (connections.length > 0 ? 3 : 2)}
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          How'd it go?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:28 }}>
          Honest answer — we use this to suggest better meals and learn your taste.
        </p>

        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10 }}>
          {RATINGS.map(r => {
            const active = rating === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setRating(r.id)}
                style={{
                  display:"flex", alignItems:"center", gap:14,
                  padding:"16px 18px",
                  background: active ? r.bg : "#141414",
                  border: `1px solid ${active ? r.color : "#2a2a2a"}`,
                  borderRadius:14, cursor:"pointer", transition:"all 0.2s",
                  textAlign:"left",
                }}
              >
                <span style={{ fontSize:32 }}>{r.emoji}</span>
                <span style={{ flex:1, fontFamily:"'Fraunces',serif", fontSize:18, color: active ? r.color : "#f0ece4", fontStyle:"italic" }}>
                  {r.label}
                </span>
                {active && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: r.color, letterSpacing:"0.1em" }}>SELECTED</span>}
              </button>
            );
          })}
        </div>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={() => setPhase(
              connections.length > 0 ? "diners"
              : usedItems.length > 0 ? "ingredientsUsed"
              : "celebrate"
            )}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor:"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button
            onClick={() => setPhase("notes")}
            disabled={!rating}
            style={{ flex:2, padding:"14px", background: rating?"#f5c842":"#1a1a1a", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color: rating?"#111":"#444", cursor: rating?"pointer":"not-allowed", letterSpacing:"0.08em" }}>
            CONTINUE →
          </button>
        </div>
      </div>
    );
  }

  // ── phase 4: notes + save ────────────────────────────────────────────────
  if (phase === "notes") {
    const ratingDef = RATINGS.find(r => r.id === rating);
    return shell(
      <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"40px 24px 32px" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          STEP {(usedItems.length > 0 ? 1 : 0) + (connections.length > 0 ? 3 : 2)} OF {(usedItems.length > 0 ? 1 : 0) + (connections.length > 0 ? 3 : 2)}
        </div>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:6 }}>
          Any notes?
        </h2>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:20 }}>
          What'd you tweak? What'd you learn? Future-you will thank you.
        </p>

        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={rating === "nailed" ? "e.g. The lime rest time made all the difference..." : rating === "rough" ? "e.g. Pan wasn't hot enough. Next time crank it earlier." : "Anything you'd remember for next time..."}
          rows={6}
          style={{ width:"100%", padding:"14px 16px", background:"#141414", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#f0ece4", outline:"none", resize:"none", boxSizing:"border-box", marginBottom:14 }}
        />

        {/* Summary row — a visual confirm of what we're saving */}
        <div style={{ padding:"12px 14px", background:"#0f0f0f", border:`1px solid ${ratingDef?.border || "#1e1e1e"}`, borderRadius:12, display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
          <span style={{ fontSize:26 }}>{ratingDef?.emoji}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color: ratingDef?.color || "#ccc" }}>
              {ratingDef?.label}
            </div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", marginTop:2 }}>
              {selectedDiners.size > 0
                ? `with ${selectedDiners.size} ${selectedDiners.size === 1 ? "person" : "people"}`
                : "ate alone"}
              {" · "}
              +{xp} XP
            </div>
          </div>
          {(rating === "good" || rating === "nailed") && (
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", background:"#1a1608", border:"1px solid #3a2f10", borderRadius:4, padding:"2px 6px", letterSpacing:"0.1em" }}>
              ★ FAVORITE
            </span>
          )}
        </div>

        {error && (
          <div style={{ marginBottom:12, padding:"10px 12px", background:"#1a0f0f", border:"1px solid #3a1a1a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#f87171" }}>
            {error}
          </div>
        )}

        <div style={{ display:"flex", gap:10, marginTop:"auto" }}>
          <button onClick={() => setPhase("rating")} disabled={saving}
            style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#888", cursor: saving?"not-allowed":"pointer", letterSpacing:"0.08em" }}>
            ← BACK
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{ flex:2, padding:"14px", background: saving?"#1a1a1a":"#f5c842", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, color: saving?"#444":"#111", cursor: saving?"not-allowed":"pointer", letterSpacing:"0.08em" }}>
            {saving ? "SAVING..." : "SAVE TO COOKBOOK →"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
