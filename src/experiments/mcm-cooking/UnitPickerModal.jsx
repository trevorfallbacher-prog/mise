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
  withAlpha,
} from "./primitives";
import { useTheme, THEME_TRANSITION } from "./theme";
import { radius, font } from "./tokens";

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
  const { theme } = useTheme();
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
            // Warm paper wash + theme teal/burnt radials so the
            // modal stays cohesive with the active time-of-day
            // palette. Dim layer derives from the theme's ink so
            // night mode tints darker, morning stays airy.
            background:
              `radial-gradient(80% 60% at 50% 30%, ${withAlpha(theme.color.paper, 0.55)} 0%, transparent 75%),` +
              `radial-gradient(50% 40% at 10% 85%, ${withAlpha(theme.color.teal, 0.18)} 0%, transparent 70%),` +
              `radial-gradient(50% 40% at 90% 85%, ${withAlpha(theme.color.burnt, 0.14)} 0%, transparent 70%),` +
              `${withAlpha(theme.color.ink, 0.14)}`,
            backdropFilter: "blur(16px) saturate(140%)",
            WebkitBackdropFilter: "blur(16px) saturate(140%)",
            ...THEME_TRANSITION,
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
              <Kicker tone={theme.color.burnt}>Unit</Kicker>
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
                  fontSize: 48, lineHeight: 1, color: theme.color.ink,
                  letterSpacing: "-0.02em",
                }}>
                  {formatAmount(amount)}
                  <span style={{
                    fontFamily: font.mono, fontSize: 16,
                    color: theme.color.warmBrown, marginLeft: 6,
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
                        border: `1px solid ${active ? theme.color.teal : theme.color.glassBorder}`,
                        background: active
                          ? `linear-gradient(180deg, ${theme.color.teal} 0%, ${withAlpha(theme.color.teal, 1)} 100%)`
                          : theme.color.glassFill,
                        color: active ? theme.color.ctaText : theme.color.ink,
                        boxShadow: active
                          ? `0 10px 22px ${withAlpha(theme.color.teal, 0.32)}, inset 0 1px 0 rgba(255,255,255,0.30)`
                          : `inset 0 1px 0 ${theme.color.glassBorder}, inset 0 -1px 0 ${withAlpha(theme.color.ink, 0.05)}`,
                        cursor: "pointer",
                        backdropFilter: "blur(18px) saturate(150%)",
                        WebkitBackdropFilter: "blur(18px) saturate(150%)",
                        ...THEME_TRANSITION,
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
                        color: active ? withAlpha(theme.color.ctaText, 0.8) : theme.color.inkFaint,
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
                background: withAlpha(theme.color.teal, 0.08),
                border: `1px solid ${withAlpha(theme.color.teal, 0.18)}`,
                fontFamily: font.mono, fontSize: 12,
                color: theme.color.teal,
                letterSpacing: "0.02em",
                textAlign: "center",
                ...THEME_TRANSITION,
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
  const { theme } = useTheme();
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      transition={{ duration: 0.14 }}
      aria-label={label === "+" ? "Increase" : "Decrease"}
      style={{
        width: 44, height: 44, borderRadius: "50%",
        border: `1px solid ${theme.color.glassBorder}`,
        background: theme.color.glassFillHeavy,
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        fontFamily: font.sans, fontSize: 22, fontWeight: 500,
        color: theme.color.warmBrown,
        cursor: "pointer",
        boxShadow:
          `0 2px 6px ${withAlpha(theme.color.ink, 0.06)},` +
          `inset 0 1px 0 ${theme.color.glassBorder},` +
          `inset 0 -1px 0 ${withAlpha(theme.color.ink, 0.04)}`,
        ...THEME_TRANSITION,
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
