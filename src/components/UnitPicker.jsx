import ModalSheet from "./ModalSheet";
import { COLOR, FONT, CHIP_TONES, pickerKicker, pickerTitle, pickerOptionStyle } from "../lib/tokens";
import { findIngredient } from "../data/ingredients";
import { convert, convertWithBridge, convertUniversal, formatQty } from "../lib/unitConvert";
import { parseAmountString } from "../lib/nutrition";
import { getUnitPickerOptions, DISPLAY_CONTEXT } from "../lib/units";
import { setPreferredUnit, getMeasurementSystem } from "../lib/unitPrefs";

// Shared unit picker for AI recipe ingredients (preview and CookMode
// inline amounts). Tapping an ingredient's amount chip opens this as
// a ModalSheet; tapping a unit converts the current value via the
// canonical's ladder when available, falling back to universal
// mass↔mass or volume↔volume conversion when the row isn't linked to
// a canonical.
//
// Inputs come as a free-text amount string from the model ("6 oz",
// "½ cup", "2 tbsp"). We parse with parseAmountString when we have a
// canonical, or with a lightweight regex fallback otherwise. Callers
// only see a display string going in and a display string coming
// out, so the component is drop-in anywhere an amount renders.

const UNICODE_FRACTION = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 0.333, "⅔": 0.667,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

// Parse "6 oz", "½ cup", "2 cups", "1½ tsp" into { amount, unit }.
// Returns null if no number or no unit token is detectable.
function parseAmountFallback(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])?\s*([a-z_]+)/);
  if (!m) return null;
  const whole = m[1] ? Number(m[1]) : 0;
  const frac  = m[2] ? UNICODE_FRACTION[m[2]] || 0 : 0;
  const amount = whole + frac;
  if (!(amount > 0)) return null;
  const unit = m[3];
  if (!unit) return null;
  return { amount, unit };
}

export default function UnitPicker({
  open,
  onClose,
  amountString,
  ingredientId,
  itemName,
  onPick,
  // Optional: persist the chosen unit to localStorage so every future
  // render of this ingredient honors the pick. Pass prefKey to opt in;
  // omit for ephemeral-only picks (e.g. preview-screen experimentation).
  prefKey,
  // Context the picker is being opened FROM — cook-mode and recipe
  // views pass "cook" (default), pantry/shopping surfaces pass
  // "pantry". The context determines which axis of the canonical's
  // intent drives the selected unit and the list ordering, and it
  // scopes the user override that gets persisted.
  context = DISPLAY_CONTEXT.COOK,
}) {
  if (!open) return null;
  const ingredient = ingredientId ? findIngredient(ingredientId) : null;
  const parsed = ingredient
    ? (parseAmountString(amountString, ingredient) || parseAmountFallback(amountString))
    : parseAmountFallback(amountString);

  const currentUnit = parsed?.unit || null;

  // Options come fully ordered from the central resolver: the
  // selected unit is section="selected", the rest of the ladder
  // follows in authored order (section="ladder"), then compatible
  // registry units (section="registry"). Ladder-local units
  // (stick, clove, wedge, etc.) are preserved; food-specific forms
  // never bleed into the registry section.
  const system = getMeasurementSystem();
  const options = ingredient
    ? getUnitPickerOptions(ingredient, system, context)
    : currentUnit
      ? [{ id: currentUnit, label: currentUnit, section: "selected", isSelected: true, isLadderLocal: false, family: null }]
      : [];

  const pick = (newUnitId) => {
    if (!parsed) { onClose(); return; }
    if (newUnitId === parsed.unit) { onClose(); return; }
    let res;
    if (ingredient) {
      res = convert(parsed, newUnitId, ingredient);
      if (!res.ok) res = convertWithBridge(parsed, newUnitId, ingredient);
    } else {
      res = convertUniversal(parsed, newUnitId);
    }
    if (res.ok && Number.isFinite(res.value) && res.value > 0) {
      const formattable = ingredient || { units: [{ id: newUnitId, label: newUnitId }] };
      onPick(formatQty({ amount: res.value, unit: newUnitId }, formattable));
      // Context-scoped override: a user who picks "g" for flour in
      // cook mode should NOT see grams in the pantry view the next
      // day. Override is stored under (ingredient, context).
      if (prefKey) setPreferredUnit(prefKey, newUnitId, context);
    }
    onClose();
  };

  const headerNoun = itemName || ingredient?.name || "this ingredient";
  const noOptions = options.length === 0;

  return (
    <ModalSheet onClose={onClose} maxHeight="60vh">
      <div style={pickerKicker(CHIP_TONES.canonical.fg)}>UNIT</div>
      <h2 style={pickerTitle}>How do you want {headerNoun} measured?</h2>
      {noOptions && (
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: "#888",
          marginTop: 8, lineHeight: 1.5,
        }}>
          Can't convert this unit — we couldn't detect a mass or volume family.
        </div>
      )}
      <ul style={{
        listStyle: "none", padding: 0, margin: "10px 0 0",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {options.map(u => {
          const isOn = u.id === currentUnit;
          return (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => pick(u.id)}
                style={{
                  ...pickerOptionStyle(isOn, CHIP_TONES.canonical),
                  width: "100%",
                  color: isOn ? CHIP_TONES.canonical.fg : COLOR.ink,
                  fontSize: 14,
                }}
              >
                <span style={{ flex: 1 }}>{u.label || u.id}</span>
                {isOn && <span style={{ fontFamily: FONT.mono, fontSize: 12 }}>✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </ModalSheet>
  );
}
