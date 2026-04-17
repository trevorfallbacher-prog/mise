import { useMemo, useState } from "react";

// Multi-step form for authoring a custom recipe. Produces a recipe
// object matching the bundled schema (src/data/recipes/schema.js) so
// it can be dropped straight into CookMode and saved to user_recipes.
//
// Steps (top-to-bottom, not a tab bar — one long scroll):
//   1. Identity  — title + emoji + cuisine + category + difficulty
//   2. Timing    — prep / cook minutes + serves
//   3. Ingredients (amount + item + optional pantry link)
//   4. Steps     — title + instruction rows, add/remove, reorder
//   5. Review    — SAVE & COOK
//
// Kept simple on purpose. Power-users can edit after saving in a
// follow-up ship; for the first version the only exit is Save & Cook
// or Cancel.

const CUISINE_OPTIONS = [
  "italian", "french", "mexican", "american", "japanese",
  "thai", "indian", "chinese", "mediterranean", "other",
];

const CATEGORY_OPTIONS = [
  "pasta", "eggs", "lunch", "soup", "salad", "chicken",
  "beef", "pork", "fish", "vegetarian", "dessert", "sauce",
  "snack", "other",
];

const EMOJI_SUGGESTIONS = [
  "🍝", "🍲", "🥗", "🍳", "🥞", "🍔", "🌮", "🥘", "🍱",
  "🥟", "🍛", "🍜", "🍣", "🍕", "🥪", "🍰", "🥐", "🍖", "🍗",
];

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function CustomRecipeBuilder({
  pantry = [],
  onCancel,
  onSave,          // (recipe, opts) => Promise — persist, then close
  onSchedule,      // (recipe, opts) => Promise — parent persists + opens SchedulePicker
  onSaveAndCook,   // (recipe, opts) => Promise — existing save + cook path
}) {
  // Identity
  const [title,      setTitle]      = useState("");
  const [emoji,      setEmoji]      = useState("🍽️");
  const [cuisine,    setCuisine]    = useState("other");
  const [category,   setCategory]   = useState("other");
  const [difficulty, setDifficulty] = useState(3);  // 1..10

  // Timing
  const [prep,   setPrep]   = useState(10);
  const [cook,   setCook]   = useState(20);
  const [serves, setServes] = useState(2);

  // Ingredients — each row: { amount, item, ingredientId|null }
  // Start with 3 empty rows so the surface doesn't feel empty.
  const [ingredients, setIngredients] = useState([
    { id: uid(), amount: "", item: "", ingredientId: null },
    { id: uid(), amount: "", item: "", ingredientId: null },
    { id: uid(), amount: "", item: "", ingredientId: null },
  ]);

  // Steps — each row: { title, instruction }
  const [steps, setSteps] = useState([
    { id: uid(), title: "", instruction: "" },
    { id: uid(), title: "", instruction: "" },
  ]);

  // Per-action busy state so each button can show SAVING… without
  // racing its siblings.
  const [busy, setBusy] = useState(null);  // null | "save" | "schedule" | "cook"
  const saving = !!busy;
  // Privacy + admin-review opt-ins. Default private (per-user spec).
  // Submitting to admin implies the author wants the recipe considered
  // for promotion to the bundled library — only meaningful for CUSTOM
  // recipes (AI drafts aren't offered the same lane).
  const [shareWithFamily, setShareWithFamily]  = useState(false);
  const [submitForReview, setSubmitForReview]  = useState(false);

  // Pantry-match suggestions — for each ingredient row, show a
  // compact list of pantry items whose name or canonicalId matches
  // the row's item text. Tapping attaches the pantry canonicalId.
  const pantryLookup = useMemo(() => {
    return pantry
      .filter(p => (p.name || p.canonicalId))
      .map(p => ({
        name: p.name || p.canonicalId,
        canonicalId: p.canonicalId || null,
        category: p.category || "",
      }));
  }, [pantry]);

  const isValid = title.trim().length > 0 &&
                  ingredients.some(i => i.item.trim()) &&
                  steps.some(s => s.title.trim() || s.instruction.trim());

  const updateIngredient = (id, patch) => {
    setIngredients(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  };
  const removeIngredient = (id) => {
    setIngredients(prev => prev.filter(i => i.id !== id));
  };
  const addIngredient = () => {
    setIngredients(prev => [...prev, { id: uid(), amount: "", item: "", ingredientId: null }]);
  };

  const updateStep = (id, patch) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };
  const removeStep = (id) => {
    setSteps(prev => prev.filter(s => s.id !== id));
  };
  const addStep = () => {
    setSteps(prev => [...prev, { id: uid(), title: "", instruction: "" }]);
  };

  // Snapshot the form into a schema.js-shaped recipe object. Pure —
  // called by all three action handlers with the same inputs so the
  // persisted row matches no matter which button fires.
  const buildRecipe = () => {
    const slug = slugify(title) || "my-recipe";
    const cleanIngredients = ingredients
      .filter(i => i.item.trim())
      .map(i => ({
        amount:       i.amount.trim() || null,
        item:         i.item.trim(),
        ingredientId: i.ingredientId || null,
      }));
    const cleanSteps = steps
      .filter(s => s.title.trim() || s.instruction.trim())
      .map((s, idx) => ({
        id:          `step${idx + 1}`,
        title:       s.title.trim() || `Step ${idx + 1}`,
        instruction: s.instruction.trim(),
        icon:        "👨‍🍳",
        timer:       null,
        tip:         null,
      }));
    return {
      slug,
      title:      title.trim(),
      subtitle:   null,
      emoji:      emoji || "🍽️",
      cuisine,
      category,
      difficulty: clamp(difficulty, 1, 10),
      routes:     ["plan"],
      time:       { prep: Number(prep) || 0, cook: Number(cook) || 0 },
      serves:     clamp(serves, 1, 20),
      tools:      [],
      ingredients: cleanIngredients,
      steps:       cleanSteps,
      tags:        [],
    };
  };

  // One handler for all three actions — differs only in the parent
  // callback invoked and the sharing rule (scheduling implies shared=true,
  // everything else respects the toggle).
  const handleAction = (kind) => async () => {
    if (!isValid || busy) return;
    setBusy(kind);
    try {
      const recipe = buildRecipe();
      const opts = {
        shared: kind === "schedule" ? true : shareWithFamily,
        submitForReview,
      };
      if (kind === "save")     await onSave?.(recipe, opts);
      if (kind === "schedule") await onSchedule?.(recipe, opts);
      if (kind === "cook")     await onSaveAndCook?.(recipe, opts);
    } catch (e) {
      console.error(`[custom builder] ${kind} failed:`, e);
    } finally {
      setBusy(null);
    }
  };
  const handleSave     = handleAction("save");
  const handleSchedule = handleAction("schedule");
  const handleCook     = handleAction("cook");

  return (
    <div>
      <div style={{ padding: "24px 20px 0", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onCancel} style={iconBtn}>←</button>
        <div style={{ flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
          CUSTOM RECIPE
        </div>
      </div>

      <div style={{ padding: "12px 20px 120px" }}>
        {/* Identity */}
        <Section label="IDENTITY">
          <Field label="TITLE">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Mom's meatballs"
              style={inputStyle}
            />
          </Field>
          <Field label="EMOJI">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {EMOJI_SUGGESTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: emoji === e ? "#1a1608" : "#161616",
                    border: `1px solid ${emoji === e ? "#f5c842" : "#2a2a2a"}`,
                    fontSize: 20, cursor: "pointer",
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </Field>
          <Row>
            <Field label="CUISINE">
              <select value={cuisine} onChange={e => setCuisine(e.target.value)} style={inputStyle}>
                {CUISINE_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="CATEGORY">
              <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </Row>
          <Field label={`DIFFICULTY · ${difficultyWord(difficulty)}`}>
            <input
              type="range" min={1} max={10} step={1}
              value={difficulty}
              onChange={e => setDifficulty(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#f5c842" }}
            />
          </Field>
        </Section>

        {/* Timing */}
        <Section label="TIMING">
          <Row>
            <Field label="PREP (MIN)">
              <input
                type="number" min={0}
                value={prep}
                onChange={e => setPrep(e.target.value === "" ? "" : Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
            <Field label="COOK (MIN)">
              <input
                type="number" min={0}
                value={cook}
                onChange={e => setCook(e.target.value === "" ? "" : Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
            <Field label="SERVES">
              <input
                type="number" min={1}
                value={serves}
                onChange={e => setServes(e.target.value === "" ? 1 : Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
          </Row>
        </Section>

        {/* Ingredients */}
        <Section label={`INGREDIENTS · ${ingredients.filter(i => i.item.trim()).length}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ingredients.map((ing, idx) => (
              <IngredientRow
                key={ing.id}
                index={idx}
                ing={ing}
                pantry={pantryLookup}
                onChange={(patch) => updateIngredient(ing.id, patch)}
                onRemove={ingredients.length > 1 ? () => removeIngredient(ing.id) : null}
              />
            ))}
          </div>
          <button onClick={addIngredient} style={addBtn}>+ ADD INGREDIENT</button>
        </Section>

        {/* Steps */}
        <Section label={`STEPS · ${steps.filter(s => s.title.trim() || s.instruction.trim()).length}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {steps.map((step, idx) => (
              <StepRow
                key={step.id}
                index={idx}
                step={step}
                onChange={(patch) => updateStep(step.id, patch)}
                onRemove={steps.length > 1 ? () => removeStep(step.id) : null}
              />
            ))}
          </div>
          <button onClick={addStep} style={addBtn}>+ ADD STEP</button>
        </Section>

        {/* Privacy + admin-review toggles. Recipes default private;
            user opts in to family visibility or to submit for admin
            review. Scheduling auto-overrides privacy (see handleAction). */}
        <div style={{ marginTop: 24 }}>
          <Toggle
            label="Share with family"
            hint="They'll see it in the recipe picker and can schedule it."
            checked={shareWithFamily}
            onChange={setShareWithFamily}
          />
          <Toggle
            label="Submit to admin for template review"
            hint="An admin may promote great recipes into the bundled library."
            checked={submitForReview}
            onChange={setSubmitForReview}
          />
        </div>

        {/* Action bar — CANCEL (narrow) + SAVE + SCHEDULE + SAVE & COOK. */}
        <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={saving}
            style={{
              width: 52, padding: "14px 0",
              background: "#1a1a1a", border: "1px solid #2a2a2a",
              color: "#888", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.06em",
              cursor: saving ? "not-allowed" : "pointer", flexShrink: 0,
              opacity: saving ? 0.5 : 1,
            }}
          >
            ✕
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid || saving}
            style={{
              flex: 1, padding: "14px 8px",
              background: "transparent", border: `1px solid ${isValid && !saving ? "#3a3a3a" : "#222"}`,
              color: isValid && !saving ? "#b8a878" : "#555",
              borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
              cursor: isValid && !saving ? "pointer" : "not-allowed",
              whiteSpace: "nowrap",
            }}
          >
            {busy === "save" ? "…" : "SAVE"}
          </button>
          <button
            onClick={handleSchedule}
            disabled={!isValid || saving}
            style={{
              flex: 1, padding: "14px 8px",
              background: "transparent", border: `1px solid ${isValid && !saving ? "#3a3a3a" : "#222"}`,
              color: isValid && !saving ? "#b8a878" : "#555",
              borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
              cursor: isValid && !saving ? "pointer" : "not-allowed",
              whiteSpace: "nowrap",
            }}
          >
            {busy === "schedule" ? "…" : "📅 SCHED"}
          </button>
          <button
            onClick={handleCook}
            disabled={!isValid || saving}
            style={{
              flex: 2, padding: "14px",
              background: isValid && !saving ? "#f5c842" : "#1a1a1a",
              color: isValid && !saving ? "#111" : "#555",
              border: "none", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 11,
              fontWeight: 600, letterSpacing: "0.08em",
              cursor: isValid && !saving ? "pointer" : "not-allowed",
            }}
          >
            {busy === "cook" ? "SAVING…" : "COOK IT →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Subcomponents

// Compact self-labeled toggle used for the privacy + submit-for-review
// opt-ins below the review step. Emits a plain boolean so the parent
// can feed it straight into save opts.
function Toggle({ label, hint, checked, onChange }) {
  return (
    <label style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "10px 12px", marginBottom: 8,
      background: "#121212", border: `1px solid ${checked ? "#3a3019" : "#1e1e1e"}`,
      borderRadius: 12, cursor: "pointer",
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{
          width: 16, height: 16, marginTop: 2, accentColor: "#f5c842",
          cursor: "pointer", flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
          color: checked ? "#f5c842" : "#bbb", letterSpacing: "0.04em",
        }}>
          {label}
        </div>
        {hint && (
          <div style={{
            marginTop: 2, fontFamily: "'DM Sans',sans-serif", fontSize: 11,
            color: "#777", lineHeight: 1.4,
          }}>
            {hint}
          </div>
        )}
      </div>
    </label>
  );
}

function IngredientRow({ index, ing, pantry, onChange, onRemove }) {
  const [suggestOpen, setSuggestOpen] = useState(false);
  const matches = useMemo(() => {
    const q = ing.item.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return pantry
      .filter(p => (p.name || "").toLowerCase().includes(q))
      .slice(0, 4);
  }, [ing.item, pantry]);

  const hasLink = !!ing.ingredientId;

  return (
    <div style={{ background: "#141414", border: "1px solid #222", borderRadius: 12, padding: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", width: 18, textAlign: "center" }}>
          {index + 1}.
        </span>
        <input
          value={ing.amount}
          onChange={e => onChange({ amount: e.target.value })}
          placeholder="2 tbsp"
          style={{ ...inputStyle, width: 90 }}
        />
        <input
          value={ing.item}
          onChange={e => { onChange({ item: e.target.value }); setSuggestOpen(true); }}
          onFocus={() => setSuggestOpen(true)}
          onBlur={() => setTimeout(() => setSuggestOpen(false), 160)}
          placeholder="ingredient"
          style={{ ...inputStyle, flex: 1 }}
        />
        {onRemove && (
          <button onClick={onRemove} style={iconBtnSmall}>×</button>
        )}
      </div>

      {/* Pantry link indicator */}
      {hasLink && (
        <div style={{ marginTop: 6, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#b8a878", letterSpacing: "0.1em" }}>
          LINKED · {ing.ingredientId}
          <button
            onClick={() => onChange({ ingredientId: null })}
            style={{ marginLeft: 8, background: "transparent", border: "none", color: "#666", fontFamily: "'DM Mono',monospace", fontSize: 9, cursor: "pointer" }}
          >
            UNLINK
          </button>
        </div>
      )}

      {/* Pantry suggestions — shown while the item text has a decent
          prefix and there's a match. Tapping attaches the canonicalId. */}
      {suggestOpen && matches.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {matches.map((m, i) => (
            <button
              key={i}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onChange({ item: m.name, ingredientId: m.canonicalId || null });
                setSuggestOpen(false);
              }}
              style={{
                textAlign: "left", background: "#1a1a1a", border: "1px solid #2a2a2a",
                borderRadius: 8, padding: "6px 10px",
                fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#ccc",
                cursor: "pointer",
              }}
            >
              {m.name}
              {m.canonicalId && (
                <span style={{ marginLeft: 8, fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#b8a878" }}>
                  · {m.canonicalId}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ index, step, onChange, onRemove }) {
  return (
    <div style={{ background: "#141414", border: "1px solid #222", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 11,
          background: "#1a1608", border: "1px solid #3a2f10",
          fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#f5c842",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {index + 1}
        </span>
        <input
          value={step.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder="Short step title"
          style={{ ...inputStyle, flex: 1 }}
        />
        {onRemove && (
          <button onClick={onRemove} style={iconBtnSmall}>×</button>
        )}
      </div>
      <textarea
        value={step.instruction}
        onChange={e => onChange({ instruction: e.target.value })}
        placeholder="What happens in this step?"
        rows={3}
        style={{ ...inputStyle, resize: "vertical", width: "100%", boxSizing: "border-box" }}
      />
    </div>
  );
}

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

function Row({ children }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ flex: 1, marginTop: 10 }}>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.12em", marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared style tokens

const inputStyle = {
  padding: "10px 12px",
  background: "#0f0f0f",
  border: "1px solid #2a2a2a",
  borderRadius: 10,
  color: "#f0ece4",
  fontFamily: "'DM Sans',sans-serif",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  width: "100%",
};

const iconBtn = {
  background: "#161616", border: "1px solid #2a2a2a",
  borderRadius: 18, width: 34, height: 34,
  color: "#aaa", fontSize: 16, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  lineHeight: 1,
};
const iconBtnSmall = {
  background: "#1a0a0a", border: "1px solid #3a1a1a",
  borderRadius: 14, width: 26, height: 26,
  color: "#ef4444", fontSize: 14, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  lineHeight: 1,
  flexShrink: 0,
};
const addBtn = {
  marginTop: 10, width: "100%", padding: "10px",
  background: "transparent", border: "1px dashed #2a2a2a",
  color: "#888", borderRadius: 10,
  fontFamily: "'DM Mono',monospace", fontSize: 10,
  letterSpacing: "0.1em", cursor: "pointer",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
function difficultyWord(n) {
  if (n <= 3) return "EASY";
  if (n <= 6) return "MEDIUM";
  return "ADVANCED";
}
