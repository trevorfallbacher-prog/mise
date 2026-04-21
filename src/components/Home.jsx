import { useMemo, useState } from "react";
import { useActivityFeed } from "../lib/useActivityFeed";
import { useBadges } from "../lib/useBadges";
import { pickGreeting } from "../lib/greetings";
import { LEVEL_OPTIONS, GOAL_OPTIONS, DIETARY_OPTIONS } from "../data";
import StreakRevive from "./StreakRevive";
import DailyRollCard from "./DailyRollCard";
import FlairHalo, { isFlairActive } from "./FlairHalo";

// Rating face lookup shared with the activity feed's cook rows.
const RATING_EMOJI = { nailed: "🤩", good: "😊", meh: "😐", rough: "😬" };

// "5m ago", "3h ago", "2d ago" — shared relative formatter.
function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// Deterministic avatar color keyed on name — matches the palette used in
// Settings/UserProfile so Marissa's tile is always the same shade.
function avatarColor(name) {
  if (!name) return "#2a2015";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const palette = ["#2a2015", "#15201a", "#1a1228", "#2a1a15", "#15182a", "#2a1e28"];
  return palette[Math.abs(hash) % palette.length];
}

/**
 * Home — social-first. Bands top-to-bottom:
 *
 *   1. Top bar — mise wordmark (opens profile), streak chip, profile
 *      avatar (primary profile entry). The old XP / cooks / badges /
 *      streak stats strip lived here; it got pulled because every
 *      number it surfaced already lives on the profile screen (Quick
 *      Stats band + Nutrition dashboard), so Home was duplicating
 *      the profile's own summary and felt like a dashboard clone.
 *   2. Greeting — large italic serif, rolled per-mount from greetings.
 *   3. YOUR CIRCLE activity feed — cooks and badge earns from self +
 *      accepted family, time-ordered. Cook rows tap into the Cookbook
 *      detail via the existing deep-link rail; badge rows tap into the
 *      earner's profile.
 *   4. Profile pill — diet/level/goal snapshot at the bottom.
 *
 * Courses aren't here yet — when we start that work it slots between
 * the greeting and the feed as a pinned row.
 */
