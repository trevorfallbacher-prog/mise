import { useEffect, useMemo, useState } from "react";
import Cookbook from "./Cookbook";
import NutritionDashboard from "./NutritionDashboard";
import GateCard from "./GateCard";
import GatePicker from "./GatePicker";
import FlairHalo, { isFlairActive } from "./FlairHalo";
import { useUserProfile } from "../lib/useUserProfile";
import { useBadges } from "../lib/useBadges";
import { SKILL_TREE, DIETARY_OPTIONS, LEVEL_OPTIONS, GOAL_OPTIONS } from "../data";

// Rating meta — kept in sync with Cookbook's table so the recent-cooks
// strip renders with the same face language as the cookbook itself.
const RATING_META = {
  nailed: { emoji: "🤩", color: "#f5c842" },
  good:   { emoji: "😊", color: "#4ade80" },
  meh:    { emoji: "😐", color: "#888"    },
  rough:  { emoji: "😬", color: "#ef4444" },
};

function relativeDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  const opts = d.getFullYear() === now.getFullYear()
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

// First-letter avatar in the mise palette. Deterministic per name so a
// family member's initial stays the same color every time you see it.
function avatarColor(name) {
  if (!name) return "#2a2015";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const palette = ["#2a2015", "#15201a", "#1a1228", "#2a1a15", "#15182a", "#2a1e28"];
  return palette[Math.abs(hash) % palette.length];
}

/**
 * Full-screen overlay showing another user's cooking profile. Shown the
 * same way Settings is — fixed 480px shell, × to close.
 *
 * Props:
 *   targetUserId   — whose profile to show
 *   viewerId       — the signed-in user's id (for "our history together"
 *                    + to detect self-view which grays the relationship
 *                    chip)
 *   relationship   — "family" | "friend" | "self" | "stranger". Drives
 *                    the banner chip and what the empty states say. The
 *                    caller already knows this from useRelationships, so
 *                    passing it in saves a query here.
 *   nameFor        — id → string, used for diner attributions on the
 *                    shared-cooks strip
 *   onOpenCook     — (cookLogId) => void — tap a cook card to open it in
 *                    Cookbook (deep-link through the existing pipeline)
 *   onClose
 */
