import { useEffect, useState } from "react";
import { generateRecipe } from "../lib/generateRecipe";
import { totalTimeMin, difficultyLabel } from "../data/recipes";

// Kick off a Claude-drafted recipe from the user's pantry. Three phases:
//   setup   — pick cuisine / time / notes, tap DRAFT to call the edge fn
//   loading — skeleton while the edge function is running
//   preview — show the generated recipe; REGENERATE / COOK IT
//
// When COOK IT is tapped, we hand the recipe to the parent
// (QuickCook) via onSaveAndCook, which persists to user_recipes and
// enters CookMode.

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

export default function AIRecipe({ pantry = [], onCancel, onSaveAndCook }) {
  const [phase,  setPhase]  = useState("setup");     // setup | loading | preview | error
  const [recipe, setRecipe] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [saving, setSaving] = useState(false);

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
      const payload = {
        pantry: pantry.map(p => ({
          name:        p.name || "",
          canonicalId: p.canonicalId || null,
          amount:      p.amount ?? null,
          unit:        p.unit ?? null,
          category:    p.category ?? null,
        })),
        prefs: { cuisine, time, difficulty, notes: notes.trim() || undefined },
      };
      const { recipe: drafted } = await generateRecipe(payload);
      setRecipe(drafted);
      setPhase("preview");
    } catch (e) {
      console.error("AI recipe draft failed:", e);
      setErrMsg(e?.message || "Draft failed");
      setPhase("error");
    }
  };

  const handleCookIt = async () => {
    if (!recipe || saving) return;
    setSaving(true);
    try {
      await onSaveAndCook?.(recipe);
    } finally {
      setSaving(false);
    }
  };

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

        {/* Bottom action bar — pinned so the call-to-action is always reachable */}
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          maxWidth: 480, margin: "0 auto",
          padding: "14px 20px 22px",
          background: "linear-gradient(180deg, rgba(11,11,11,0) 0%, #0b0b0b 40%)",
          display: "flex", gap: 10,
        }}>
          <button onClick={() => setPhase("setup")} style={secondaryBtn}>
            ↻ REGEN
          </button>
          <button
            onClick={handleCookIt}
            disabled={saving}
            style={{ ...primaryBtn, flex: 2, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? "SAVING…" : "COOK IT →"}
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
