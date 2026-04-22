import { useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";
import { suggestCookInstructions } from "../lib/suggestCookInstructions";

/**
 * CookInstructionsSheet — editor for pantry_items.cook_instructions.
 *
 * Shape matches recipes.reheat (src/data/recipes/schema.js) so the
 * IAteThisSheet walkthrough can render pantry cook-instructions and
 * recipe reheats with the same component. We intentionally expose
 * only the single-method `primary` form here — alternates (alt[])
 * and the safety `note` are nice-to-have but would bloat this MVP
 * editor. Users who need a microwave + stovetop pair for the same
 * row can hand-edit the JSON via the override sheet when we add it;
 * today the common case is one method, one time, one tip.
 *
 *   {
 *     primary: {
 *       method:   "oven"|"microwave"|"stovetop"|"air_fryer"|"toaster_oven"|"cold",
 *       tempF:    number | null,
 *       timeMin:  number,
 *       covered:  boolean | null,
 *       tips:     string | null,
 *     }
 *   }
 *
 * Props:
 *   item       — pantry row (for header context + existing instructions).
 *                Only .name, .emoji, and .cookInstructions are read.
 *   onClose()  — dismiss.
 *   onSave(block | null) — persist. Pass null to clear.
 */

const METHODS = [
  { id: "oven",          label: "Oven",          emoji: "♨",  needsTemp: true  },
  { id: "microwave",     label: "Microwave",     emoji: "📡", needsTemp: false },
  { id: "stovetop",      label: "Stovetop",      emoji: "🔥", needsTemp: false },
  { id: "air_fryer",     label: "Air fryer",     emoji: "🌀", needsTemp: true  },
  { id: "toaster_oven",  label: "Toaster oven",  emoji: "🥯", needsTemp: true  },
  { id: "cold",          label: "Cold (no heat)", emoji: "🧊", needsTemp: false },
];

export default function CookInstructionsSheet({ item, onClose, onSave }) {
  const existing = item?.cookInstructions?.primary || null;

  const [method,  setMethod]  = useState(existing?.method || "oven");
  const [tempF,   setTempF]   = useState(
    existing?.tempF != null ? String(existing.tempF) : "350",
  );
  const [timeMin, setTimeMin] = useState(
    existing?.timeMin != null ? String(existing.timeMin) : "10",
  );
  const [covered, setCovered] = useState(
    existing?.covered === true ? "covered"
    : existing?.covered === false ? "uncovered"
    : "na",
  );
  const [tips,    setTips]    = useState(existing?.tips || "");
  const [saving,  setSaving]  = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error,   setError]   = useState(null);

  const methodSpec = METHODS.find(m => m.id === method) || METHODS[0];

  // AI autofill. Calls the suggest-cook-instructions edge function
  // with the row's identity axes and pre-fills every form field from
  // the response. Covered tri-state maps { true → "covered", false →
  // "uncovered", null → "na" } so the picker reflects what Claude
  // emitted. User can still tweak before SAVE — the button is a
  // starting point, not a commit.
  const suggest = async () => {
    setError(null);
    setSuggesting(true);
    try {
      const { cookInstructions, error: err } = await suggestCookInstructions({
        name:        item?.name,
        canonicalId: item?.ingredientId || item?.canonicalId,
        brand:       item?.brand,
        state:       item?.state,
        cut:         item?.cut,
        category:    item?.category,
      });
      if (err) { setError(err); return; }
      const p = cookInstructions?.primary;
      if (!p) { setError("Couldn't suggest — try again."); return; }
      setMethod(p.method);
      setTempF(p.tempF != null ? String(p.tempF) : "");
      setTimeMin(p.timeMin != null ? String(p.timeMin) : "");
      setCovered(p.covered === true ? "covered"
               : p.covered === false ? "uncovered"
               : "na");
      setTips(typeof p.tips === "string" ? p.tips : "");
    } catch (e) {
      setError(e?.message || "Couldn't suggest — try again.");
    } finally {
      setSuggesting(false);
    }
  };

  const buildBlock = () => {
    const t = Number(timeMin);
    if (!Number.isFinite(t) || t <= 0) {
      return { error: "Time must be a positive number of minutes." };
    }
    const temp = methodSpec.needsTemp ? Number(tempF) : null;
    if (methodSpec.needsTemp && (!Number.isFinite(temp) || temp <= 0)) {
      return { error: `${methodSpec.label} needs a temperature.` };
    }
    const cov = covered === "covered" ? true : covered === "uncovered" ? false : null;
    return {
      block: {
        primary: {
          method,
          tempF: methodSpec.needsTemp ? temp : null,
          timeMin: t,
          covered: cov,
          tips: tips.trim() || null,
        },
      },
    };
  };

  const save = async () => {
    setError(null);
    const { block, error: err } = buildBlock();
    if (err) { setError(err); return; }
    setSaving(true);
    try {
      await onSave?.(block);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await onSave?.(null);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Couldn't clear — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet onClose={onClose} zIndex={Z.picker} label="COOK INSTRUCTIONS">
      <div style={{ padding: "4px 22px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div style={{ fontSize: 40, flexShrink: 0 }}>{item?.emoji || "🍽️"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", fontSize: 20, color: "#f0ece4", lineHeight: 1.15 }}>
              {item?.name || "Ingredient"}
            </div>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#666", marginTop: 4, letterSpacing: "0.12em" }}>
              MINI RECIPE · RENDERED BEFORE "I ATE THIS"
            </div>
          </div>
        </div>

        {/* AI autofill. Calls suggest-cook-instructions which returns
            a single primary block; pre-fills every form input from the
            response. User can tweak before SAVE. Same button pattern
            as AIRecipe — sparkle icon, gold-on-dark palette, explicit
            "AI SUGGEST" label so users understand it's a draft, not
            an authoritative answer. */}
        <button
          type="button"
          onClick={suggest}
          disabled={suggesting || saving}
          style={{
            width: "100%", padding: "12px 14px", marginBottom: 14,
            background: suggesting ? "#1a1a1a" : "#1a1608",
            border: `1px solid ${suggesting ? "#2a2a2a" : "#3a2f10"}`,
            color: suggesting ? "#888" : "#f5c842",
            borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
            letterSpacing: "0.1em", cursor: suggesting || saving ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <span style={{ fontSize: 14 }}>{suggesting ? "⏳" : "✨"}</span>
          {suggesting ? "SUGGESTING…" : existing ? "RE-SUGGEST WITH AI" : "SUGGEST WITH AI"}
        </button>

        {/* Method chips — method drives which of the tempF and
            covered fields are meaningful. Microwave / stovetop hide
            the temp input; cold hides everything but the tips. */}
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 8 }}>
          METHOD
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {METHODS.map(m => {
            const active = m.id === method;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                style={{
                  flex: "1 1 30%", minWidth: 0,
                  padding: "10px 8px",
                  background: active ? "#f5c842" : "#141414",
                  border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                  color: active ? "#111" : "#bbb",
                  borderRadius: 10,
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer", letterSpacing: "0.05em",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}
              >
                <span style={{ fontSize: 13 }}>{m.emoji}</span>
                <span>{m.label.toUpperCase()}</span>
              </button>
            );
          })}
        </div>

        {/* Time + temp. Temp hidden for microwave / stovetop / cold. */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 6 }}>
              TIME · MIN
            </div>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={timeMin}
              onChange={e => setTimeMin(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px",
                background: "#141414", border: "1px solid #2a2a2a", borderRadius: 10,
                fontFamily: "'DM Mono',monospace", fontSize: 15, color: "#f0ece4",
                outline: "none", boxSizing: "border-box", textAlign: "center",
              }}
            />
          </div>
          {methodSpec.needsTemp && (
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 6 }}>
                TEMP · °F
              </div>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="5"
                value={tempF}
                onChange={e => setTempF(e.target.value)}
                style={{
                  width: "100%", padding: "10px 12px",
                  background: "#141414", border: "1px solid #2a2a2a", borderRadius: 10,
                  fontFamily: "'DM Mono',monospace", fontSize: 15, color: "#f0ece4",
                  outline: "none", boxSizing: "border-box", textAlign: "center",
                }}
              />
            </div>
          )}
        </div>

        {/* Covered switch — tri-state (covered / uncovered / N/A). */}
        {method !== "cold" && (
          <>
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 6 }}>
              LID
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {[
                { id: "covered",   label: "Covered" },
                { id: "uncovered", label: "Uncovered" },
                { id: "na",        label: "N/A" },
              ].map(c => {
                const active = c.id === covered;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCovered(c.id)}
                    style={{
                      flex: 1, padding: "8px 0",
                      background: active ? "#f5c842" : "#141414",
                      border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                      color: active ? "#111" : "#bbb",
                      borderRadius: 10,
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      fontWeight: active ? 700 : 400,
                      cursor: "pointer", letterSpacing: "0.06em",
                    }}
                  >
                    {c.label.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 6 }}>
          TIPS
        </div>
        <textarea
          value={tips}
          onChange={e => setTips(e.target.value)}
          placeholder="How to reheat it properly (e.g. add a splash of water before microwaving)"
          rows={3}
          style={{
            width: "100%", padding: "10px 12px", marginBottom: 12,
            background: "#141414", border: "1px solid #2a2a2a", borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4",
            outline: "none", resize: "none", boxSizing: "border-box",
          }}
        />

        {error && (
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "#1a0f0f", border: "1px solid #3a1a1a", borderRadius: 10, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#f87171" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          {existing && (
            <button
              type="button"
              onClick={clear}
              disabled={saving}
              style={{
                flex: 1, padding: "14px",
                background: "#1a1a1a", border: "1px solid #3a1a1a",
                color: "#f87171", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 11,
                letterSpacing: "0.1em", cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              CLEAR
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              flex: existing ? 2 : 1, padding: "14px",
              background: saving ? "#1a1a1a" : "#f5c842",
              border: "none", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
              color: saving ? "#444" : "#111",
              cursor: saving ? "not-allowed" : "pointer",
              letterSpacing: "0.08em",
            }}
          >
            {saving ? "SAVING…" : "SAVE"}
          </button>
        </div>
      </div>
    </ModalSheet>
  );
}
