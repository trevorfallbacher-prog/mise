import ModalSheet from "./ModalSheet";
import { COLOR, FONT, CHIP_TONES, pickerKicker, pickerTitle, pickerOptionStyle } from "../lib/tokens";
import { findIngredient, unitLabel } from "../data/ingredients";
import { convert, convertWithBridge, formatQty } from "../lib/unitConvert";
import { parseAmountString } from "../lib/nutrition";

// Shared unit picker for AI recipe ingredients (preview and CookMode
// inline amounts). Tapping an ingredient's amount chip opens this as
// a ModalSheet; tapping a unit converts the current value onto that
// unit via the canonical's ladder (with density-bridge fallback for
// volume↔weight solids like butter).
//
// Inputs come as a free-text amount string from the model ("6 oz",
// "½ cup", "2 tbsp"). We parse with parseAmountString, convert via
// unitConvert, then format back to a string via formatQty. Callers
// only ever see a display string going in and a display string
// coming out, so the component stays drop-in at any render site
// that currently shows `{ing.amount}`.
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
  const parsed = ingredient ? parseAmountString(amountString, ingredient) : null;

  const ladder = ingredient?.units || [];
  const currentUnit = parsed?.unit || null;
  const options = currentUnit && !ladder.some(u => u.id === currentUnit)
    ? [{ id: currentUnit, label: currentUnit, toBase: 1 }, ...ladder]
    : ladder;

  const pick = (newUnitId) => {
    if (!parsed || !ingredient) { onClose(); return; }
    if (newUnitId === parsed.unit) { onClose(); return; }
    let res = convert(parsed, newUnitId, ingredient);
    if (!res.ok) res = convertWithBridge(parsed, newUnitId, ingredient);
    if (res.ok && Number.isFinite(res.value) && res.value > 0) {
      onPick(formatQty({ amount: res.value, unit: newUnitId }, ingredient));
    }
    onClose();
  };

  const headerNoun = itemName || ingredient?.name || "this ingredient";

  return (
    <ModalSheet onClose={onClose} maxHeight="60vh">
      <div style={pickerKicker(CHIP_TONES.canonical.fg)}>UNIT</div>
      <h2 style={pickerTitle}>How do you want {headerNoun} measured?</h2>
      {!ingredient && (
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: "#888",
          marginTop: 8, lineHeight: 1.5,
        }}>
          This ingredient isn't linked to a canonical, so we can't convert between units yet.
        </div>
      )}
      {ingredient && !parsed && (
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: "#888",
          marginTop: 8, lineHeight: 1.5,
        }}>
          Can't parse "{amountString}" — pick a unit and the converted value will still apply where possible.
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