export default function UserProfile({
  targetUserId, viewerId, relationship = "stranger",
  familyKey, nameFor, onOpenCook, onOpenProfile, onClose,
  // Self-view only — opens the Settings / Notifications overlays.
  // Surfaced here because the fixed top-bar icons were pulled; the
  // profile header is now the single entry point for both.
  onOpenSettings, onOpenNotifs, notifsUnread = 0,
  // Google profile picture from the auth session — rendered as the
  // self-view large avatar until user-uploaded pics ship. Not passed
  // for other users (their auth session isn't ours).
  authAvatarUrl,
  // Cook-log deep link handed in from App (notification tap / Home
  // feed). When present, we auto-open the full Cookbook overlay so the
  // embedded Cookbook's own pipeline resolves the detail view.
  deepLink, onConsumeDeepLink,
}) {
  const { profile, cooks, stats, sharedCooks, loading, error, setNutritionTargets } =
    useUserProfile(targetUserId, viewerId);

  // "VIEW FULL COOKBOOK" — opens the existing Cookbook component as a
  // modal overlay. Cookbook ships with scope / filter / search / detail
  // built in, so folding it in here gives UserProfile the full archive
  // surface without duplicating that logic. Limited to self + family
  // since RLS only returns cook_logs for those scopes anyway.
  const [showCookbook, setShowCookbook] = useState(false);
  // Ranked-match picker state; opened from GateCard when all
  // prereqs are green.
  const [pickerState, setPickerState] = useState(null);
  // Broken-image fallback for the large identity avatar. Google
  // avatar URLs sometimes 403 after rotation.
  const [avatarBroken, setAvatarBroken] = useState(false);

  // Auto-open the Cookbook overlay whenever a cook_log deep-link lands.
  // The embedded Cookbook then consumes the same deepLink prop and
  // opens the detail view. Only self-view can show the archive
  // (family-scoped cook_logs only come back for the viewer's own id),
  // so we gate on that to avoid opening an empty overlay.
  useEffect(() => {
    if (deepLink?.kind === "cook_log" && viewerId === targetUserId) {
      setShowCookbook(true);
    }
  }, [deepLink, viewerId, targetUserId]);

  const isSelf = relationship === "self" || (viewerId && viewerId === targetUserId);
  const name   = profile?.name || (isSelf ? "You" : "Someone");
  const first  = name.split(/\s+/)[0];
  const initial = name[0]?.toUpperCase() || "?";

  const skills = useMemo(() => {
    const lvls = profile?.skill_levels || {};
    return SKILL_TREE.map(s => ({ ...s, level: lvls[s.id] ?? 0 }));
  }, [profile]);
  const hasAnySkill = skills.some(s => s.level > 0);

  const diet = DIETARY_OPTIONS.find(d => d.id === profile?.dietary);
  const level = LEVEL_OPTIONS.find(l => l.id === profile?.skill_self_report);
  const goal  = GOAL_OPTIONS.find(g => g.id === profile?.goal);

  // Badges — earned (colored) vs catalog-leftover (silhouette) so the
  // empty slots double as "here's what's out there to unlock" without
  // spoiling anything.
  const badges = useBadges(targetUserId);

  // When the viewer is a FRIEND (not family), RLS returns the profile row
  // but cook_logs is empty — that's by design (friends share prefs only).
  // We surface a soft note rather than leave an awkward empty stats block.
  const friendsLimited = relationship === "friend" && !isSelf;

  // Hidden = we got nothing back. Either stranger access or a deleted
  // account. Show a graceful empty panel with close.
  const hidden = !loading && !profile && !isSelf;

  return (
    <div style={{ position:"fixed", inset:0, background:"#111", zIndex:200, maxWidth:480, margin:"0 auto", overflowY:"auto" }}>
      <div style={{ padding:"20px 20px 80px" }}>
        {/* Header — back-to-home button (left) + label, settings
            (self only) on the right. Close × moved to a proper back
            arrow so the exit affordance reads as navigation, not
            dismiss; settings takes the right slot the × used to hold. */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button
              onClick={onClose}
              title="Back to home"
              aria-label="Back to home"
              style={{ background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:20, width:36, height:36, color:"#aaa", fontSize:18, cursor:"pointer", lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center" }}
            >
              ←
            </button>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em" }}>
              {isSelf ? "YOUR PROFILE" : "CHEF PROFILE"}
            </div>
          </div>
          {isSelf && (
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {onOpenNotifs && (
                <button
                  onClick={onOpenNotifs}
                  title="Notifications"
                  aria-label="Notifications"
                  style={{ position:"relative", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:20, width:36, height:36, color:"#aaa", fontSize:16, cursor:"pointer", lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center" }}
                >
                  🔔
                  {notifsUnread > 0 && (
                    <span style={{ position:"absolute", top:-2, right:-2, minWidth:14, height:14, padding:"0 3px", borderRadius:7, background:"#f5c842", color:"#111", fontFamily:"'DM Mono',monospace", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {notifsUnread > 99 ? "99+" : notifsUnread}
                    </span>
                  )}
                </button>
              )}
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  title="Settings"
                  aria-label="Settings"
                  style={{ background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:20, width:36, height:36, color:"#aaa", fontSize:18, cursor:"pointer", lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center" }}
                >
                  ⚙
                </button>
              )}
            </div>
          )}
        </div>

        {hidden ? (
          <div style={{ marginTop:60, textAlign:"center", padding:"40px 20px", background:"#0f0f0f", border:"1px dashed #222", borderRadius:18 }}>
            <div style={{ fontSize:48, marginBottom:12, opacity:0.5 }}>🫥</div>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontStyle:"italic", color:"#888", marginBottom:6 }}>
              Profile unavailable
            </div>
            <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666" }}>
              Either this person hasn't accepted a connection with you yet, or the account has been removed.
            </div>
          </div>
        ) : loading && !profile ? (
          <div style={{ marginTop:60, textAlign:"center", color:"#666", fontFamily:"'DM Sans',sans-serif", fontSize:13 }}>
            Loading…
          </div>
        ) : (
          <>
            {/* Identity block — avatar, name, relationship. Self view
                gets the FlairHalo when the user's daily roll awarded
                an avatar_sparkle cosmetic within the flair_hours window. */}
            <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
              <FlairHalo active={isSelf && isFlairActive(profile)} size={72}>
                {isSelf && authAvatarUrl && !avatarBroken ? (
                  <img
                    src={authAvatarUrl}
                    alt={name}
                    onError={() => setAvatarBroken(true)}
                    referrerPolicy="no-referrer"
                    style={{ width:72, height:72, borderRadius:36, objectFit:"cover", flexShrink:0, display:"block" }}
                  />
                ) : (
                  <div style={{ width:72, height:72, borderRadius:36, background: avatarColor(name), color:"#f5c842", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Fraunces',serif", fontSize:34, fontWeight:500, flexShrink:0 }}>
                    {initial}
                  </div>
                )}
              </FlairHalo>
              <div style={{ flex:1, minWidth:0 }}>
                <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", margin:0, letterSpacing:"-0.02em" }}>
                  {name}
                </h1>
                <div style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap" }}>
                  {isSelf && <Chip bg="#2a2015" color="#3a2f10" text="#f5c842">YOU</Chip>}
                  {!isSelf && relationship === "family" && <Chip bg="#1a2015" color="#2a3a1e" text="#a3d977">FAMILY</Chip>}
                  {!isSelf && relationship === "friend" && <Chip bg="#15182a" color="#1e2a3a" text="#77a3d9">FRIEND</Chip>}
                  {diet && <Chip>{diet.label.toUpperCase()}</Chip>}
                </div>
                {(level || goal) && (
                  <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666", marginTop:6 }}>
                    {[level?.label, goal?.label].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
            </div>

            {/* Level band — numeric level + title + progress bar to
                next. Curve and titles match xp_config / xp_level_titles
                so the display is correct until product retunes. */}
            <LevelBand level={profile?.level || 1} totalXp={profile?.total_xp || 0} />

            {/* Gate card — visible only when the user has an active
                (non-passed) user_gate_progress row. Self-only: a
                family member shouldn't see your in-progress
                ranked-match until you pass it. */}
            {isSelf && (
              <GateCard
                userId={viewerId}
                onOpenPicker={(gate, progress) => setPickerState({ gate, progress })}
              />
            )}


            {/* Quick stats band — XP / cooks / nailed / streak */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8, marginBottom:20 }}>
              <Stat value={stats.xp} label="XP" color="#f5c842" />
              <Stat value={stats.cookCount} label="COOKS" />
              <Stat value={stats.nailedCount} label="🤩" color="#f5c842" />
              <FlameStat
                count={profile?.streak_count ?? 0}
                tier={profile?.streak_tier ?? 0}
                shields={profile?.streak_shields ?? 0}
              />
            </div>

            {/* Nutrition dashboard — per-user tally of calories/protein/
                fat/carbs with day / week / month views and a goal editor.
                Self-only by design: another user's macros are private. */}
            {isSelf && (
              <NutritionDashboard
                userId={viewerId}
                targets={profile?.nutrition_targets}
                onUpdateTargets={setNutritionTargets}
              />
            )}

            {/* Badge wall. Earned badges render in full color (SVG from
                public/badges/), locked badges render as dim silhouettes
                so the user sees what's out there without spoiling the
                exact trigger. Always rendered so an empty catalog
                surfaces a visible state rather than silently hiding
                itself (the previous behavior made a missing migration
                indistinguishable from "no badges yet"). */}
            <Section label={`BADGES · ${badges.earnedList.length}/${badges.earnedList.length + badges.lockedList.length}`}>
              {badges.loading ? (
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", fontStyle:"italic", margin:0 }}>
                  Loading…
                </p>
              ) : badges.earnedList.length + badges.lockedList.length === 0 ? (
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", fontStyle:"italic", margin:0, lineHeight:1.6 }}>
                  No badges in the catalog yet. {isSelf ? "If you expected one here, make sure the latest migrations are applied." : ""}
                </p>
              ) : (
                <BadgeWall
                  earned={badges.earnedList}
                  locked={badges.lockedList}
                  isSelf={isSelf}
                  firstName={first}
                />
              )}
            </Section>

            {/* Our history together — only when viewer ate at one+ of
                the target's cooks. Quick recall: "we ate this together". */}
            {!isSelf && sharedCooks.length > 0 && (
              <Section label={`YOU'VE EATEN ${sharedCooks.length} OF THEIR MEALS`}>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {sharedCooks.slice(0, 4).map(c => (
                    <CookRow key={c.id} cook={c} onOpen={onOpenCook} />
                  ))}
                </div>
              </Section>
            )}

            {/* Recent cooks — limited for friends by RLS, so we show a
                gentle note instead of pretending they've never cooked. */}
            {friendsLimited ? (
              <Section label="RECENT COOKS">
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", fontStyle:"italic", margin:0, lineHeight:1.6 }}>
                  Friends only share dietary preferences. Upgrade to family in Settings to see each other's cookbooks and meal plans.
                </p>
              </Section>
            ) : cooks.length > 0 ? (
              <Section label={isSelf ? "YOUR RECENT COOKS" : "RECENT COOKS"}>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {cooks.slice(0, 8).map(c => (
                    <CookRow key={c.id} cook={c} onOpen={onOpenCook} />
                  ))}
                </div>
                {(isSelf || relationship === "family") && cooks.length >= 1 && (
                  <button
                    onClick={() => setShowCookbook(true)}
                    style={{
                      marginTop:10, width:"100%", padding:"12px",
                      background:"#161616", border:"1px solid #2a2a2a",
                      color:"#f5c842", borderRadius:12,
                      fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600,
                      letterSpacing:"0.1em", cursor:"pointer",
                    }}
                  >
                    VIEW FULL COOKBOOK →
                  </button>
                )}
              </Section>
            ) : (
              <Section label={isSelf ? "YOUR RECENT COOKS" : "RECENT COOKS"}>
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#555", fontStyle:"italic", margin:0 }}>
                  {isSelf
                    ? "Finish a meal in Cook Mode to start your cookbook."
                    : "Nothing cooked yet."}
                </p>
              </Section>
            )}

            {/* Skill tree. Shown whenever there are any skill rows,
                even if all are level 0 for the target — the visual
                still reads "here's where they could grow". For friends
                the profile row is visible (RLS) but skill_levels stays
                empty unless the target has filled it in themselves. */}
            <Section label={isSelf ? "YOUR SKILL TREE" : "SKILLS"}>
              {hasAnySkill || isSelf ? (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {skills.map(s => (
                    <div key={s.id} style={{ background:"#161616", border:"1px solid #2a2a2a", borderRadius:12, padding:"10px 14px", display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ fontSize:22, flexShrink:0 }}>{s.emoji}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                          <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#f0ece4" }}>{s.name}</div>
                          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: s.level > 0 ? s.color : "#555" }}>
                            LVL {s.level}/{s.maxLevel}
                          </div>
                        </div>
                        <div style={{ height:3, background:"#222", borderRadius:2, overflow:"hidden" }}>
                          <div style={{ height:"100%", borderRadius:2, background: s.color, width:`${(s.level/s.maxLevel)*100}%`, boxShadow: s.level > 0 ? `0 0 6px ${s.color}88` : "none", transition:"width 0.3s" }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#555", fontStyle:"italic", margin:0 }}>
                  No skills leveled up yet.
                </p>
              )}
            </Section>

            {/* Favorite cuisine readout — cheap signal but it's the sort of
                line that reads like "they'd love my ramen pop-up". */}
            {stats.favCuisine && (
              <Section label="FAVORITE CUISINE">
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:12 }}>
                  <div style={{ fontSize:24 }}>🌍</div>
                  <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, color:"#f0ece4", textTransform:"capitalize" }}>
                    {stats.favCuisine}
                  </div>
                  {stats.firstCookedAt && (
                    <div style={{ marginLeft:"auto", fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.08em" }}>
                      SINCE {relativeDate(stats.firstCookedAt).toUpperCase()}
                    </div>
                  )}
                </div>
              </Section>
            )}

            {error && (
              <div style={{ marginTop:24, padding:"10px 12px", background:"#2a1515", border:"1px solid #3a1e1e", color:"#d77777", borderRadius:8, fontFamily:"'DM Sans',sans-serif", fontSize:12 }}>
                Couldn't fully load {first}'s profile.
              </div>
            )}
          </>
        )}
      </div>

      {/* Full-cookbook overlay — launched from VIEW FULL COOKBOOK.
          Cookbook renders its own list + filters + detail, so we just
          host the component inside a fixed overlay and provide a back
          button. Familyscope cook_logs reads self+family, so the list
          will mirror what the viewer sees in the feed. */}
      {showCookbook && (
        <div style={{ position:"fixed", inset:0, background:"#111", zIndex:220, maxWidth:480, margin:"0 auto", overflowY:"auto" }}>
          <div style={{ position:"sticky", top:0, zIndex:2, background:"#111", padding:"12px 20px 8px", display:"flex", alignItems:"center", gap:10, borderBottom:"1px solid #1e1e1e" }}>
            <button
              onClick={() => setShowCookbook(false)}
              style={{ background:"#161616", border:"1px solid #2a2a2a", borderRadius:18, width:34, height:34, color:"#aaa", fontSize:16, cursor:"pointer", lineHeight:1 }}
            >
              ←
            </button>
            <div style={{ flex:1, fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em" }}>
              FULL COOKBOOK
            </div>
          </div>
          <Cookbook
            userId={viewerId}
            familyKey={familyKey}
            nameFor={nameFor}
            deepLink={deepLink}
            onConsumeDeepLink={onConsumeDeepLink || (() => {})}
            onOpenProfile={onOpenProfile}
          />
        </div>
      )}

      {pickerState && (
        <GatePicker
          userId={viewerId}
          gate={pickerState.gate}
          progress={pickerState.progress}
          onClose={() => setPickerState(null)}
          onPicked={() => setPickerState(null)}
        />
      )}
    </div>
  );
}

// ── Tiny shared UI bits ──────────────────────────────────────────────────────

function Section({ label, children }) {
  return (
    <div style={{ marginTop:18 }}>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:10 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Chip({ color = "#2a2a2a", bg = "#1a1a1a", text = "#bbb", children }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", background: bg, border:`1px solid ${color}`, color: text, borderRadius:20, padding:"3px 9px", fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:"0.08em" }}>
      {children}
    </span>
  );
}

// Numeric level + title + XP-to-next progress bar. Pure client math
// mirrors xp_to_next(L) = round(100 * L^1.6) from 0102. Source of
// truth is xp_config / xp_level_titles; if product retunes the curve
// the DB stays authoritative and this component re-renders against
// the user's recomputed profile.level.
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
  const row = LEVEL_TITLES.find(r => L >= r.min && L <= r.max);
  return row?.title || "Apprentice";
}
function xpToNext(L) {
  return Math.max(1, Math.round(100 * Math.pow(L, 1.6)));
}
function xpInLevel(totalXp, L) {
  // Sum cumulative xp_to_next(1..L-1) and subtract from totalXp.
  let sum = 0;
  for (let i = 1; i < L; i++) sum += xpToNext(i);
  return Math.max(0, totalXp - sum);
}

function LevelBand({ level, totalXp }) {
  const title = titleForLevel(level);
  const inLevel = xpInLevel(totalXp, level);
  const toNext = xpToNext(level);
  const pct = Math.min(100, (inLevel / toNext) * 100);

  return (
    <div style={{
      background: "#161616", border: "1px solid #2a2a2a", borderRadius: 12,
      padding: "12px 14px", marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#666", letterSpacing: "0.08em" }}>
            L
          </span>
          <span style={{ fontFamily: "'Fraunces',serif", fontSize: 28, fontWeight: 400, color: "#f5c842", marginLeft: 2 }}>
            {level}
          </span>
          <span style={{ fontFamily: "'Fraunces',serif", fontSize: 15, fontStyle: "italic", color: "#f0ece4", marginLeft: 10 }}>
            {title}
          </span>
        </div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#888" }}>
          {inLevel.toLocaleString()} / {toNext.toLocaleString()}
        </div>
      </div>
      <div style={{ background: "#0a0a0a", borderRadius: 6, height: 8, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: "linear-gradient(90deg, #e07a3a, #f5c842)",
          transition: "width 400ms ease-out",
        }} />
      </div>
    </div>
  );
}

function Stat({ value, label, color = "#f0ece4" }) {
  return (
    <div style={{ background:"#161616", border:"1px solid #2a2a2a", borderRadius:12, padding:"12px 4px", textAlign:"center" }}>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:20, color, fontWeight:500 }}>{value}</div>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666", letterSpacing:"0.08em", marginTop:2 }}>{label}</div>
    </div>
  );
}

// Fire-mode flame-stack stat. Flame count matches the streak tier
// (0-4 from xp_streak_tiers.flame_count). Particle-halo intensity
// is a hint encoded in the border/shadow strength here; the richer
// particle field lands with the celebration layer in Phase 5.
// Shield dots render below the count when the user is holding any.
function FlameStat({ count, tier, shields }) {
  const flames = Math.max(0, Math.min(4, tier));
  const halo = ["none", "0 0 6px rgba(224,122,58,.25)", "0 0 10px rgba(224,122,58,.4)", "0 0 14px rgba(224,122,58,.55)", "0 0 20px rgba(245,200,66,.7)"][flames];
  return (
    <div style={{
      background:"#161616", border:"1px solid #2a2a2a", borderRadius:12,
      padding:"12px 4px", textAlign:"center", boxShadow: halo,
    }}>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:20, color:"#e07a3a", fontWeight:500 }}>
        {count}
      </div>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666", letterSpacing:"0.08em", marginTop:2, display:"flex", alignItems:"center", justifyContent:"center", gap:2 }}>
        <span>{flames > 0 ? "🔥".repeat(flames) : "🔥"}</span>
      </div>
      {shields > 0 && (
        <div style={{ marginTop:4, fontSize:9, color:"#7eb8d4", fontFamily:"'DM Mono',monospace", letterSpacing:"0.08em" }}>
          {"🛡".repeat(shields)}
        </div>
      )}
    </div>
  );
}

// Badge wall — 4-up grid mixing earned (full color) and locked
// (silhouetted) tiles. Tapping any tile opens a small detail card with
// the description + earn rule so the user knows what to do next. Locked
// badges still show the silhouette so the collection feels discoverable
// rather than empty.
function BadgeWall({ earned, locked, isSelf, firstName }) {
  const [detail, setDetail] = useState(null);
  const all = [
    ...earned.map(b => ({ ...b, isEarned: true })),
    ...locked.map(b => ({ ...b, isEarned: false })),
  ];
  return (
    <>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:6 }}>
        {all.map(b => {
          // Little corner marker when the earned badge is scarce. 1/1
          // gets a filled 🥇; small-cap gets the cap number itself.
          const rareChip = b.isEarned && typeof b.maxAwards === "number" && b.maxAwards <= 10
            ? (b.maxAwards === 1 ? "🥇" : `1/${b.maxAwards}`)
            : null;
          return (
            <button
              key={b.id}
              onClick={() => setDetail(b)}
              title={b.isEarned ? `${b.name} — earned` : `${b.name} — locked`}
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                background: b.isEarned ? "#1a1608" : "#0f0f0f",
                border: `1px solid ${b.isEarned ? b.color + "55" : "#1e1e1e"}`,
                borderRadius: 12, padding: 3,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
                // Lock styling: desaturate + dim so the silhouette reads
                // "not yet" without hiding the shape of the icon.
                filter: b.isEarned ? "none" : "grayscale(1) brightness(0.35)",
                opacity: b.isEarned ? 1 : 0.7,
                transition: "all 0.2s",
                // Subtle pulse-glow for earned 1/1s so the wall makes
                // them obviously special.
                boxShadow: b.isEarned && b.maxAwards === 1
                  ? `0 0 18px ${b.color}55`
                  : "none",
              }}
            >
              <img
                src={b.iconPath}
                alt={b.name}
                style={{ width: "94%", height: "94%", objectFit: "contain", pointerEvents: "none" }}
                onError={(e) => {
                  e.currentTarget.outerHTML =
                    '<div style="font-size:28px;color:' + (b.isEarned ? b.color : "#444") + '">🏅</div>';
                }}
              />
              {rareChip && (
                <span style={{
                  position: "absolute", bottom: 4, right: 4,
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  color: "#111", background: b.color,
                  padding: "1px 5px", borderRadius: 10,
                  fontWeight: 700, letterSpacing: "0.04em",
                }}>
                  {rareChip}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!isSelf && earned.length === 0 && locked.length > 0 && (
        <p style={{ marginTop:10, fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666", fontStyle:"italic", margin:"10px 0 0" }}>
          {firstName} hasn't earned any badges yet.
        </p>
      )}
      {isSelf && earned.length === 0 && locked.length > 0 && (
        <p style={{ marginTop:10, fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666", fontStyle:"italic", margin:"10px 0 0" }}>
          Cook a badge-eligible recipe and rate it good or nailed to unlock your first one.
        </p>
      )}

      {detail && (
        <BadgeDetail badge={detail} onClose={() => setDetail(null)} isSelf={isSelf} />
      )}
    </>
  );
}

// Render the "rarity" chip that sits above the badge name — turns
// max_awards into language. 1/1 gets gold; small N (<=10) gets a
// bronze/silver vibe; null = standard (no chip).
function rarityChip(badge) {
  if (badge.maxAwards === 1) {
    return { label: "1 OF 1 · FOREVER", color: "#f5c842", bg: "#1a1608" };
  }
  if (typeof badge.maxAwards === "number" && badge.maxAwards > 1 && badge.maxAwards <= 10) {
    return { label: `1 OF ${badge.maxAwards}`, color: "#e2c77a", bg: "#18150a" };
  }
  return null;
}

function BadgeDetail({ badge, onClose, isSelf }) {
  const earned = !!badge.earnedAt;
  const rarity = rarityChip(badge);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        zIndex: 220, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, cursor: "zoom-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 360, background: "#141414",
          border: `1px solid ${earned ? badge.color + "66" : "#2a2a2a"}`,
          borderRadius: 18, padding: "24px", cursor: "default",
          textAlign: "center",
          // Rare earned badges get a more dramatic glow; standards stay soft.
          boxShadow: earned
            ? (rarity ? `0 0 72px ${badge.color}55` : `0 0 48px ${badge.color}22`)
            : "0 12px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{
          width: 128, height: 128, margin: "0 auto 16px",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: earned ? "#1a1608" : "#0f0f0f",
          border: `1px solid ${earned ? badge.color + "66" : "#2a2a2a"}`,
          borderRadius: 20,
          filter: earned ? "none" : "grayscale(1) brightness(0.4)",
        }}>
          <img
            src={badge.iconPath}
            alt={badge.name}
            style={{ width: "80%", height: "80%", objectFit: "contain" }}
            onError={(e) => {
              e.currentTarget.outerHTML =
                '<div style="font-size:64px;color:' + (earned ? badge.color : "#444") + '">🏅</div>';
            }}
          />
        </div>

        {/* Rarity chip — only shown when the badge is actually scarce.
            Standard badges read cleaner without one. */}
        {rarity && (
          <div style={{ display:"inline-block", padding:"4px 10px", borderRadius:20, background:rarity.bg, border:`1px solid ${rarity.color}66`, marginBottom:8 }}>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:rarity.color, letterSpacing:"0.14em", fontWeight:600 }}>
              🥇 {rarity.label}
            </span>
          </div>
        )}

        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: earned ? badge.color : "#666", letterSpacing:"0.14em", marginBottom:4 }}>
          {earned ? "EARNED" : "LOCKED"}
        </div>
        <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontStyle:"italic", color:"#f0ece4", fontWeight:300, margin:"0 0 6px" }}>
          {badge.name}
        </h3>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#aaa", lineHeight:1.6, margin:"0 0 14px" }}>
          {badge.description}
        </p>

        {/* The earn_reason — the specific "why" this earner got this
            badge. Populated by the award trigger at INSERT time. Only
            shows for earned badges; locked viewers see the earn_rule
            block below instead. */}
        {earned && badge.earnReason && (
          <div style={{ padding:"12px 14px", background:"#1a1608", border:`1px solid ${badge.color}44`, borderRadius:10, marginBottom:12 }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:badge.color, letterSpacing:"0.12em", marginBottom:4 }}>
              WHY {isSelf ? "YOU" : "THEY"} EARNED IT
            </div>
            <div style={{ fontFamily:"'Fraunces',serif", fontStyle:"italic", fontSize:14, color:"#f0ece4", lineHeight:1.5 }}>
              "{badge.earnReason}"
            </div>
          </div>
        )}

        {!earned && badge.earnRule && (
          <div style={{ padding:"10px 14px", background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:10 }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666", letterSpacing:"0.12em", marginBottom:4 }}>
              HOW TO EARN
            </div>
            <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#ccc", lineHeight:1.5 }}>
              {badge.earnRule}
            </div>
          </div>
        )}

        {earned && badge.earnedAt && (
          <div style={{ marginTop:12, fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", letterSpacing:"0.1em" }}>
            {isSelf ? "YOU EARNED IT" : "EARNED"} · {new Date(badge.earnedAt).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" })}
          </div>
        )}
        <button
          onClick={onClose}
          style={{
            marginTop:18, width:"100%", padding:"12px",
            background:"#1a1a1a", color:"#888",
            border:"1px solid #2a2a2a", borderRadius:10,
            fontFamily:"'DM Mono',monospace", fontSize:11, letterSpacing:"0.08em",
            cursor:"pointer",
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

// Compact one-line recipe row. Tapping routes back into the Cookbook
// detail via the existing deep-link pipeline, so reviews/photos/etc
// all come for free.
function CookRow({ cook, onOpen }) {
  const m = RATING_META[cook.rating] || RATING_META.meh;
  return (
    <button
      onClick={() => onOpen?.(cook.id)}
      style={{ display:"flex", alignItems:"center", gap:12, background:"#141414", border:"1px solid #222", borderRadius:12, padding:"10px 14px", cursor:"pointer", textAlign:"left", width:"100%" }}
    >
      <div style={{ fontSize:24, flexShrink:0 }}>{cook.recipeEmoji}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#f0ece4", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {cook.recipeTitle}
        </div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", marginTop:2, display:"flex", gap:6, alignItems:"center" }}>
          <span>{m.emoji}</span>
          <span>{relativeDate(cook.cookedAt)}</span>
          <span style={{ color:"#444" }}>·</span>
          <span>+{cook.xpEarned} XP</span>
        </div>
      </div>
      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:14, color:"#f5c842" }}>→</span>
    </button>
  );
}
