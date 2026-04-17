import { useEffect, useState } from "react";
import { generateRecipe } from "../lib/generateRecipe";
import { buildAIContext } from "../lib/aiContext";
import { totalTimeMin, difficultyLabel } from "../data/recipes";

// Kick off a Claude-drafted recipe from the user's pantry. Three phases:
//   setup   — pick cuisine / time / notes, tap DRAFT to call the edge fn
//   loading — skeleton while the edge function is running
//   preview — show the generated recipe; four actions below
//
// Preview action bar (four buttons):
//   ↻ REGEN    — back to setup, same prefs
//   SAVE       — onSave(recipe) → persist privately, close
//   📅 SCHED   — onSchedule(recipe) → parent persists (shared=true)
//                and opens SchedulePicker
//   COOK IT    — onSaveAndCook(recipe) → persist + enter CookMode
//
// The parent (QuickCook) owns the shared/private semantics. This
// component just emits events.

const CUISINE_CHIPS = [
  { id: "any",      label: "Any cuisine"   },
  { id: "italian",  label: "Italian"       },
  { id: "french",   label: "French"        },
  { id: "mexican",  label: "Mexican"       },
  { id: "american", label: "American"      },
  { id: "japanese", label: "Japanese"      },
  { id: "thai",     label: "Thai"          },
  { id: "indian",   label: "Indian"        },
];

const TIME_CHIPS = [
  { id: "quick",  label: "≤30 min" },
  { id: "medium", label: "≤60 min" },
  { id: "long",   label: "Long cook" },
];

const DIFFICULTY_CHIPS = [
  { id: "easy",     label: "Easy"    },
  { id: "medium",   label: "Medium"  },
  { id: "advanced", label: "Advanced"},
];

