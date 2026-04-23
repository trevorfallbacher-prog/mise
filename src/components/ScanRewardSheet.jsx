import { useEffect, useRef, useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";
import VerifiedMark, { VERIFIED_BLUE, VERIFIED_BLUE_BORDER } from "./VerifiedMark";

/**
 * ScanRewardSheet — 2.5-second celebration that fires after a
 * successful label-scan save.
 *
 * Intent: make the scan-then-confirm flow feel rewarding, not
 * transactional. The user just did the app a favor — they spent
 * ~8 seconds turning a dead-end label into first-class, shareable
 * data that every future household with this brand will benefit
 * from. That contribution should feel tangible.
 *
 * Layout:
 *   - Full ModalSheet layer with dimmed backdrop
 *   - Large animated VerifiedMark centered
 *   - Serif headline: "Verified."
 *   - Sub: "{Brand} {Canonical} is now official."
 *   - Impact line: "You're teaching every household that stocks this."
 *   - Stats row: calories per serving + macros extracted count
 *   - Confetti-style sparkle burst around the checkmark
 *
 * Auto-dismisses after `duration` ms (default 2500); tap anywhere
 * closes early. Backdrop-click and Escape also dismiss.
 *
 * Props:
 *   onClose()       — dismiss callback
 *   brandLabel      — display string, e.g. "Kerrygold Butter"
 *   nutrition       — the just-saved nutrition block (for the mini
 *                     "here's what you taught us" summary)
 *   fieldsCount     — number of populated nutrition fields (for the
 *                     "20 fields extracted" stat)
 *   taughtShared    — whether the brand-tier teach actually fired
 *                     (false when brand was missing or dirtyCount
 *                     was too high). When false, the messaging
 *                     shifts to "this jar is now locked in" rather
 *                     than "every household benefits."
 *   duration        — auto-dismiss ms (default 2500)
 */
export default function ScanRewardSheet({
  onClose,
  brandLabel,
  nutrition = null,
  fieldsCount = 0,
  taughtShared = true,
  duration = 2500,
}) {
  const [mounted, setMounted] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    // Fire the animation one tick after mount so the check draws
    // feels earned after the sheet has landed.
    const t = setTimeout(() => setMounted(true), 30);
    timerRef.current = setTimeout(() => onClose?.(), duration);
    return () => {
      clearTimeout(t);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [duration, onClose]);

  const kcal = nutrition && Number.isFinite(Number(nutrition.kcal))
    ? Math.round(Number(nutrition.kcal))
    : null;

  return (
    <ModalSheet
      onClose={onClose}
      zIndex={Z.confirm}
      showHandle={false}
      showClose={false}
      swipeable={false}
      maxHeight="auto"
      label={null}
    >
      <style>{REWARD_KEYFRAMES}</style>
      <div
        onClick={onClose}
        style={{
          padding: "22px 22px 14px",
          display: "flex", flexDirection: "column", alignItems: "center",
          textAlign: "center",
          cursor: "pointer",
        }}
      >
        {/* Hero check with sparkle burst */}
        <div style={{
          position: "relative",
          width: 120, height: 120,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 14,
        }}>
          {/* Ambient glow */}
          <span style={{
            position: "absolute", inset: -20,
            background: `radial-gradient(circle, ${VERIFIED_BLUE}33 0%, transparent 65%)`,
            opacity: mounted ? 1 : 0,
            transition: "opacity 420ms ease",
            pointerEvents: "none",
          }} />

          {/* Sparkle burst — 8 little lines radiating out */}
          {mounted && (
            <>
              {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
                <span key={deg} style={{
                  position: "absolute", left: "50%", top: "50%",
                  width: 2, height: 14,
                  marginLeft: -1, marginTop: -7,
                  background: `linear-gradient(to bottom, ${VERIFIED_BLUE} 0%, transparent 100%)`,
                  borderRadius: 2,
                  transformOrigin: "center 42px",
                  transform: `rotate(${deg}deg) translateY(-36px)`,
                  opacity: 0,
                  animation: `rewardSparkle 900ms cubic-bezier(0.16, 1, 0.3, 1) ${320 + i * 40}ms forwards`,
                  pointerEvents: "none",
                }} />
              ))}
            </>
          )}

          {mounted && (
            <VerifiedMark
              size={84}
              delay={0}
              duration={720}
              replayKey={mounted ? 1 : 0}
              showLabel={false}
            />
          )}
        </div>

        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: VERIFIED_BLUE, letterSpacing: "0.18em", fontWeight: 700,
          marginBottom: 6,
          animation: "rewardFadeUp 320ms 240ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        }}>
          ✓ VERIFIED
        </div>

        <h2 style={{
          fontFamily: "'Fraunces',serif", fontSize: 26,
          fontStyle: "italic", color: "#f0ece4",
          fontWeight: 400, margin: "0 0 6px", lineHeight: 1.15,
          animation: "rewardFadeUp 360ms 340ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        }}>
          {brandLabel ? <>{brandLabel} is <span style={{ color: VERIFIED_BLUE }}>official</span>.</> : "Official."}
        </h2>

        <p style={{
          fontFamily: "'DM Sans',sans-serif", fontSize: 13,
          color: "#a8a39b", lineHeight: 1.5,
          margin: "0 0 14px", maxWidth: 340,
          animation: "rewardFadeUp 360ms 420ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        }}>
          {taughtShared
            ? "Thank you. Every household that stocks this brand just got accurate nutrition — because of your scan."
            : "This jar's nutrition is locked in. Thanks for the precision."}
        </p>

        {/* Stats row — tangible impact */}
        {(kcal != null || fieldsCount > 0) && (
          <div style={{
            display: "flex", gap: 10, marginBottom: 12,
            animation: "rewardFadeUp 360ms 520ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
          }}>
            {kcal != null && <Stat value={kcal} unit="kcal" label="per serving" />}
            {fieldsCount > 0 && <Stat value={fieldsCount} unit="" label="fields captured" />}
          </div>
        )}

        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 9,
          color: "#555", letterSpacing: "0.12em",
          marginTop: 4,
          animation: "rewardFadeUp 320ms 640ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        }}>
          TAP TO CONTINUE
        </div>
      </div>
    </ModalSheet>
  );
}

function Stat({ value, unit, label }) {
  return (
    <div style={{
      padding: "10px 14px",
      background: "#0f1620", border: `1px solid ${VERIFIED_BLUE_BORDER}`,
      borderRadius: 10,
      minWidth: 96,
    }}>
      <div style={{
        fontFamily: "'Fraunces',serif", fontSize: 22, fontStyle: "italic",
        color: "#f0ece4", lineHeight: 1,
      }}>
        {value}
        {unit && (
          <span style={{
            fontFamily: "'DM Mono',monospace", fontSize: 10,
            fontStyle: "normal",
            color: "#888", marginLeft: 4,
          }}>
            {unit}
          </span>
        )}
      </div>
      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 8,
        color: "#777", letterSpacing: "0.12em",
        marginTop: 4, textTransform: "uppercase",
      }}>
        {label}
      </div>
    </div>
  );
}

const REWARD_KEYFRAMES = `
@keyframes rewardFadeUp {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes rewardSparkle {
  0%   { opacity: 0; transform-origin: center 42px; }
  40%  { opacity: 1; }
  100% { opacity: 0; }
}
`;
