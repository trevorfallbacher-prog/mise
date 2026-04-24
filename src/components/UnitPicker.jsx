import ModalSheet from "./ModalSheet";
import { COLOR, FONT, CHIP_TONES, pickerKicker, pickerTitle, pickerOptionStyle } from "../lib/tokens";
import { findIngredient, unitLabel } from "../data/ingredients";
import { convert, convertWithBridge, convertUniversal, formatQty, universalLadderFor } from "../lib/unitConvert";
import { parseAmountString } from "../lib/nutrition";

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
}) {
  if (!open) return null;
  const ingredient = ingredientId ? findIngredient(ingredientId) : null;
  const parsed = ingredient
    ? (parseAmountString(amountString, ingredient) || parseAmountFallback(amountString))
    : parseAmountFallback(amountString);

  const ladder = ingredient?.units || [];
  const currentUnit = parsed?.unit || null;

  // When we have a canonical, use its full ladder. When we don't
  // but the current unit belongs to the universal mass/volume
  // families, offer the universal siblings so the cook can still
  // flip tbsp → cup on a free-text ingredient.
  const universal = currentUnit && !ingredient ? universalLadderFor(currentUnit) : [];
  const universalOpts = universal.map(id => ({ id, label: unitLabel(id) || id, toBase: 1 }));

  const base = ladder.length > 0 ? ladder : universalOpts;
  const options = currentUnit && !base.some(u => u.id === currentUnit)
    ? [{ id: currentUnit, label: unitLabel(currentUnit) || currentUnit, toBase: 1 }, ...base]
    : base;

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
      // Without an ingredient, formatQty can't fetch a nice label,
      // so hand it a stub with a units[] for the chosen unit.
      const formattable = ingredient || { units: [{ id: newUnitId, label: unitLabel(newUnitId) || newUnitId }] };
      onPick(formatQty({ amount: res.value, unit: newUnitId }, formattable));
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
                <span style={{ flex: 1 }}>{u.label || unitLabel(u.id) || u.id}</span>
                {isOn && <span style={{ fontFamily: FONT.mono, fontSize: 12 }}>✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </ModalSheet>
  );
}
