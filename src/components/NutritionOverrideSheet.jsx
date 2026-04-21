import { useMemo, useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";
import { findIngredient } from "../data/ingredients";
import { validateNutrition } from "../lib/nutrition";

/**
 * NutritionOverrideSheet — manual macro entry for a specific pantry row.
 *
 * Tier-1 of the resolver reads `pantry_items.nutrition_override` first,
 * before brand / canonical / bundled (see src/lib/nutrition.js:33-34).
 * This sheet is the escape hatch for when every other tier fails: AI
 * enrichment returned no macros, no brand row exists, the bundled
 * fallback is wrong for this specific SKU. User types the numbers
 * straight off the label, we validate against the same ceilings the
 * brand_nutrition write gate uses, and the tally picks up the
 * correction immediately via pantry realtime.
 *
 * Props:
 *   item      — the pantry row (has nutritionOverride + canonicalId)
 *   onClose() — dismiss
 *   onSave(override)  — (block|null) => Promise | void — parent calls
 *                       onUpdate({ nutritionOverride: block }) and
 *                       closes the sheet on success. Null clears the
 *                       override so lower tiers regain authority.
 */
const PER_OPTIONS = [
  { id: "100g",    label: "Per 100g",    sub: "Weight-based (flour, meat, cheese)" },
  { id: "count",   label: "Per item",    sub: "Count-based (1 egg, 1 apple)" },
  { id: "serving", label: "Per serving", sub: "Label's serving size (1 cup, 2 tbsp)" },
];

export default function NutritionOverrideSheet({ item, onClose, onSave }) {
  const existing = item?.nutritionOverride || null;
  const canonical = item?.ingredientId ? findIngredient(item.ingredientId) : null;
  // Sensible defaults for a new override: pick `per` based on the
  // canonical's unit ladder. Mass-based canonicals default to 100g;
  // count-based to "count"; everything else falls to "serving". Lets
  // the user skip one tap in the common case.
  const suggestedPer = useMemo(() => {
    if (existing?.per) return existing.per;
    if (!canonical) return "100g";
    const ids = (canonical.units || []).map(u => u.id);
    if (ids.includes("g") || ids.includes("ml")) return "100g";
    if (ids.includes("count") && !ids.includes("g")) return "count";
    return "100g";
  }, [canonical, existing]);

  const [per, setPer] = useState(suggestedPer);
  const [servingG,   setServingG]   = useState(existing?.serving_g ?? "");
  const [kcal,       setKcal]       = useState(existing?.kcal ?? "");
  const [proteinG,   setProteinG]   = useState(existing?.protein_g ?? "");
  const [fatG,       setFatG]       = useState(existing?.fat_g ?? "");
  const [carbG,      setCarbG]      = useState(existing?.carb_g ?? "");
  const [fiberG,     setFiberG]     = useState(existing?.fiber_g ?? "");
  const [sodiumMg,   setSodiumMg]   = useState(existing?.sodium_mg ?? "");
  const [sugarG,     setSugarG]     = useState(existing?.sugar_g ?? "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  const buildBlock = () => {
    const toNum = (v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const block = { per };
    if (per === "serving") {
      const sg = toNum(servingG);
      if (sg !== undefined) block.serving_g = sg;
    }
    const mapPairs = [
      ["kcal",      kcal],
      ["protein_g", proteinG],
      ["fat_g",     fatG],
      ["carb_g",    carbG],
      ["fiber_g",   fiberG],
      ["sodium_mg", sodiumMg],
      ["sugar_g",   sugarG],
    ];
    for (const [k, v] of mapPairs) {
      const n = toNum(v);
      if (n !== undefined) block[k] = n;
    }
    return block;
  };

  const save = async () => {
    setError(null);
    const block = buildBlock();
    const check = validateNutrition(block);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setSaving(true);
    try {
      await onSave?.(block);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Couldn't save — try again.");
      setSaving(false);
    }
  };

  const clear = async () => {
    setError(null);
    setSaving(true);
    try {
      // Null clears the override, returning authority to the resolver's
      // lower tiers (brand → canonical → bundled). Useful when the
      // user typed an override in error and wants the automatic
      // resolution back.
      await onSave?.(null);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Couldn't clear — try again.");
      setSaving(false);
    }
  };

  return (
    <ModalSheet onClose={onClose} zIndex={Z.picker} label="TYPE IT IN">
      <div style={{ padding: "4px 22px 18px" }}>
        <h2 style={{
          fontFamily: "'Fraunces',serif", fontSize: 24,
          fontStyle: "italic", color: "#f0ece4",
          fontWeight: 400, margin: "2px 0 6px",
        }}>
          Nutrition for {item?.name || "this jar"}
        </h2>
        <p style={{
          fontFamily: "'DM Sans',sans-serif", fontSize: 12,
          color: "#888", lineHeight: 1.5, margin: "0 0 16px",
        }}>
          Type the numbers off the label. Overrides every other source
          for this specific jar until cleared.
        </p>

        {/* PER selector — picks the basis unit for every number below. */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888", letterSpacing: "0.12em", marginBottom: 8 }}>
            BASIS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {PER_OPTIONS.map(opt => {
              const active = opt.id === per;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPer(opt.id)}
                  style={{
                    padding: "10px 14px",
                    background: active ? "#0f1620" : "#141414",
                    border: `1px solid ${active ? "#7eb8d4" : "#2a2a2a"}`,
                    color: active ? "#7eb8d4" : "#ccc",
                    borderRadius: 10,
                    fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                    textAlign: "left", cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: active ? 700 : 500 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: active ? "#5c8fa8" : "#666", marginTop: 2 }}>{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Serving-g input — only when per=serving. */}
        {per === "serving" && (
          <div style={{ marginBottom: 14 }}>
            <LabelKicker>SERVING SIZE (GRAMS)</LabelKicker>
            <NumberInput
              value={servingG}
              onChange={setServingG}
              placeholder="e.g. 30"
              step="1"
            />
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", marginTop: 4, letterSpacing: "0.06em" }}>
              Weigh one serving, or read "Serving Size 30g" off the label.
            </div>
          </div>
        )}

        {/* Macro grid. kcal is required; everything else optional. */}
        <div style={{ marginBottom: 14 }}>
          <LabelKicker>CALORIES · REQUIRED</LabelKicker>
          <NumberInput value={kcal} onChange={setKcal} placeholder="kcal" step="1" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <Field label="PROTEIN (g)" value={proteinG} onChange={setProteinG} />
          <Field label="FAT (g)"     value={fatG}     onChange={setFatG} />
          <Field label="CARBS (g)"   value={carbG}    onChange={setCarbG} />
          <Field label="FIBER (g)"   value={fiberG}   onChange={setFiberG} />
          <Field label="SUGAR (g)"   value={sugarG}   onChange={setSugarG} />
          <Field label="SODIUM (mg)" value={sodiumMg} onChange={setSodiumMg} />
        </div>

        {error && (
          <div style={{
            marginBottom: 12, padding: "10px 12px",
            background: "#1a0f0f", border: "1px solid #3a1a1a",
            borderRadius: 10,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#f87171",
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          {existing && (
            <button
              type="button"
              onClick={clear}
              disabled={saving}
              style={{
                flex: 1, padding: "14px",
                background: "transparent", border: "1px solid #3a1a1a",
                color: "#ef4444", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 11,
                letterSpacing: "0.08em", cursor: saving ? "not-allowed" : "pointer",
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
            {saving ? "SAVING…" : (existing ? "UPDATE" : "SAVE")}
          </button>
        </div>
      </div>
    </ModalSheet>
  );
}

function LabelKicker({ children }) {
  return (
    <div style={{
      fontFamily: "'DM Mono',monospace", fontSize: 10,
      color: "#888", letterSpacing: "0.12em", marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <LabelKicker>{label}</LabelKicker>
      <NumberInput value={value} onChange={onChange} placeholder="—" step="0.1" />
    </div>
  );
}

function NumberInput({ value, onChange, placeholder, step = "0.1" }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min="0"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "12px 14px",
        background: "#141414", border: "1px solid #2a2a2a", borderRadius: 10,
        fontFamily: "'DM Mono',monospace", fontSize: 14, color: "#f0ece4",
        outline: "none", boxSizing: "border-box",
      }}
    />
  );
}
