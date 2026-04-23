import { useCallback, useMemo, useRef, useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";
import { findIngredient } from "../data/ingredients";
import { validateNutrition, sourceBadge } from "../lib/nutrition";

/**
 * NutritionOverrideSheet — the review + edit surface for a specific
 * pantry row's nutrition.
 *
 * Serves two paths:
 *
 *   1. MANUAL — user taps "type it in" on an empty-nutrition card and
 *      fills the form by hand. onSave is called with their block on
 *      submit. (Original path; still the fallback when scan fails.)
 *
 *   2. SCAN REVIEW — `NutritionLabelScanner` sends a Nutrition Facts
 *      photo to the `scan-nutrition-label` edge function, pre-fills
 *      this sheet via `initialValues`, and passes along `packageInfo`
 *      (serving size, servings per container, net weight) + `provenance`
 *      + `photoPreviewUrl` + `scanId`. The user confirms or tweaks,
 *      and SAVE writes both the pantry override AND (iff the user
 *      didn't hand-edit too much) teaches `brand_nutrition` at the
 *      shared tier.
 *
 * Props:
 *   item             — pantry row ({ name, ingredientId, brand, barcodeUpc, nutritionOverride, ... })
 *   onClose()        — dismiss
 *   onSave(payload)  — (payload|null) => Promise | void — called with
 *                      the shaped payload below on save, or null to
 *                      clear an existing override.
 *   initialValues    — optional nutrition block to seed the form with
 *                      (takes precedence over item.nutritionOverride).
 *                      Extra keys (saturated_fat_g, …) populate the
 *                      MORE NUTRIENTS section.
 *   initialPer       — optional basis override ("100g"|"count"|"serving"),
 *                      used by the scan path which knows the label's
 *                      declared basis.
 *   provenance       — "label_scan" | null — triggers the scan-badge
 *                      treatment + dynamic sheet label.
 *   packageInfo      — { serving_g, servings_per_container, net_weight }
 *                      | null — when present, a banner offers to also
 *                      fill in pantry_items.amount / unit / max from
 *                      the scanned package size.
 *   photoPreviewUrl  — optional object URL of the scanned photo for
 *                      visual context in the banner.
 *   scanId           — optional scan UUID, passed back in onSave for
 *                      audit-trail stamping on brand_nutrition.source_id.
 *
 * Save payload (new shape):
 *   {
 *     nutrition:   <validated block>,
 *     packageInfo: <same as prop when user kept the checkbox on, else null>,
 *     provenance:  <"label_scan" | null>,
 *     dirtyCount:  <number of fields user hand-edited from initial>,
 *     scanId:      <string | null>,
 *   }
 * or
 *   null — clear the override and return to lower resolver tiers.
 */
const PER_OPTIONS = [
  { id: "100g",    label: "Per 100g",    sub: "Weight-based (flour, meat, cheese)" },
  { id: "count",   label: "Per item",    sub: "Count-based (1 egg, 1 apple)" },
  { id: "serving", label: "Per serving", sub: "Label's serving size (1 cup, 2 tbsp)" },
];

const SCAN_GOLD = "#f5c842";

export default function NutritionOverrideSheet({
  item,
  onClose,
  onSave,
  initialValues = null,
  initialPer = null,
  initialIngredientsText = null,
  initialAllergens = null,
  provenance = null,
  packageInfo = null,
  photoPreviewUrl = null,
  scanId = null,
}) {
  const isScan = provenance === "label_scan";
  const existing = item?.nutritionOverride || null;
  // Seed priority: explicit initialValues (scan path) > existing
  // pantry override (edit path) > empty (fresh manual entry).
  const seed = initialValues || existing || null;
  const canonical = item?.ingredientId ? findIngredient(item.ingredientId) : null;

  // Sensible defaults for a new override: pick `per` based on the
  // canonical's unit ladder when nothing is seeded. Mass-based →
  // 100g; count-based → count; else 100g. Saves one tap in the
  // common case. Scan path overrides with initialPer when the label
  // declared a specific basis.
  const suggestedPer = useMemo(() => {
    if (initialPer) return initialPer;
    if (seed?.per) return seed.per;
    if (!canonical) return "100g";
    const ids = (canonical.units || []).map(u => u.id);
    if (ids.includes("g") || ids.includes("ml")) return "100g";
    if (ids.includes("count") && !ids.includes("g")) return "count";
    return "100g";
  }, [canonical, seed, initialPer]);

  const [per, setPer]               = useState(suggestedPer);
  const [servingG, setServingG]     = useState(seed?.serving_g ?? "");
  const [kcal, setKcal]             = useState(seed?.kcal ?? "");
  const [proteinG, setProteinG]     = useState(seed?.protein_g ?? "");
  const [fatG, setFatG]             = useState(seed?.fat_g ?? seed?.total_fat_g ?? "");
  const [carbG, setCarbG]           = useState(seed?.carb_g ?? "");
  const [fiberG, setFiberG]         = useState(seed?.fiber_g ?? "");
  const [sodiumMg, setSodiumMg]     = useState(seed?.sodium_mg ?? "");
  const [sugarG, setSugarG]         = useState(seed?.sugar_g ?? seed?.total_sugar_g ?? "");
  // FDA-label additions — populated from the scan payload.
  const [satFatG, setSatFatG]       = useState(seed?.saturated_fat_g ?? "");
  const [transFatG, setTransFatG]   = useState(seed?.trans_fat_g ?? "");
  const [cholesterolMg, setCholesterolMg] = useState(seed?.cholesterol_mg ?? "");
  const [addedSugarG, setAddedSugarG]     = useState(seed?.added_sugar_g ?? "");
  const [vitaminDMcg, setVitaminDMcg]     = useState(seed?.vitamin_d_mcg ?? "");
  const [calciumMg, setCalciumMg]         = useState(seed?.calcium_mg ?? "");
  const [ironMg, setIronMg]               = useState(seed?.iron_mg ?? "");
  const [potassiumMg, setPotassiumMg]     = useState(seed?.potassium_mg ?? "");

  // Ingredients panel + allergens — sibling metadata on the same
  // per-jar nutrition jsonb, and shared columns on brand_nutrition.
  // Seed from: explicit initialIngredientsText (scan path) >
  //             existing override's ingredients_text >
  //             empty string.
  const [ingredientsText, setIngredientsText] = useState(
    initialIngredientsText ?? seed?.ingredients_text ?? "",
  );
  const [allergens, setAllergens] = useState(
    Array.isArray(initialAllergens) && initialAllergens.length
      ? initialAllergens
      : (Array.isArray(seed?.allergens) ? seed.allergens : []),
  );
  const [ingredientsEditing, setIngredientsEditing] = useState(false);

  // Collapse "MORE NUTRIENTS" unless any extended field already has
  // a value (scan path or prior detailed entry).
  const anyMicroSeeded =
    satFatG !== "" || transFatG !== "" || cholesterolMg !== "" ||
    addedSugarG !== "" || vitaminDMcg !== "" || calciumMg !== "" ||
    ironMg !== "" || potassiumMg !== "";
  const [showMore, setShowMore] = useState(anyMicroSeeded);

  // Apply-package-info checkbox (scan path only). Defaults ON when
  // the scan surfaced a net weight or serving size — most users
  // want the package filled in along with the nutrition.
  const hasUsefulPackageInfo =
    !!packageInfo && (packageInfo.net_weight || packageInfo.serving_g);
  const [applyPackageInfo, setApplyPackageInfo] = useState(
    hasUsefulPackageInfo && (!item?.amount || Number(item.amount) === 0),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  // Dirty tracking — count how many fields the user has edited vs
  // the seed. Passed back in the save payload so the parent can
  // decide whether to teach brand_nutrition (skip when the user
  // hand-corrected 3+ values: their numbers probably aren't
  // canonical for the brand).
  const seedSnapshotRef = useRef({
    per: suggestedPer,
    serving_g: seed?.serving_g ?? "",
    kcal: seed?.kcal ?? "",
    protein_g: seed?.protein_g ?? "",
    fat_g: seed?.fat_g ?? seed?.total_fat_g ?? "",
    carb_g: seed?.carb_g ?? "",
    fiber_g: seed?.fiber_g ?? "",
    sodium_mg: seed?.sodium_mg ?? "",
    sugar_g: seed?.sugar_g ?? seed?.total_sugar_g ?? "",
    saturated_fat_g: seed?.saturated_fat_g ?? "",
    trans_fat_g: seed?.trans_fat_g ?? "",
    cholesterol_mg: seed?.cholesterol_mg ?? "",
    added_sugar_g: seed?.added_sugar_g ?? "",
    vitamin_d_mcg: seed?.vitamin_d_mcg ?? "",
    calcium_mg: seed?.calcium_mg ?? "",
    iron_mg: seed?.iron_mg ?? "",
    potassium_mg: seed?.potassium_mg ?? "",
  });

  const countDirty = useCallback(() => {
    const snap = seedSnapshotRef.current;
    const cur = {
      per, serving_g: servingG, kcal,
      protein_g: proteinG, fat_g: fatG, carb_g: carbG, fiber_g: fiberG,
      sodium_mg: sodiumMg, sugar_g: sugarG,
      saturated_fat_g: satFatG, trans_fat_g: transFatG,
      cholesterol_mg: cholesterolMg, added_sugar_g: addedSugarG,
      vitamin_d_mcg: vitaminDMcg, calcium_mg: calciumMg,
      iron_mg: ironMg, potassium_mg: potassiumMg,
    };
    let n = 0;
    for (const [k, v] of Object.entries(cur)) {
      if (String(v) !== String(snap[k])) n++;
    }
    return n;
  }, [
    per, servingG, kcal, proteinG, fatG, carbG, fiberG, sodiumMg, sugarG,
    satFatG, transFatG, cholesterolMg, addedSugarG,
    vitaminDMcg, calciumMg, ironMg, potassiumMg,
  ]);

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
    const pairs = [
      ["kcal",            kcal],
      ["protein_g",       proteinG],
      ["fat_g",           fatG],
      ["total_fat_g",     fatG],       // alias — validateNutrition mirrors the pair
      ["carb_g",          carbG],
      ["fiber_g",         fiberG],
      ["sodium_mg",       sodiumMg],
      ["sugar_g",         sugarG],
      ["total_sugar_g",   sugarG],     // alias
      ["saturated_fat_g", satFatG],
      ["trans_fat_g",     transFatG],
      ["cholesterol_mg",  cholesterolMg],
      ["added_sugar_g",   addedSugarG],
      ["vitamin_d_mcg",   vitaminDMcg],
      ["calcium_mg",      calciumMg],
      ["iron_mg",         ironMg],
      ["potassium_mg",    potassiumMg],
    ];
    for (const [k, v] of pairs) {
      const n = toNum(v);
      if (n !== undefined) block[k] = n;
    }
    // Ingredients panel metadata — rides on the same jsonb so a
    // single write populates everything. Trimmed to collapse
    // accidental paste-noise; empty string = not-set.
    const trimmedIngredients = (ingredientsText || "").trim();
    if (trimmedIngredients) block.ingredients_text = trimmedIngredients;
    if (Array.isArray(allergens) && allergens.length) {
      block.allergens = allergens.map(a => String(a).trim().toLowerCase()).filter(Boolean);
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
      await onSave?.({
        nutrition:       block,
        packageInfo:     applyPackageInfo ? packageInfo : null,
        ingredientsText: (ingredientsText || "").trim() || null,
        allergens:       Array.isArray(allergens) && allergens.length ? allergens : null,
        provenance:      isScan ? "label_scan" : null,
        dirtyCount:      countDirty(),
        scanId:          scanId || null,
      });
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
      await onSave?.(null);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Couldn't clear — try again.");
      setSaving(false);
    }
  };

  const badge = sourceBadge("label_scan");
  const sheetLabel = isScan ? "REVIEW SCAN" : "TYPE IT IN";
  const title = isScan
    ? `We read this label`
    : `Nutrition for ${item?.name || "this jar"}`;
  const subtitle = isScan
    ? "Tap any value if it looks off, or just hit SAVE — we'll teach every other household this brand too."
    : "Type the numbers off the label. Overrides every other source for this specific jar until cleared.";

  return (
    <ModalSheet onClose={onClose} zIndex={Z.picker} label={sheetLabel}>
      <style>{SHEET_KEYFRAMES}</style>
      <div style={{ padding: "4px 22px 18px" }}>
        <h2 style={{
          fontFamily: "'Fraunces',serif", fontSize: 24,
          fontStyle: "italic", color: "#f0ece4",
          fontWeight: 400, margin: "2px 0 6px",
        }}>
          {title}
        </h2>
        <p style={{
          fontFamily: "'DM Sans',sans-serif", fontSize: 12,
          color: "#888", lineHeight: 1.5, margin: "0 0 16px",
        }}>
          {subtitle}
        </p>

        {/* Scan provenance banner — photo thumb + SCAN badge. Subtle
            drop-in animation so it reads as "new information we just
            gathered", not static chrome. */}
        {isScan && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            marginBottom: 16, padding: "10px 12px",
            background: "linear-gradient(135deg, #1e1a0e 0%, #1a1508 100%)",
            border: `1px solid ${badge.color}44`,
            borderRadius: 12,
            animation: "nutritionScanDrop 360ms cubic-bezier(0.16, 1, 0.3, 1) 80ms backwards",
          }}>
            {photoPreviewUrl ? (
              <img
                src={photoPreviewUrl}
                alt=""
                style={{
                  width: 44, height: 44,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: `1px solid ${badge.color}88`,
                  flexShrink: 0,
                  boxShadow: `0 0 18px ${badge.color}33`,
                }}
              />
            ) : (
              <span style={{ fontSize: 22 }}>📸</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "'DM Mono',monospace", fontSize: 9,
                color: badge.color, letterSpacing: "0.12em",
                fontWeight: 700,
              }}>
                🤖 SCANNED · {badge.label}
              </div>
              <div style={{
                fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                color: "#c8c4bd", marginTop: 2, lineHeight: 1.35,
              }}>
                Values read from the label photo.
              </div>
            </div>
          </div>
        )}

        {/* Package info banner (scan path) — offers to also fill in
            pantry_items.amount / unit / max from the scanned package
            size. Checkbox defaults ON when the pantry row is empty
            on those axes; OFF when the user already set a size. */}
        {isScan && hasUsefulPackageInfo && (
          <PackageInfoBanner
            packageInfo={packageInfo}
            apply={applyPackageInfo}
            setApply={setApplyPackageInfo}
          />
        )}

        {/* PER selector — picks the basis unit for every number below. */}
        <div style={{ marginBottom: 14 }}>
          <LabelKicker>BASIS</LabelKicker>
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
                    transition: "all 0.14s ease",
                  }}
                >
                  <div style={{ fontWeight: active ? 700 : 500 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: active ? "#5c8fa8" : "#666", marginTop: 2 }}>{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {per === "serving" && (
          <div style={{ marginBottom: 14 }}>
            <LabelKicker>SERVING SIZE (GRAMS)</LabelKicker>
            <NumberInput
              value={servingG}
              onChange={setServingG}
              placeholder="e.g. 30"
              step="1"
              highlighted={isScan && servingG !== ""}
            />
            <Hint>Weigh one serving, or read "Serving Size 30g" off the label.</Hint>
          </div>
        )}

        {/* Hero kcal input — slightly larger on scan path to echo the
            bold "Calories" line every FDA label opens with. */}
        <div style={{ marginBottom: 14 }}>
          <LabelKicker>CALORIES · REQUIRED</LabelKicker>
          <NumberInput
            value={kcal}
            onChange={setKcal}
            placeholder="kcal"
            step="1"
            hero={isScan}
            highlighted={isScan && kcal !== ""}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <Field label="PROTEIN (g)" value={proteinG} onChange={setProteinG} highlighted={isScan && proteinG !== ""} />
          <Field label="FAT (g)"     value={fatG}     onChange={setFatG}     highlighted={isScan && fatG !== ""} />
          <Field label="CARBS (g)"   value={carbG}    onChange={setCarbG}    highlighted={isScan && carbG !== ""} />
          <Field label="FIBER (g)"   value={fiberG}   onChange={setFiberG}   highlighted={isScan && fiberG !== ""} />
          <Field label="SUGAR (g)"   value={sugarG}   onChange={setSugarG}   highlighted={isScan && sugarG !== ""} />
          <Field label="SODIUM (mg)" value={sodiumMg} onChange={setSodiumMg} highlighted={isScan && sodiumMg !== ""} />
        </div>

        {/* MORE NUTRIENTS — collapsed by default unless any field
            is already populated (scan + detailed-entry paths). */}
        <button
          type="button"
          onClick={() => setShowMore(v => !v)}
          style={{
            width: "100%", padding: "10px 12px",
            background: showMore ? "#161616" : "#0f0f0f",
            border: "1px solid #242424",
            color: "#c8c4bd",
            borderRadius: 10,
            fontFamily: "'DM Mono',monospace", fontSize: 10,
            letterSpacing: "0.12em",
            display: "flex", alignItems: "center", gap: 8,
            cursor: "pointer", marginBottom: showMore ? 12 : 14,
            transition: "all 0.18s ease",
          }}
        >
          <span style={{ flex: 1, textAlign: "left" }}>
            {showMore ? "▾" : "▸"}  MORE NUTRIENTS
          </span>
          {!showMore && anyMicroSeeded && (
            <span style={{
              fontSize: 8, letterSpacing: "0.1em",
              color: SCAN_GOLD,
              padding: "2px 6px",
              border: `1px solid ${SCAN_GOLD}44`,
              borderRadius: 4,
            }}>
              {countFilled([satFatG, transFatG, cholesterolMg, addedSugarG, vitaminDMcg, calciumMg, ironMg, potassiumMg])} FILLED
            </span>
          )}
        </button>
        {showMore && (
          <div style={{
            marginBottom: 14,
            animation: "nutritionSectionReveal 260ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}>
            <SubsectionHeader>FATS &amp; CHOLESTEROL</SubsectionHeader>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <Field label="SAT. FAT (g)"    value={satFatG}      onChange={setSatFatG}      highlighted={isScan && satFatG !== ""} />
              <Field label="TRANS FAT (g)"   value={transFatG}    onChange={setTransFatG}    highlighted={isScan && transFatG !== ""} />
              <Field label="CHOLEST. (mg)"   value={cholesterolMg} onChange={setCholesterolMg} highlighted={isScan && cholesterolMg !== ""} />
              <Field label="ADDED SUGAR (g)" value={addedSugarG}   onChange={setAddedSugarG}   highlighted={isScan && addedSugarG !== ""} />
            </div>

            <SubsectionHeader>VITAMINS &amp; MINERALS</SubsectionHeader>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="VITAMIN D (mcg)" value={vitaminDMcg} onChange={setVitaminDMcg} highlighted={isScan && vitaminDMcg !== ""} />
              <Field label="CALCIUM (mg)"    value={calciumMg}   onChange={setCalciumMg}   highlighted={isScan && calciumMg !== ""} />
              <Field label="IRON (mg)"       value={ironMg}      onChange={setIronMg}      highlighted={isScan && ironMg !== ""} />
              <Field label="POTASSIUM (mg)"  value={potassiumMg} onChange={setPotassiumMg} highlighted={isScan && potassiumMg !== ""} />
            </div>
          </div>
        )}

        {/* INGREDIENTS + ALLERGENS — shown when scanner extracted
            them OR user had prior detailed entry. Allergens render
            as pill chips; ingredients text is a readonly preview
            that taps to edit. */}
        {(ingredientsText || (allergens && allergens.length)) && (
          <div style={{
            marginBottom: 14, padding: "12px 14px",
            background: "#0f0f0f", border: "1px solid #1e1e1e",
            borderRadius: 12,
            animation: "nutritionScanDrop 360ms cubic-bezier(0.16, 1, 0.3, 1) 220ms backwards",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
            }}>
              <span style={{
                fontFamily: "'DM Mono',monospace", fontSize: 10,
                color: "#c8c4bd", letterSpacing: "0.12em", fontWeight: 700,
              }}>
                📋 INGREDIENTS {isScan ? "· READ FROM LABEL" : ""}
              </span>
            </div>

            {allergens && allergens.length > 0 && (
              <div style={{
                display: "flex", gap: 6, flexWrap: "wrap",
                marginBottom: ingredientsText ? 10 : 0,
              }}>
                <span style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  color: "#f59e0b", letterSpacing: "0.1em", fontWeight: 700,
                  alignSelf: "center",
                }}>
                  CONTAINS:
                </span>
                {allergens.map(a => (
                  <span key={a} style={{
                    fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
                    color: "#f59e0b",
                    background: "#1e1608",
                    border: "1px solid #3a2a10",
                    borderRadius: 4,
                    padding: "3px 7px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}>
                    {a}
                  </span>
                ))}
              </div>
            )}

            {ingredientsEditing ? (
              <>
                <textarea
                  value={ingredientsText}
                  onChange={e => setIngredientsText(e.target.value)}
                  rows={5}
                  placeholder="Water, sugar, salt, …"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "#141414", border: `1px solid ${SCAN_GOLD}55`,
                    borderRadius: 10,
                    fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                    color: "#f0ece4", lineHeight: 1.5,
                    outline: "none", boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setIngredientsEditing(false)}
                  style={{
                    marginTop: 8, padding: "6px 12px",
                    background: "transparent", border: "1px solid #2a2a2a",
                    color: "#c8c4bd", borderRadius: 8,
                    fontFamily: "'DM Mono',monospace", fontSize: 9,
                    letterSpacing: "0.1em", cursor: "pointer",
                  }}
                >
                  DONE
                </button>
              </>
            ) : ingredientsText ? (
              <div
                onClick={() => setIngredientsEditing(true)}
                style={{
                  padding: "8px 10px",
                  background: "#0a0a0a", border: "1px solid #1e1e1e",
                  borderRadius: 8,
                  fontFamily: "'DM Sans',sans-serif", fontSize: 11,
                  color: "#a8a39b", lineHeight: 1.55,
                  cursor: "pointer",
                  maxHeight: 140, overflowY: "auto",
                  position: "relative",
                }}
              >
                {ingredientsText}
                <span style={{
                  position: "absolute", top: 6, right: 8,
                  fontSize: 10, color: "#555",
                }}>✎</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIngredientsEditing(true)}
                style={{
                  width: "100%", padding: "8px 10px",
                  background: "transparent", border: "1px dashed #2a2a2a",
                  color: "#666", borderRadius: 8,
                  fontFamily: "'DM Mono',monospace", fontSize: 10,
                  letterSpacing: "0.08em", cursor: "pointer",
                }}
              >
                + ADD INGREDIENT LIST
              </button>
            )}
          </div>
        )}
        {!ingredientsText && (!allergens || allergens.length === 0) && !isScan && (
          <button
            type="button"
            onClick={() => setIngredientsEditing(true)}
            style={{
              width: "100%", padding: "10px 12px", marginBottom: 14,
              background: "transparent", border: "1px dashed #2a2a2a",
              color: "#666", borderRadius: 10,
              fontFamily: "'DM Mono',monospace", fontSize: 10,
              letterSpacing: "0.1em", cursor: "pointer",
              textAlign: "left",
            }}
          >
            📋 + ADD INGREDIENT LIST
          </button>
        )}

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
          {existing && !isScan && (
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
              flex: existing && !isScan ? 2 : 1, padding: "14px",
              background: saving ? "#1a1a1a" : SCAN_GOLD,
              border: "none", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
              color: saving ? "#444" : "#111",
              cursor: saving ? "not-allowed" : "pointer",
              letterSpacing: "0.08em",
              boxShadow: saving ? "none" : `0 6px 22px -10px ${SCAN_GOLD}aa`,
              transition: "all 0.18s ease",
            }}
          >
            {saving ? "SAVING…" : (isScan ? "LOOKS RIGHT · SAVE" : (existing ? "UPDATE" : "SAVE"))}
          </button>
        </div>
      </div>
    </ModalSheet>
  );
}

