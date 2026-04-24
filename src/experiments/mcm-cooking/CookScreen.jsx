// Cook screen — a hero glass panel floats over a blurred kitchen
// scene (simulated with warm gradient + large soft blobs). Step
// kicker, big italic step title, body instructions, teal-check
// ingredient list, and a burnt-orange "Next Step" CTA.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  WarmBackdrop, GlassPanel, PrimaryButton, GhostButton,
  CheckCircle, Kicker, SerifHeader, FadeIn, Starburst,
  BackChip, TintedPill,
} from "./primitives";
import { color, font } from "./tokens";

const STEPS = [
  {
    kicker: "Step 1 of 5",
    title: "Set the table",
    body: "Pull out a heavy saucepan, your microplane, and a deep pasta bowl. Put the kettle on — you'll salt the water in a moment.",
    ingredients: [
      { name: "Saucepan, 3 qt",    amt: "1",         done: true },
      { name: "Microplane",        amt: "1",         done: true },
    ],
    timer: null,
  },
  {
    kicker: "Step 2 of 5",
    title: "Cream the butter",
    body: "Melt the butter slowly over low heat until it foams and smells nutty. Off the heat, whisk in the lemon juice and a pinch of salt until glossy. This is the sauce — don't let it break.",
    ingredients: [
      { name: "Kerrygold Butter",  amt: "1 stick",   done: true  },
      { name: "Meyer Lemon",       amt: "1 whole",   done: true  },
      { name: "Flaky Salt",        amt: "¼ tsp",     done: false },
    ],
    timer: "4 min",
  },
  {
    kicker: "Step 3 of 5",
    title: "Cook the pasta",
    body: "Salt the boiling water generously. Drop the pasta and cook 1 minute less than the box says — it'll finish in the sauce.",
    ingredients: [
      { name: "Bucatini",          amt: "8 oz",      done: true  },
      { name: "Kosher Salt",       amt: "2 tbsp",    done: true  },
    ],
    timer: "8 min",
  },
];

export default function CookScreen({ onBack, onOpenUnitPicker }) {
  const [stepIdx, setStepIdx] = useState(1);
  const step = STEPS[stepIdx];
  const total = STEPS.length;

  const next = () => setStepIdx((i) => Math.min(i + 1, total - 1));
  const prev = () => setStepIdx((i) => Math.max(i - 1, 0));

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      <WarmBackdrop variant="cook" />
      {/* Simulated kitchen haze — a second, blurred gradient painting
          for depth behind the glass panel. */}
      <div
        aria-hidden
        style={{
          position: "absolute", inset: 0,
          background:
            "radial-gradient(60% 50% at 30% 20%, rgba(212,166,55,0.35) 0%, transparent 70%)," +
            "radial-gradient(50% 40% at 80% 80%, rgba(47,143,131,0.30) 0%, transparent 70%)," +
            "radial-gradient(40% 30% at 20% 90%, rgba(217,107,43,0.20) 0%, transparent 70%)",
          filter: "blur(20px)",
          pointerEvents: "none",
        }}
      />

      <div style={{
        position: "relative",
        maxWidth: 480,
        margin: "0 auto",
        padding: "20px 20px 40px",
        display: "flex", flexDirection: "column",
        minHeight: "100vh",
      }}>
        {/* --- Top bar ------------------------------------------------- */}
        <FadeIn>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 16,
          }}>
            <BackChip onClick={onBack}>← Pantry</BackChip>

            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "6px 14px",
              background: "rgba(255,255,255,0.72)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderRadius: 999,
              fontFamily: font.mono, fontSize: 11,
              color: color.inkMuted, letterSpacing: "0.12em",
              textTransform: "uppercase",
              border: `1px solid ${color.hairline}`,
            }}>
              Lemon-Butter Pasta
            </div>
          </div>
        </FadeIn>

        {/* --- Step progress dots ------------------------------------- */}
        <FadeIn delay={0.04}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 8, marginBottom: 20,
          }}>
            {STEPS.map((_, i) => {
              const past    = i < stepIdx;
              const current = i === stepIdx;
              return (
                <div
                  key={i}
                  style={{
                    height: 6,
                    width: current ? 32 : 12,
                    borderRadius: 999,
                    background:
                      current ? color.burnt
                      : past  ? color.teal
                      : "rgba(30,30,30,0.15)",
                    transition: "all 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              );
            })}
          </div>
        </FadeIn>

        {/* --- Hero glass card --------------------------------------- */}
        <AnimatePresence mode="wait">
          <motion.div
            key={stepIdx}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{    opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
            style={{ flex: 1, display: "flex" }}
          >
            <GlassPanel
              padding={26}
              style={{
                flex: 1,
                display: "flex", flexDirection: "column",
                position: "relative", overflow: "hidden",
              }}
            >
              <Starburst
                size={140}
                color="rgba(47,143,131,0.14)"
                style={{ position: "absolute", top: -40, right: -30 }}
              />

              <Kicker tone={color.burnt}>{step.kicker}</Kicker>

              <SerifHeader size={44} style={{ marginTop: 10 }}>
                {step.title}
              </SerifHeader>

              {step.timer && (
                <div style={{ marginTop: 14, alignSelf: "flex-start" }}>
                  <TintedPill
                    tone="mustard"
                    mono
                    style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
                  >
                    <ClockGlyph /> {step.timer}
                  </TintedPill>
                </div>
              )}

              <p style={{
                marginTop: 16, fontFamily: font.sans, fontSize: 16,
                lineHeight: 1.55, color: color.ink,
              }}>
                {step.body}
              </p>

              <div style={{
                marginTop: 22, paddingTop: 18,
                borderTop: `1px solid ${color.hairline}`,
              }}>
                <Kicker>You'll need</Kicker>
                <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
                  {step.ingredients.map((ing, i) => (
                    <motion.li
                      key={ing.name}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: 0.08 + i * 0.05 }}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 0",
                        borderBottom: i === step.ingredients.length - 1
                          ? "none" : `1px solid ${color.hairline}`,
                      }}
                    >
                      <CheckCircle checked={ing.done} />
                      <button
                        onClick={onOpenUnitPicker}
                        style={{
                          flex: 1, minWidth: 0, textAlign: "left",
                          border: "none", background: "transparent",
                          padding: 0, cursor: "pointer",
                          fontFamily: font.serif, fontStyle: "italic",
                          fontWeight: 300, fontSize: 18,
                          color: ing.done ? color.ink : color.inkMuted,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {ing.name}
                      </button>
                      <TintedPill
                        tone={ing.done ? "teal" : "burnt"}
                        mono
                        onClick={onOpenUnitPicker}
                      >
                        {ing.amt}
                      </TintedPill>
                    </motion.li>
                  ))}
                </ul>
              </div>
            </GlassPanel>
          </motion.div>
        </AnimatePresence>

        {/* --- Nav buttons ------------------------------------------- */}
        <FadeIn delay={0.08}>
          <div style={{
            display: "flex", gap: 12, marginTop: 18, alignItems: "stretch",
          }}>
            <GhostButton onClick={prev} style={{ flex: "0 0 auto" }}>
              Back
            </GhostButton>
            <PrimaryButton
              onClick={next}
              style={{ flex: 1, padding: "16px 22px", fontSize: 17 }}
              disabled={stepIdx === total - 1}
            >
              {stepIdx === total - 1 ? "Last step" : "Next step →"}
            </PrimaryButton>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}

function ClockGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7 L12 12 L15.5 14" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