export default function Home({
  profile, userId, familyIds = [], familyLoading = false, nameFor, avatarFor,
  openProfile, openCook,
}) {
  const streak      = profile.streak_count || 0;
  const streakTier  = profile.streak_tier  || 0;
  const brokenPeak  = profile.streak_broken_peak || 0;
  const brokenAt    = profile.streak_broken_at;
  const userLevel   = profile.level || 1;
  // Tombstone: visible only while we're still inside the 48h revival
  // window — beyond that the break becomes history and we stop
  // interrupting the home surface with it.
  const tombstoneActive = brokenPeak > 0 && brokenAt &&
    (Date.now() - new Date(brokenAt).getTime()) < 48 * 60 * 60 * 1000;
  const canRevive = tombstoneActive && userLevel >= 30;
  const [showRevive, setShowRevive] = useState(false);

  // Greeting is picked once per mount — re-tabbing back to Home rolls
  // again, which is the whole point (easter eggs should feel like a
  // surprise, not a setting). useMemo with userId in the deps keeps it
  // stable for the rest of the render pass. onShow side effects (like
  // the Idiot Sandwich mint) fire inside pickGreeting the first time
  // they surface for a given user, module-guarded against re-fires.
  const greeting = useMemo(
    () => pickGreeting({ name: profile.name, userId }),
    [profile.name, userId]
  );

  // Badges catalog powers the activity feed's badge-earn rows.
  // useCookLog + xpTotal were dropped alongside the old stats strip —
  // the user's XP / cook count already lives on the profile screen,
  // and rendering it twice made Home feel like a dashboard clone.
  const badges = useBadges(userId);

  // Feed runs across self + family. Friends stay out by design.
  const feed = useActivityFeed(userId, familyIds, 20);

  // Resolve a badge id → catalog row for feed rendering.
  const badgeById = useMemo(() => {
    const m = new Map();
    for (const b of badges.catalog) m.set(b.id, b);
    return m;
  }, [badges.catalog]);

  const openSelf = () => openProfile?.(userId);

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 100 }}>
      {/* Top row — streak + avatar on the right. Wordmark was pulled;
          the avatar (bumped to 48px) now carries identity on its own,
          and the fixed bell/ADMIN pins live in the freed-up left slot. */}
      <div style={{ padding: "18px 20px 0", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {streak > 0 && !tombstoneActive && (
            <div style={{
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: 20,
              padding: "4px 10px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: streakTier >= 3 ? "0 0 10px rgba(224,122,58,.4)" : "none",
            }}>
              <span style={{ fontSize: 12 }}>
                {streakTier > 0 ? "🔥".repeat(Math.min(4, streakTier)) : "🔥"}
              </span>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#f5c842" }}>
                {streak} day{streak === 1 ? "" : "s"}
              </span>
            </div>
          )}
          {tombstoneActive && (
            <button
              onClick={canRevive ? () => setShowRevive(true) : undefined}
              title={canRevive
                ? `Your ${brokenPeak}-day streak ended — tap to revive`
                : `Your ${brokenPeak}-day streak ended — revival unlocks at L30`}
              disabled={!canRevive}
              style={{
                background: "#1a0f0a",
                border: "1px solid #3a1a0a",
                borderRadius: 20,
                padding: "4px 10px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                opacity: 0.85,
                cursor: canRevive ? "pointer" : "default",
                font: "inherit",
                color: "inherit",
              }}
            >
              <span style={{ fontSize: 12 }}>🕯️</span>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#c78b6a" }}>
                {brokenPeak}-day streak
              </span>
            </button>
          )}
          {/* Profile avatar — primary visual entry point to your own
              profile from Home. Replaces the old XP / COOKS / 🏅 / 🔥
              stats strip: all of that data already lives on your
              profile (Quick Stats band + Nutrition dashboard), so
              surfacing it twice made Home feel like a dashboard
              clone instead of a standalone screen. */}
          <FlairHalo active={isFlairActive(profile)} size={48}>
            <Avatar
              name={profile.name}
              initial={(profile.name || "?")[0]?.toUpperCase() || "?"}
              imageUrl={profile.avatar_url}
              onClick={openSelf}
            />
          </FlairHalo>
        </div>
      </div>

      {/* Hero greeting — large italic serif. Rolled per-mount from the
          greetings module so re-tabbing to Home gives a fresh line. The
          tier tag lets us tint the rare/ultra/disney/time-of-day ones
          so the viewer feels the moment when something special lands. */}
      <div style={{ padding: "22px 20px 0" }}>
        <h1 style={{
          fontFamily: "'Fraunces',serif",
          fontSize: 40, lineHeight: 1.1,
          fontWeight: 300, fontStyle: "italic",
          // Mythic gets the loudest treatment — bigger glow, same gold
          // but unmistakably brighter. Ultra/rare still feel special.
          color: greeting.tier === "mythic" || greeting.tier === "ultra" || greeting.tier === "rare"
            ? "#f5c842"
            : greeting.tier === "disney"
              ? "#e7c9b0"
              : "#f0ece4",
          letterSpacing: "-0.02em",
          margin: 0,
          textShadow: greeting.tier === "mythic"
            ? "0 0 40px #f5c84266"
            : greeting.tier === "ultra"
              ? "0 0 24px #f5c84244"
              : "none",
        }}>
          {greeting.text}
        </h1>
      </div>

      {/* Daily scratch-card roll. Self-only affordance; unrolled
          state tappable, already-rolled state collapses to a
          compact badge. Placed above the activity feed so the
          user sees it on their first scroll-free render. */}
      <DailyRollCard profile={profile} />

      {/* YOUR CIRCLE activity feed */}
      <div style={{ padding: "28px 20px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#f5c842", letterSpacing: "0.12em" }}>
            YOUR CIRCLE
          </div>
          {feed.items.length > 0 && (
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#555", letterSpacing: "0.08em" }}>
              {feed.items.length} RECENT
            </div>
          )}
        </div>

        {(feed.loading || familyLoading) ? (
          <div style={{ padding: "20px", textAlign: "center", color: "#555", fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontStyle: "italic" }}>
            Loading…
          </div>
        ) : feed.items.length === 0 ? (
          <div style={{ padding: "26px 20px", textAlign: "center", background: "#0f0f0f", border: "1px dashed #222", borderRadius: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.6 }}>👥</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontStyle: "italic", color: "#aaa", marginBottom: 6 }}>
              Quiet around here
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#666", lineHeight: 1.5 }}>
              {familyIds.length === 0
                ? "Add family in Settings to start seeing what they're cooking."
                : "Your first cook or badge earn will show up here — yours and your family's alike."}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {feed.items.map((item, i) => (
              <ActivityRow
                key={`${item.kind}-${item.payload.cookLogId || item.payload.badgeId}-${i}`}
                item={item}
                nameFor={nameFor}
                avatarFor={avatarFor}
                badgeById={badgeById}
                onCookTap={openCook}
                onActorTap={openProfile}
                viewerId={userId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Profile pill — compact diet/level/goal snapshot */}
      <ProfilePill profile={profile} />

      {showRevive && (
        <StreakRevive
          userId={userId}
          peak={brokenPeak}
          onClose={() => setShowRevive(false)}
          onRevived={() => { /* realtime profiles sub reconciles the UI */ }}
        />
      )}
    </div>
  );
}

// ── Activity row — either a cook event or a badge earn ───────────────────────
function ActivityRow({ item, nameFor, avatarFor, badgeById, onCookTap, onActorTap, viewerId }) {
  const actorName = nameFor ? nameFor(item.actorId) : "Someone";
  const isSelf = item.actorId === viewerId;
  const displayName = isSelf ? "You" : actorName;
  const avatarInitial = (actorName || "?")[0]?.toUpperCase() || "?";
  const actorAvatar = avatarFor ? avatarFor(item.actorId) : null;

  if (item.kind === "cook") {
    const p = item.payload;
    const face = RATING_EMOJI[p.rating] || "";
    return (
      <button
        onClick={() => onCookTap?.(p.cookLogId)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          background: "#141414", border: "1px solid #222", borderRadius: 14,
          padding: "12px 14px", cursor: "pointer", textAlign: "left", width: "100%",
        }}
      >
        <Avatar name={actorName} initial={avatarInitial} imageUrl={actorAvatar}
          onClick={(e) => { e.stopPropagation(); onActorTap?.(item.actorId); }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#f0ece4", lineHeight: 1.35 }}>
            <b style={{ fontWeight: 500 }}>{displayName}</b>
            {" cooked "}
            <span style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic" }}>
              {p.recipeEmoji} {p.recipeTitle}
            </span>
          </div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
            <span>{face}</span>
            <span>{timeAgo(item.ts).toUpperCase()}</span>
            <span style={{ color: "#444" }}>·</span>
            <span>+{p.xp} XP</span>
          </div>
        </div>
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: "#f5c842", flexShrink: 0 }}>→</span>
      </button>
    );
  }

  if (item.kind === "badge") {
    const badge = badgeById.get(item.payload.badgeId);
    // If the catalog hasn't loaded yet (or the badge was deleted), skip
    // rendering rather than showing a broken row.
    if (!badge) return null;
    return (
      <button
        onClick={() => onActorTap?.(item.actorId)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          background: "#161208", border: `1px solid ${badge.color}33`, borderRadius: 14,
          padding: "12px 14px", cursor: "pointer", textAlign: "left", width: "100%",
          boxShadow: badge.maxAwards === 1 ? `0 0 24px ${badge.color}22` : "none",
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: "#1a1608", border: `1px solid ${badge.color}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, padding: 4,
        }}>
          <img
            src={badge.iconPath}
            alt={badge.name}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onError={(e) => { e.currentTarget.outerHTML = '<span style="font-size:20px">🏅</span>'; }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#f0ece4", lineHeight: 1.35 }}>
            <b style={{ fontWeight: 500 }}>{displayName}</b>
            {" earned "}
            <span style={{ fontFamily: "'Fraunces',serif", fontStyle: "italic", color: badge.color }}>
              {badge.name}
            </span>
            {badge.maxAwards === 1 && (
              <span style={{ marginLeft: 6, fontFamily: "'DM Mono',monospace", fontSize: 9, color: badge.color, letterSpacing: "0.08em" }}>
                🥇 1/1
              </span>
            )}
          </div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", marginTop: 3 }}>
            {timeAgo(item.ts).toUpperCase()}
          </div>
        </div>
        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, color: badge.color, flexShrink: 0 }}>→</span>
      </button>
    );
  }

  return null;
}

function Avatar({ name, initial, imageUrl, onClick }) {
  // Google avatar URLs occasionally 403 after rotation. Fall back to
  // the initial-letter tile on load error so we never render a broken
  // image icon.
  const [imgBroken, setImgBroken] = useState(false);
  const showImage = imageUrl && !imgBroken;
  return (
    <button
      onClick={onClick}
      title={name}
      style={{
        width: 48, height: 48, borderRadius: 24,
        background: showImage ? "transparent" : avatarColor(name),
        color: "#f5c842",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 500,
        flexShrink: 0, border: "none", cursor: "pointer", padding: 0,
        overflow: "hidden",
      }}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={name || ""}
          onError={() => setImgBroken(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          referrerPolicy="no-referrer"
        />
      ) : initial}
    </button>
  );
}

// Compact diet/level/goal snapshot at the bottom, same shape as the
// old Home had. The old EDIT button was never wired — removed.
function ProfilePill({ profile }) {
  const diet  = DIETARY_OPTIONS.find(d => d.id === profile.dietary);
  const level = LEVEL_OPTIONS.find(l => l.id === profile.skill_self_report);
  const goal  = GOAL_OPTIONS.find(g => g.id === profile.goal);
  const bits = [diet?.label || "Everything", level?.label, goal?.label].filter(Boolean);
  return (
    <div style={{ margin: "24px 20px 0", padding: "12px 16px", background: "#111", border: "1px solid #1e1e1e", borderRadius: 12, display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 16 }}>{diet?.emoji || "🍽️"}</span>
      <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#666" }}>
        {bits.join(" · ")}
      </span>
    </div>
  );
}