export default function AIRecipe({
  pantry = [],
  profile,          // viewer's profile row (dietary, level, skill_levels, …)
  cookLogs = [],    // viewer's recent cook_log rows for the history summary
  ingredientInfo,   // the useIngredientInfo() context — optional
  onCancel,
  onSave,           // (recipe) => Promise — persist privately, then close
  onSchedule,       // (recipe) => Promise — parent persists + opens SchedulePicker
  onSaveAndCook,    // (recipe) => Promise — existing save + cook path
}) {
  const [phase,  setPhase]  = useState("setup");     // setup | loading | preview | error
  const [recipe, setRecipe] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  // Titles we've already shown the user this session — handed to the
  // edge function on every draft so REGEN produces a genuinely
  // different dish instead of converging on the same one every time.
  const [previousTitles, setPreviousTitles] = useState([]);
  // Per-action busy state so exactly one button shows SAVING… and
  // the other two stay tappable / disabled appropriately.
  const [busy,   setBusy]   = useState(null);         // null | "save" | "schedule" | "cook"

  // Prefs
  const [cuisine,    setCuisine]    = useState("any");
  const [time,       setTime]       = useState("medium");
  const [difficulty, setDifficulty] = useState("medium");
  const [notes,      setNotes]      = useState("");

  const pantryCount = pantry.length;

  const start = async () => {
    setPhase("loading");
    setErrMsg("");
    try {
      // Rich context (profile + history + pantry enrichment) on the
      // first draft of a session — that's when the model benefits
      // most from specific signals. REGEN calls (previousTitles
      // non-empty) strip back to lean so the second draft doesn't
      // re-anchor on the same pairings as the first.
      const isRegen = previousTitles.length > 0;
      const built = buildAIContext({
        pantry,
        profile,
        ingredientInfo,
        cookLogs,
        mode: isRegen ? "lean" : "rich",
      });
      const payload = {
        pantry: built.pantry,
        prefs: { cuisine, time, difficulty, notes: notes.trim() || undefined },
        avoidTitles: previousTitles,
        context: built.context,
      };
      const { recipe: drafted } = await generateRecipe(payload);
      setRecipe(drafted);
      // Remember this draft's title so the next REGEN steers away from
      // it. The edge function truncates to the last 5; we stash the
      // full session history so a user who scrolls through many drafts
      // never sees a repeat from earlier in the same sitting.
      if (drafted?.title) {
        setPreviousTitles(prev => (prev.includes(drafted.title) ? prev : [...prev, drafted.title]));
      }
      setPhase("preview");
    } catch (e) {
      console.error("AI recipe draft failed:", e);
      setErrMsg(e?.message || "Draft failed");
      setPhase("error");
    }
  };

  // Each action guards on busy so a double-tap can't fire twice.
  const handleAction = (kind, cb) => async () => {
    if (!recipe || busy) return;
    setBusy(kind);
    try {
      await cb?.(recipe);
    } catch (e) {
      console.error(`[ai recipe] ${kind} failed:`, e);
    } finally {
      setBusy(null);
    }
  };
  const handleSave     = handleAction("save",     onSave);
  const handleSchedule = handleAction("schedule", onSchedule);
  const handleCookIt   = handleAction("cook",     onSaveAndCook);

  // Header is shared across phases so the back button is always where
  // the user expects it.
  const header = (
    <div style={{ padding: "24px 20px 0", display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={onCancel} style={iconBtn}>←</button>
      <div style={{ flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#c7a8d4", letterSpacing: "0.12em" }}>
        AI RECIPE
      </div>
    </div>
  );

  if (phase === "loading") {
    return (
      <div>
        {header}
        <div style={{ padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 44, animation: "spin 1.2s linear infinite", display: "inline-block" }}>✨</div>
          <div style={{ marginTop: 18, fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic", color: "#f0ece4" }}>
            Drafting from your pantry…
          </div>
          <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#888", lineHeight: 1.5 }}>
            Claude is looking at {pantryCount} pantry {pantryCount === 1 ? "item" : "items"} and your preferences.
          </div>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div>
        {header}
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 44, opacity: 0.6 }}>🫠</div>
          <div style={{ marginTop: 14, fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic", color: "#f0ece4" }}>
            Draft hiccup
          </div>
          <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.5 }}>
            {errMsg || "Something went sideways."}
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={() => setPhase("setup")} style={primaryBtn}>TRY AGAIN</button>
            <button onClick={onCancel} style={secondaryBtn}>CANCEL</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "preview" && recipe) {
    return (
      <div>
        {header}
        <div style={{ padding: "12px 20px 140px" }}>
          <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
            <div style={{ fontSize: 52 }}>{recipe.emoji || "🍽️"}</div>
            <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", margin: "10px 0 4px" }}>
              {recipe.title}
            </h1>
            {recipe.subtitle && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.4 }}>
                {recipe.subtitle}
              </div>
            )}
            <div style={{ marginTop: 6, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.1em" }}>
              {(recipe.cuisine || "").toUpperCase()} · {totalTimeMin(recipe)} MIN · {difficultyLabel(recipe.difficulty).toUpperCase()} · SERVES {recipe.serves}
            </div>
          </div>

          {recipe.aiRationale && (
            // "Why I picked this" banner. Claude cites the concrete
            // signals it used — expiring items, the user's stated
            // preferences, recent cuisine runs, cooking level — so
            // the draft doesn't feel like a black box. Styled softer
            // than the bundled copy so it reads as AI commentary, not
            // part of the recipe.
            <div style={{
              marginTop: 8, padding: "12px 14px",
              background: "linear-gradient(135deg, #1a1624 0%, #141018 100%)",
              border: "1px solid #2e2538",
              borderRadius: 12,
              display: "flex", gap: 10, alignItems: "flex-start",
            }}>
              <div style={{ fontSize: 18, flexShrink: 0, lineHeight: 1 }}>✨</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
                  color: "#c7a8d4", letterSpacing: "0.12em", marginBottom: 4,
                }}>
                  WHY THIS DISH
                </div>
                <div style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                  color: "#d8d2c8", lineHeight: 1.55,
                }}>
                  {recipe.aiRationale}
                </div>
              </div>
            </div>
          )}

          <Section label={`INGREDIENTS · ${recipe.ingredients?.length || 0}`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(recipe.ingredients || []).map((ing, i) => (
                <div key={i} style={{
                  background: "#141414", border: "1px solid #222", borderRadius: 10,
                  padding: "8px 12px", display: "flex", alignItems: "center", gap: 10,
                }}>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#b8a878", minWidth: 60 }}>
                    {ing.amount || "—"}
                  </span>
                  <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4" }}>
                    {ing.item}
                  </span>
                  {ing.ingredientId && (
                    <span style={{ marginLeft: "auto", fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#b8a878" }}>
                      · {ing.ingredientId}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section label={`STEPS · ${recipe.steps?.length || 0}`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(recipe.steps || []).map((step, i) => (
                <div key={step.id || i} style={{
                  background: "#141414", border: "1px solid #222", borderRadius: 12,
                  padding: "12px 14px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 11,
                      background: "#1a1608", border: "1px solid #3a2f10",
                      fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#f5c842",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontFamily: "'Fraunces',serif", fontSize: 15, color: "#f0ece4", fontWeight: 400 }}>
                      {step.title}
                    </span>
                  </div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#bbb", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {step.instruction}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Bottom action bar — four actions. REGEN is narrow (secondary,
            non-destructive); SAVE + SCHEDULE are medium-weight outline
            buttons; COOK IT is the flex-2 yellow CTA. */}
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          maxWidth: 480, margin: "0 auto",
          padding: "14px 20px 22px",
          background: "linear-gradient(180deg, rgba(11,11,11,0) 0%, #0b0b0b 40%)",
          display: "flex", gap: 8,
        }}>
          <button
            onClick={start}
            disabled={!!busy}
            style={{ ...iconActionBtn, opacity: busy ? 0.5 : 1 }}
            title="Draft a different recipe"
          >
            ↻
          </button>
          <button
            onClick={handleSave}
            disabled={!!busy}
            style={{ ...outlineBtn, opacity: busy ? 0.5 : 1 }}
          >
            {busy === "save" ? "…" : "SAVE"}
          </button>
          <button
            onClick={handleSchedule}
            disabled={!!busy}
            style={{ ...outlineBtn, opacity: busy ? 0.5 : 1 }}
          >
            {busy === "schedule" ? "…" : "📅 SCHED"}
          </button>
          <button
            onClick={handleCookIt}
            disabled={!!busy}
            style={{ ...primaryBtn, flex: 2, opacity: busy ? 0.6 : 1 }}
          >
            {busy === "cook" ? "SAVING…" : "COOK IT →"}
          </button>
        </div>
      </div>
    );
  }

  // setup phase
  return (
    <div>
      {header}
      <div style={{ padding: "12px 20px 40px" }}>
        <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 30, fontWeight: 300, fontStyle: "italic", color: "#f0ece4", letterSpacing: "-0.02em", margin: 0 }}>
          Draft from your pantry
        </h1>
        <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888", lineHeight: 1.5 }}>
          {pantryCount === 0
            ? "Your pantry is empty — Claude will lean on staples."
            : `Claude will look at ${pantryCount} pantry ${pantryCount === 1 ? "item" : "items"} and your preferences.`}
        </div>

        <Section label="CUISINE">
          <ChipRow
            value={cuisine}
            onChange={setCuisine}
            options={CUISINE_CHIPS}
            color="#7eb8d4"
          />
        </Section>

        <Section label="TIME">
          <ChipRow
            value={time}
            onChange={setTime}
            options={TIME_CHIPS}
            color="#a8d5a2"
          />
        </Section>

        <Section label="DIFFICULTY">
          <ChipRow
            value={difficulty}
            onChange={setDifficulty}
            options={DIFFICULTY_CHIPS}
            color="#f5c842"
          />
        </Section>

        <Section label="NOTES (OPTIONAL)">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. spicy please, no nuts, make it feel like a weeknight."
            rows={3}
            style={{
              width: "100%", padding: "10px 12px",
              background: "#0f0f0f", border: "1px solid #2a2a2a",
              borderRadius: 10, color: "#f0ece4",
              fontFamily: "'DM Sans',sans-serif", fontSize: 13,
              outline: "none", boxSizing: "border-box", resize: "vertical",
            }}
          />
        </Section>

        <button
          onClick={start}
          style={{
            marginTop: 24, width: "100%", padding: "14px",
            background: "linear-gradient(135deg, #c7a8d4 0%, #a389b8 100%)",
            color: "#111",
            border: "none", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
            letterSpacing: "0.1em", cursor: "pointer",
          }}
        >
          ✨ DRAFT RECIPE
        </button>
      </div>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────

function Section({ label, children }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em", marginBottom: 10 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function ChipRow({ value, onChange, options, color = "#f5c842" }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              padding: "7px 14px",
              background: active ? "#1e1a0e" : "#161616",
              border: `1px solid ${active ? color : "#2a2a2a"}`,
              color: active ? color : "#888",
              borderRadius: 20,
              fontFamily: "'DM Sans',sans-serif", fontSize: 12,
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const iconBtn = {
  background: "#161616", border: "1px solid #2a2a2a",
  borderRadius: 18, width: 34, height: 34,
  color: "#aaa", fontSize: 16, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  lineHeight: 1,
};
const primaryBtn = {
  flex: 1, padding: "14px",
  background: "#f5c842", color: "#111",
  border: "none", borderRadius: 12,
  fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
  letterSpacing: "0.08em", cursor: "pointer",
};
const secondaryBtn = {
  flex: 1, padding: "14px",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  color: "#888", borderRadius: 12,
  fontFamily: "'DM Mono',monospace", fontSize: 12,
  letterSpacing: "0.08em", cursor: "pointer",
};
// Used in the preview action bar — a neutral outline button that sits
// between REGEN (subtle) and COOK IT (yellow CTA) so SAVE / SCHEDULE
// don't fight the primary action for attention.
const outlineBtn = {
  flex: 1, padding: "12px 8px",
  background: "transparent", border: "1px solid #3a3a3a",
  color: "#c7a8d4", borderRadius: 12,
  fontFamily: "'DM Mono',monospace", fontSize: 10,
  fontWeight: 600, letterSpacing: "0.06em",
  cursor: "pointer", whiteSpace: "nowrap",
};
// Narrow square REGEN tap target — frees horizontal space for the
// three action buttons to breathe.
const iconActionBtn = {
  width: 42, padding: "12px 0",
  background: "#1a1a1a", border: "1px solid #2a2a2a",
  color: "#888", borderRadius: 12,
  fontFamily: "'DM Mono',monospace", fontSize: 16,
  cursor: "pointer", flexShrink: 0,
};
