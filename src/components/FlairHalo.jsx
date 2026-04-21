// Epic-flair avatar halo. Wraps any avatar-shaped child with a
// gradient-border ring + sparkle particles when the user's daily
// roll awarded a cosmetic_flair='avatar_sparkle' within the last
// flair_hours (24h for epic).
//
// Read from profiles.daily_roll_result + profiles.daily_roll_date
// on any surface that shows the self avatar: Home top-bar, Profile
// header. Non-self avatars never render the flair — it's your
// little badge, not gossip.
//
// Design note: the halo draws around the child so callers don't
// have to change their avatar sizing. Pointer-events pass through
// to the wrapped element so tapping still opens the profile.

export function isFlairActive(profile) {
  const r = profile?.daily_roll_result;
  if (!r || r.cosmetic_flair !== "avatar_sparkle") return false;
  const rolledAt = r.rolled_at ? new Date(r.rolled_at) : null;
  if (!rolledAt || Number.isNaN(rolledAt.getTime())) return false;
  const hours = Number(r.flair_hours) || 24;
  const ageMs = Date.now() - rolledAt.getTime();
  return ageMs < hours * 60 * 60 * 1000;
}

export default function FlairHalo({ active, size, children }) {
  if (!active) return children;
  const padded = size + 8;  // ring sits 4px outside the avatar
  return (
    <div style={{
      position: "relative",
      width: padded, height: padded,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
    }}>
      <style>{`
        @keyframes flairSpin {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
        @keyframes flairSparkle {
          0%,100% { opacity: 0 }
          50%     { opacity: 1 }
        }
      `}</style>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "conic-gradient(from 0deg, #f5c842, #e07a3a, #b8a878, #f5c842)",
        animation: "flairSpin 4.5s linear infinite",
        padding: 2,
        mask: "radial-gradient(circle, transparent calc(50% - 2px), black calc(50% - 1px))",
        WebkitMask: "radial-gradient(circle, transparent calc(50% - 2px), black calc(50% - 1px))",
        pointerEvents: "none",
      }} />
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top:  `${50 + 48 * Math.sin((i / 4) * Math.PI * 2)}%`,
            left: `${50 + 48 * Math.cos((i / 4) * Math.PI * 2)}%`,
            transform: "translate(-50%, -50%)",
            fontSize: 9,
            animation: `flairSparkle 1.6s ease-in-out ${i * 0.4}s infinite`,
            pointerEvents: "none",
          }}
        >
          ✦
        </span>
      ))}
      <div style={{ position: "relative", zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
