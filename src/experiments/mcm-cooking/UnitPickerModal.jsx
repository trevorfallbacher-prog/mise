// Unit picker — a floating glass modal for picking a measurement
// unit (tsp / tbsp / cup / stick / oz / lb / g). Selected unit
// renders as a teal-filled tile; everything else sits on glass.
// Includes a mono conversion helper so the user never has to
// leave the sheet to eyeball "1 stick = how many tbsp?"

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GlassPanel, PrimaryButton, GhostButton,
  Kicker, SerifHeader, HairlineRule, Starburst,
} from "./primitives";
import { color, radius, font, shadow } from "./tokens";

const UNITS = [
  { id: "tsp",   label: "tsp",    hint: "teaspoon"    },
  { id: "tbsp",  label: "tbsp",   hint: "tablespoon"  },
  { id: "cup",   label: "cup",    hint: "8 fl oz"     },
  { id: "stick", label: "stick",  hint: "butter"      },
  { id: "oz",    label: "oz",     hint: "ounce"       },
  { id: "lb",    label: "lb",     hint: "pound"       },
  { id: "g",     label: "g",      hint: "gram"        },
];

const CONVERSION = "1 stick = 8 tbsp = 4 oz = 113.4 g";

export default function UnitPickerModal({
  open,
  onClose,
  onApply,
  initialUnit = "stick",
  subject = "butter",
  initialAmount = 1,
}) {
  const [unit, setUnit] = useState(initialUnit);
  const [amount, setAmount] = useState(initialAmount);

  // Reset state each time the modal opens so it doesn't carry stale
  // picks from a previous ingredient into a new one.
  useEffect(() => {
    if (open) {
      setUnit(initialUnit);
      setAmount(initialAmount);
    }
  }, [open, initialUnit, initialAmount]);

  const bump = (d) => setAmount((a) => {
    const next = Math.round((a + d) * 4) / 4;
    return Math.max(0.25, Math.min(99, next));
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{    opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background:
              "radial-gradient(60% 50% at 50% 40%, rgba(47,143,131,0.22) 0%, transparent 70%)," +
              "rgba(30,20,10,0.35)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.96, y: 6  }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 400 }}
          >
            <GlassPanel
              padding={24}
              style={{ position: "relative", overflow: "hidden" }}
            >
              <Starburst
                size={120}
                color="rgba(212,166,55,0.18)"
                style={{ position: "absolute", top: -30, right: -30 }}
              />

              {/* --- Header ------------------------------------------ */}
              <Kicker tone={color.burnt}>Unit</Kicker>
              <SerifHeader size={30} style={{ marginTop: 6 }}>
                How much {subject}?
              </SerifHeader>

              {/* --- Amount stepper --------------------------------- */}
              <div style={{
                marginTop: 18,
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 14,
              }}>
                <StepperButton onClick={() => bump(-0.25)} label="−" />
                <div style={{
                  minWidth: 120, textAlign: "center",
                  fontFamily: font.serif, fontStyle: "italic", fontWeight: 300,
                  fontSize: 48, lineHeight: 1, color: color.ink,
                  letterSpacing: "-0.02em",
                }}>
                  {formatAmount(amount)}
                  <span style={{
                    fontFamily: font.mono, fontSize: 16,
                    color: color.warmBrown, marginLeft: 6,
                    letterSpacing: "0.04em",
                    fontStyle: "normal", fontWeight: 500,
                  }}>
                    {UNITS.find((u) => u.id === unit)?.label}
                  </span>
                </div>
                <StepperButton onClick={() => bump(0.25)} label="+" />
              </div>

              <HairlineRule style={{ margin: "20px 0 16px" }} />

              {/* --- Unit grid -------------------------------------- */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
              }}>
                {UNITS.map((u) => {
                  const active = unit === u.id;
                  return (
                    <motion.button
                      key={u.id}
                      onClick={() => setUnit(u.id)}
                      whileTap={{ scale: 0.95 }}
                      transition={{ duration: 0.16 }}
                      style={{
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        gap: 2,
                        padding: "12px 4px",
                        borderRadius: radius.md,
                        border: `1px solid ${active ? color.teal : "rgba(30,30,30,0.08)"}`,
                        background: active
                          ? `linear-gradient(180deg, ${color.teal} 0%, #277A6F 100%)`
                          : "rgba(255,255,255,0.55)",
                        color: active ? "#FFF8EE" : color.ink,
                        boxShadow: active ? "0 8px 18px rgba(47,143,131,0.28)" : "none",
                        cursor: "pointer",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                      }}
                    >
                      <span style={{
                        fontFamily: font.mono, fontSize: 14, fontWeight: 500,
                        letterSpacing: "0.04em",
                      }}>
                        {u.label}
                      </span>
                      <span style={{
                        fontFamily: font.sans, fontSize: 10,
                        color: active ? "rgba(255,248,238,0.8)" : color.inkFaint,
                      }}>
                        {u.hint}
                      </span>
                    </motion.button>
                  );
                })}
              </div>

              {/* --- Conversion helper ----------------------------- */}
              <div style={{
                marginTop: 16,
                padding: "10px 14px",
                borderRadius: radius.md,
                background: "rgba(47,143,131,0.08)",
                border: "1px solid rgba(47,143,131,0.18)",
                fontFamily: font.mono, fontSize: 12,
                color: color.teal,
                letterSpacing: "0.02em",
                textAlign: "center",
              }}>
                {CONVERSION}
              </div>

              {/* --- Footer actions -------------------------------- */}
              <div style={{
                marginTop: 20, display: "flex", gap: 10,
              }}>
                <GhostButton onClick={onClose} style={{ flex: "0 0 auto" }}>
                  Cancel
                </GhostButton>
                <PrimaryButton
                  onClick={() => { onApply && onApply({ amount, unit }); onClose(); }}
                  style={{ flex: 1 }}
                >
                  Use {formatAmount(amount)} {UNITS.find((u) => u.id === unit)?.label}
                </PrimaryButton>
              </div>
            </GlassPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// --- local helpers -------------------------------------------------------

function StepperButton({ onClick, label }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      transition={{ duration: 0.14 }}
      aria-label={label === "+" ? "Increase" : "Decrease"}
      style={{
        width: 44, height: 44, borderRadius: "50%",
        border: `1px solid rgba(30,30,30,0.10)`,
        background: "rgba(255,255,255,0.78)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        fontFamily: font.sans, fontSize: 22, fontWeight: 500,
        color: color.warmBrown,
        cursor: "pointer",
        boxShadow: shadow.soft,
      }}
    >
      {label}
    </motion.button>
  );
}

// Render amounts like 1, 1.25 ("1¼"), 1.5 ("1½"), 1.75 ("1¾") using
// unicode vulgar fractions — matches the warm, cookbook-y tone of
// the serif header it sits inside.
function formatAmount(n) {
  const whole = Math.floor(n);
  const frac  = Math.round((n - whole) * 4) / 4;
  const fracGlyph = { 0.25: "¼", 0.5: "½", 0.75: "¾" }[frac];
  if (!fracGlyph) return String(whole || 0);
  return whole > 0 ? `${whole}${fracGlyph}` : fracGlyph;
}