function PackageInfoBanner({ packageInfo, apply, setApply }) {
  const bits = [];
  if (packageInfo?.serving_g) bits.push(`1 serving = ${fmtNum(packageInfo.serving_g)}g`);
  if (packageInfo?.servings_per_container) bits.push(`${fmtNum(packageInfo.servings_per_container)} servings/container`);
  if (packageInfo?.net_weight) bits.push(`net ${fmtNum(packageInfo.net_weight.amount)} ${packageInfo.net_weight.unit}`);
  if (bits.length === 0) return null;
  return (
    <div style={{
      marginBottom: 14, padding: "10px 12px",
      background: "#0f1620", border: "1px solid #1f3040", borderRadius: 12,
      animation: "nutritionScanDrop 360ms cubic-bezier(0.16, 1, 0.3, 1) 140ms backwards",
    }}>
      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 9,
        color: "#7eb8d4", letterSpacing: "0.12em", fontWeight: 700,
        marginBottom: 6,
      }}>
        📦 PACKAGE SIZE · ALSO DETECTED
      </div>
      <div style={{
        fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#c8c4bd",
        lineHeight: 1.4, marginBottom: 8,
      }}>
        {bits.join(" · ")}
      </div>
      <label style={{
        display: "flex", alignItems: "center", gap: 8,
        cursor: "pointer", userSelect: "none",
      }}>
        <input
          type="checkbox"
          checked={apply}
          onChange={e => setApply(e.target.checked)}
          style={{
            accentColor: "#7eb8d4",
            width: 16, height: 16, cursor: "pointer",
          }}
        />
        <span style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: apply ? "#7eb8d4" : "#888",
          letterSpacing: "0.08em",
        }}>
          ALSO FILL IN THIS JAR'S PACKAGE SIZE
        </span>
      </label>
    </div>
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

