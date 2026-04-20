import { useEffect, useRef, useState } from "react";

// Full-screen level-up celebration. Watches profile.level for an
// upward change and plays a one-shot ceremony: big level number
// scales in, italic title fades beneath, single "Keep cooking" CTA
// dismisses. Phase 5 will weave this after the cook-complete beat
// sequence; for now it fires standalone so the level-up moment
// lands even without the full toast layer.
//
// Mounted at the AuthedApp level so every tab benefits. Only shows
// for the signed-in user (profile is their own). Uses a ref to
// remember the last-seen level across renders so we don't re-fire
// on every realtime profile update.

const LEVEL_TITLES = [
  { min: 1,  max: 5,   title: "Apprentice" },
  { min: 6,  max: 10,  title: "Line Cook" },
  { min: 11, max: 20,  title: "Home Chef" },
  { min: 21, max: 35,  title: "Sous Chef" },
  { min: 36, max: 50,  title: "Head Chef" },
  { min: 51, max: 75,  title: "Executive Chef" },
  { min: 76, max: 999, title: "Iron Chef" },
];
function titleForLevel(L) {
  return LEVEL_TITLES.find(r => L >= r.min && L <= r.max)?.title || "Apprentice";
}

export default function LevelUpCeremony({ level }) {
  const prevRef = useRef(level);
  const [showing, setShowing] = useState(null);

  useEffect(() => {
    if (!Number.isFinite(level) || !Number.isFinite(prevRef.current)) {
      prevRef.current = level;
      return;
    }
    if (level > prevRef.current) {
      setShowing({ from: prevRef.current, to: level, title: titleForLevel(level) });
    }
    prevRef.current = level;
  }, [level]);

  if (!showing) return null;

  return (
    <div
      onClick={() => setShowing(null)}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "radial-gradient(ellipse at center, #2a1a08 0%, #0a0503 70%)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        animation: "fadeIn 400ms ease-out",
      }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pop { 0% { transform: scale(0.4); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
        @keyframes rise { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>

      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#e07a3a",
        letterSpacing: "0.18em", marginBottom: 8,
        animation: "rise 500ms 200ms ease-out backwards",
      }}>
        LEVEL UP
      </div>

      <div style={{
        fontFamily: "'Fraunces',serif", fontWeight: 300,
        fontSize: 120, color: "#f5c842", lineHeight: 1,
        animation: "pop 700ms 100ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards",
        textShadow: "0 0 40px rgba(245, 200, 66, 0.35)",
      }}>
        L{showing.to}
      </div>

      <div style={{
        fontFamily: "'Fraunces',serif", fontStyle: "italic", fontWeight: 400,
        fontSize: 28, color: "#f0ece4", marginTop: 14,
        animation: "rise 600ms 700ms ease-out backwards",
      }}>
        {showing.title}
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); setShowing(null); }}
        style={{
          marginTop: 48, background: "transparent",
          border: "1px solid #3a2f10", color: "#f5c842",
          fontFamily: "'DM Mono',monospace", fontSize: 11, letterSpacing: "0.12em",
          padding: "12px 28px", borderRadius: 22, cursor: "pointer",
          animation: "rise 500ms 1100ms ease-out backwards",
        }}
      >
        KEEP COOKING
      </button>
    </div>
  );
}