function SubsectionHeader({ children }) {
  return (
    <div style={{
      fontFamily: "'DM Mono',monospace", fontSize: 9,
      color: "#c8c4bd", letterSpacing: "0.14em",
      marginBottom: 8, marginTop: 2,
      paddingBottom: 6,
      borderBottom: "1px solid #1e1e1e",
    }}>
      {children}
    </div>
  );
}

function Hint({ children }) {
  return (
    <div style={{
      fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555",
      marginTop: 4, letterSpacing: "0.06em",
    }}>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, highlighted = false }) {
  return (
    <div>
      <LabelKicker>{label}</LabelKicker>
      <NumberInput value={value} onChange={onChange} placeholder="—" step="0.1" highlighted={highlighted} />
    </div>
  );
}

function NumberInput({ value, onChange, placeholder, step = "0.1", hero = false, highlighted = false }) {
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
        width: "100%",
        padding: hero ? "14px 16px" : "12px 14px",
        background: highlighted ? "#1a1508" : "#141414",
        border: `1px solid ${highlighted ? `${SCAN_GOLD}55` : "#2a2a2a"}`,
        borderRadius: 10,
        fontFamily: "'DM Mono',monospace",
        fontSize: hero ? 18 : 14,
        fontWeight: hero ? 700 : 400,
        color: highlighted ? "#f5e8ad" : "#f0ece4",
        outline: "none", boxSizing: "border-box",
        transition: "all 0.18s ease",
      }}
    />
  );
}

function countFilled(vals) {
  let n = 0;
  for (const v of vals) if (v !== "" && v != null) n++;
  return n;
}

function fmtNum(v) {
  if (v == null) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// Keyframes scoped via injected <style>. Scoped names so they don't
// collide with any global animation the app might define elsewhere.
const SHEET_KEYFRAMES = `
@keyframes nutritionScanDrop {
  from { opacity: 0; transform: translateY(-6px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}
@keyframes nutritionSectionReveal {
  from { opacity: 0; transform: translateY(-4px); max-height: 0; }
  to   { opacity: 1; transform: translateY(0);    max-height: 1000px; }
}
`;
