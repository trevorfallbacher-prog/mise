import { useState } from "react";
import { signOut } from "../lib/useAuth";
import { useWebPush } from "../lib/useWebPush";
import { useNotificationPreferences } from "../lib/useNotificationPreferences";
import { supabase } from "../lib/supabase";

// Panel header used at the top of each section in Settings.
function SectionHeader({ label }) {
  return (
    <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:10, marginTop:24 }}>
      {label}
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

// Short tag for a connection row so it's clear whether you're looking at a
// family member vs a friend, and — for friends — what their dietary pref is.
function DietaryChip({ profile }) {
  if (!profile?.dietary) return null;
  const LABEL = {
    everything: "ALL", vegetarian: "VEG", vegan: "VEGAN", keto: "KETO",
    glutenfree: "GF", halal: "HALAL", kosher: "KOSHER", dairyfree: "DF",
  };
  const label = LABEL[profile.dietary] || profile.dietary.toUpperCase();
  return <Chip>{label}</Chip>;
}

// A single relationship row (family, friend, or pending). Tapping the
// avatar + name opens the target's profile overlay when that connection
// is accepted. Pending rows stay inert — there's nothing useful to show
// until the other side accepts.
function ConnectionRow({ row, actions, onOpenProfile }) {
  const name = row.other?.name || "Unknown";
  const initial = name[0]?.toUpperCase() || "?";
  const canOpen = !!(onOpenProfile && row.status === "accepted" && row.otherId);

  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:"#141414", border:"1px solid #1e1e1e", borderRadius:12, marginBottom:8 }}>
      <button
        onClick={canOpen ? () => onOpenProfile(row.otherId) : undefined}
        disabled={!canOpen}
        style={{
          display:"flex", alignItems:"center", gap:12, flex:1, minWidth:0,
          background:"transparent", border:"none", padding:0,
          textAlign:"left", color:"inherit",
          cursor: canOpen ? "pointer" : "default",
        }}
      >
        {row.other?.avatar_url ? (
          <img
            src={row.other.avatar_url}
            alt={name}
            referrerPolicy="no-referrer"
            style={{ width:40, height:40, borderRadius:20, objectFit:"cover", flexShrink:0, display:"block" }}
          />
        ) : (
          <div style={{ width:40, height:40, borderRadius:20, background:"#2a2015", color:"#f5c842", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:500, flexShrink:0 }}>
            {initial}
          </div>
        )}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#f0ece4", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {name}
          </div>
          <div style={{ display:"flex", gap:5, marginTop:4, flexWrap:"wrap" }}>
            {row.kind === "family" && <Chip bg="#1a2015" color="#2a3a1e" text="#a3d977">FAMILY</Chip>}
            {row.kind === "friend" && <Chip bg="#15182a" color="#1e2a3a" text="#77a3d9">FRIEND</Chip>}
            {row.status === "pending" && row.direction === "outgoing" && <Chip>SENT</Chip>}
            {row.status === "pending" && row.direction === "incoming" && <Chip bg="#2a1e15" color="#3a2a1e" text="#d9a377">INCOMING</Chip>}
            {row.status === "accepted" && <DietaryChip profile={row.other} />}
          </div>
        </div>
      </button>
      <div style={{ display:"flex", gap:6, flexShrink:0 }}>
        {actions}
      </div>
    </div>
  );
}

function SmallButton({ onClick, color = "#f5c842", children }) {
  return (
    <button
      onClick={onClick}
      style={{ background: color, border:"none", color:"#111", borderRadius:8, padding:"6px 10px", fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer" }}
    >
      {children}
    </button>
  );
}

function GhostButton({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{ background:"transparent", border:"1px solid #2a2a2a", color:"#888", borderRadius:8, padding:"6px 10px", fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.08em", cursor:"pointer" }}
    >
      {children}
    </button>
  );
}

// Rarity → tier color mapping. Matches the daily-roll palette so the
// loot-box / level-up work coming later reuses the same language.
const RARITY_COLOR = {
  common:   "#8e8e8e",
  uncommon: "#4ade80",
  rare:     "#77a3d9",
  ultra:    "#c77dd9",
};

// AVATAR section — collection grid. Owned tiles are clickable; tapping
// one makes it the user's current avatar. Unowned tiles render as 🔒
// silhouettes so the unlock loop reads immediately (future loot-box /
// level-up work grants more catalog rows). Rarity dot in the bottom-
// right uses the daily-roll tier palette.
function AvatarSection({ catalog, owned, currentSlug, onPin }) {
  if (!catalog?.length) return null;
  const ownedCount = owned.size;
  return (
    <>
      <SectionHeader label="YOUR AVATAR" />
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:10 }}>
        {catalog.map(c => {
          const isOwned   = owned.has(c.slug);
          const isCurrent = currentSlug === c.slug;
          const tier      = RARITY_COLOR[c.rarity] || "#2a2a2a";
          const clickable = isOwned && typeof onPin === "function";
          return (
            <button
              key={c.slug}
              onClick={clickable ? () => onPin(c.slug) : undefined}
              disabled={!clickable}
              style={{
                position:"relative",
                aspectRatio:"1 / 1",
                padding:0,
                background: isCurrent ? "#1e1a0e" : "#141414",
                border: `1px solid ${isCurrent ? "#f5c842" : (isOwned ? "#2a2a2a" : "#1a1a1a")}`,
                borderRadius:14,
                cursor: clickable ? "pointer" : "default",
                overflow:"hidden",
              }}
              title={isOwned ? c.name : "Locked"}
            >
              {isOwned ? (
                <img
                  src={c.image_url}
                  alt={c.name}
                  style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}
                />
              ) : (
                <div style={{ width:"100%", height:"100%", background:"#0c0c0c", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:"#333" }}>
                  🔒
                </div>
              )}
              <span style={{ position:"absolute", bottom:4, right:4, width:8, height:8, borderRadius:4, background: tier, border:"1px solid rgba(0,0,0,0.4)" }} />
              {isCurrent && (
                <span style={{ position:"absolute", top:4, left:4, fontFamily:"'DM Mono',monospace", fontSize:8, color:"#111", background:"#f5c842", padding:"2px 5px", borderRadius:4, letterSpacing:"0.08em", fontWeight:700 }}>
                  CURRENT
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#666", marginTop:8, lineHeight:1.5 }}>
        {ownedCount < catalog.length
          ? `Tap any unlocked tile to switch. ${catalog.length - ownedCount} more to unlock.`
          : "Tap any tile to switch. You've unlocked everything available."}
      </div>
    </>
  );
}

/**
 * Settings screen. Shown as a full overlay — tap the × to close.
 *
 * Props:
 *   profile         — current user's profile row (needs .invite_code)
 *   relationships   — object returned by useRelationships()
 *   onClose         — close the overlay
 *   onEditProfile   — (optional) open the profile editor
 */
export default function Settings({
  userId, profile, relationships, upsertProfile,
  avatarCatalog = [], ownedAvatars = new Set(),
  onPinAvatar,
  onClose, onOpenProfile, onOpenReleaseNotes, onOpenAdmin,
}) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState("family"); // "family" | "friend"
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pantry maintenance — one-shot legacy split. Migrates bulk rows
  // (amount=50 unit=can / reserve_count=49) into per-instance siblings
  // so the StackedItemCard render path can stack them. Idempotent —
  // re-running on already-split rows is a no-op (the WHERE clause in
  // the RPC filters to amount>=2 OR reserve_count>0).
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitResult, setSplitResult] = useState(null); // { splitCount, totalInstances } | { error } | null

  const runSplit = async () => {
    if (!userId || splitBusy) return;
    setSplitBusy(true);
    setSplitResult(null);
    const { data, error } = await supabase.rpc("split_aggregate_rows", { p_user_id: userId });
    setSplitBusy(false);
    if (error) {
      setSplitResult({ error: error.message || String(error) });
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setSplitResult({
      splitCount: Number(row?.split_count) || 0,
      totalInstances: Number(row?.total_instances) || 0,
    });
  };

  // Name editor. Prefilled with whatever the profile has (or empty, which is
  // the whole reason this editor exists — magic-link sign-ins have no name).
  const [nameDraft, setNameDraft] = useState(profile?.name || "");
  const [nameSaved, setNameSaved] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);
  const nameDirty = (nameDraft.trim() || null) !== (profile?.name || null);

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setNameBusy(true);
    try {
      await upsertProfile({ name: trimmed });
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 1500);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setNameBusy(false);
    }
  };


  const myCode = profile?.invite_code || "—";

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(myCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked in insecure contexts; ignore.
    }
  };

  const sendInvite = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await relationships.invite(code, kind);
      setCode("");
    } catch (e) {
      setError(e.message || "Couldn't send invite");
    } finally {
      setBusy(false);
    }
  };

  const {
    family, friends, incoming, outgoing,
    accept, remove, upgradeToFamily, downgradeToFriend,
  } = relationships;

  return (
    // Full-viewport backdrop at z:200 so the floating top-corner
    // buttons (🛠 ADMIN / 🔔 BELL / ⚙ SETTINGS, all at z:50) get
    // covered on wider windows — the 480-wide sheet above was
    // centered with maxWidth, leaving the corner space uncovered
    // and the floating buttons peeking through behind the sheet.
    <div style={{ position:"fixed", inset:0, background:"#111", zIndex:200, overflowY:"auto" }}>
      <div style={{ maxWidth:480, margin:"0 auto", padding:"24px 20px 80px" }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em" }}>
              SETTINGS
            </div>
            <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:32, fontWeight:300, fontStyle:"italic", color:"#f0ece4", margin:"4px 0 0" }}>
              Your circle
            </h1>
          </div>
          <button
            onClick={onClose}
            style={{ background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:20, width:36, height:36, color:"#888", fontSize:20, cursor:"pointer", lineHeight:1 }}
          >
            ×
          </button>
        </div>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#888", lineHeight:1.5, margin:"8px 0 4px" }}>
          Family shares your kitchen, shopping list, and meal plan — both can add or edit. Friends see only your dietary preferences.
        </p>

        {/* Display name — shown to your family & friends on their screens */}
        <SectionHeader label="YOUR NAME" />
        <div style={{ display:"flex", gap:8 }}>
          <input
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            placeholder="How should you appear to family?"
            maxLength={60}
            style={{ flex:1, padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#f0ece4", outline:"none" }}
          />
          <SmallButton onClick={saveName}>
            {nameBusy ? "…" : nameSaved ? "SAVED ✓" : nameDirty ? "SAVE" : "SAVE"}
          </SmallButton>
        </div>
        {!profile?.name && (
          <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#888", marginTop:6 }}>
            Add your name so your family sees who did what.
          </div>
        )}

        {/* Avatar — collection grid. Users arrive with 8 random
            commons and one auto-assigned as their current; tapping
            any other owned tile switches to it. Locked tiles render
            as silhouettes so the unlock loop reads immediately
            (future loot-box / level-up work grants new rows). */}
        <AvatarSection
          catalog={avatarCatalog}
          owned={ownedAvatars}
          currentSlug={profile?.avatar_slug || null}
          onPin={onPinAvatar}
        />

        {/* My invite code */}
        <SectionHeader label="MY SHARE CODE" />
        <div style={{ display:"flex", alignItems:"center", gap:10, background:"#141414", border:"1px solid #2a2015", borderRadius:14, padding:"18px 18px" }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:26, color:"#f5c842", letterSpacing:"0.18em", fontWeight:600 }}>
              {myCode}
            </div>
            <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#666", marginTop:4 }}>
              Share this with someone so they can add you.
            </div>
          </div>
          <SmallButton onClick={copyCode}>{copied ? "COPIED ✓" : "COPY"}</SmallButton>
        </div>

        {/* Add someone */}
        <SectionHeader label="ADD SOMEONE" />
        <div style={{ display:"flex", gap:8, marginBottom:10 }}>
          <input
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase()); setError(null); }}
            placeholder="THEIR CODE"
            maxLength={8}
            style={{ flex:1, padding:"12px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:16, color:"#f0ece4", outline:"none", letterSpacing:"0.15em", textTransform:"uppercase" }}
          />
        </div>
        <div style={{ display:"flex", gap:0, padding:3, background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:10, marginBottom:10 }}>
          <button
            onClick={() => setKind("family")}
            style={{ flex:1, padding:"8px", background: kind==="family"?"#1e1e1e":"transparent", border:"none", borderRadius:7, fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:600, color: kind==="family"?"#a3d977":"#666", cursor:"pointer", letterSpacing:"0.08em" }}
          >
            FAMILY — SHARE PANTRY + PLAN
          </button>
          <button
            onClick={() => setKind("friend")}
            style={{ flex:1, padding:"8px", background: kind==="friend"?"#1e1e1e":"transparent", border:"none", borderRadius:7, fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:600, color: kind==="friend"?"#77a3d9":"#666", cursor:"pointer", letterSpacing:"0.08em" }}
          >
            FRIEND — PREFS ONLY
          </button>
        </div>
        <button
          onClick={sendInvite}
          disabled={busy || !code.trim()}
          style={{ width:"100%", padding:"14px", background: busy||!code.trim()?"#1a1a1a":"#f5c842", color: busy||!code.trim()?"#444":"#111", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, letterSpacing:"0.08em", cursor: busy||!code.trim()?"not-allowed":"pointer" }}
        >
          {busy ? "SENDING…" : "SEND INVITE →"}
        </button>
        {error && (
          <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#d77777", marginTop:10, padding:"10px 12px", background:"#2a1515", border:"1px solid #3a1e1e", borderRadius:8 }}>
            {error}
          </div>
        )}

        {/* Incoming invites — surfaced first, since they're action-required */}
        {incoming.length > 0 && (
          <>
            <SectionHeader label={`INCOMING (${incoming.length})`} />
            {incoming.map(row => (
              <ConnectionRow onOpenProfile={onOpenProfile}
                key={row.id}
                row={row}
                actions={
                  <>
                    <SmallButton onClick={() => accept(row.id)}>ACCEPT</SmallButton>
                    <GhostButton onClick={() => remove(row.id)}>DENY</GhostButton>
                  </>
                }
              />
            ))}
          </>
        )}

        {/* Family */}
        <SectionHeader label={`FAMILY (${family.length})`} />
        {family.length === 0 ? (
          <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#555", fontStyle:"italic", padding:"14px 2px" }}>
            No one yet. Share your code with someone you live with — you'll both see each other's pantry and meal plan.
          </p>
        ) : (
          family.map(row => (
            <ConnectionRow onOpenProfile={onOpenProfile}
              key={row.id}
              row={row}
              actions={
                <>
                  <GhostButton onClick={() => downgradeToFriend(row.id)}>→ FRIEND</GhostButton>
                  <GhostButton onClick={() => remove(row.id)}>REMOVE</GhostButton>
                </>
              }
            />
          ))
        )}

        {/* Friends */}
        <SectionHeader label={`FRIENDS (${friends.length})`} />
        {friends.length === 0 ? (
          <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#555", fontStyle:"italic", padding:"14px 2px" }}>
            Friends you add here show up with their dietary preferences so you can plan around them.
          </p>
        ) : (
          friends.map(row => (
            <ConnectionRow onOpenProfile={onOpenProfile}
              key={row.id}
              row={row}
              actions={
                <>
                  <GhostButton onClick={() => upgradeToFamily(row.id)}>→ FAMILY</GhostButton>
                  <GhostButton onClick={() => remove(row.id)}>REMOVE</GhostButton>
                </>
              }
            />
          ))
        )}

        {/* Pending outgoing */}
        {outgoing.length > 0 && (
          <>
            <SectionHeader label={`AWAITING REPLY (${outgoing.length})`} />
            {outgoing.map(row => (
              <ConnectionRow onOpenProfile={onOpenProfile}
                key={row.id}
                row={row}
                actions={
                  <GhostButton onClick={() => remove(row.id)}>CANCEL</GhostButton>
                }
              />
            ))}
          </>
        )}

        {/* Push notifications — device-scoped. Each browser + user pair
            subscribes independently; a user signed into the same
            account on laptop + phone ends up with two rows in
            push_subscriptions and gets pushes on both. Opt-in only,
            never prompted at app startup — aggressive prompts train
            users to Block. */}
        <PushNotificationsSection userId={userId} />

        {/* What kinds of notifications to actually receive. Defaults
            are intentionally skewed quiet — "someone added butter to
            the pantry" is off out of the box; meaningful coordination
            (meal scheduled, prep reminders, a friend cooked for you)
            is on. Every toggle here also governs Web Push, because the
            push fanout goes through the notifications table and the
            DB trigger checks should_notify() before inserting. */}
        {userId && <NotificationPreferencesSection userId={userId} />}

        {/* About — release notes entry. Always available so users can
            re-read past notes; also the recovery valve for the silent
            first-paint heuristic in useWhatsNew (new accounts get the
            current version marked-as-seen on first open and need this
            entry to ever see what shipped). */}
        {onOpenReleaseNotes && (
          <>
            <SectionHeader label="ABOUT" />
            <button
              onClick={onOpenReleaseNotes}
              style={{ width:"100%", padding:"14px", background:"#0f1620", border:"1px solid #1f3040", color:"#7eb8d4", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, letterSpacing:"0.1em", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}
            >
              <span>📋 RELEASE NOTES</span>
              <span style={{ color:"#7eb8d4" }}>→</span>
            </button>
          </>
        )}

        {/* Pantry maintenance — opt-in legacy data migrations. Only
            shown to users who have the per-instance pantry refactor
            (always today, post-Phase 1). Splits aggregate bulk rows
            ("amount=50 cans" → 50 sibling rows) so the stacked card
            view applies to data scanned before the refactor. Safe
            to re-run; the RPC's WHERE clause already filters to
            rows that still need splitting. */}
        <SectionHeader label="PANTRY MAINTENANCE" />
        <button
          onClick={runSplit}
          disabled={splitBusy}
          style={{
            width:"100%", padding:"14px",
            background: splitBusy ? "#1a1608" : "#0f1620",
            border:"1px solid #1f3040", color:"#7eb8d4",
            borderRadius:12, fontFamily:"'DM Mono',monospace",
            fontSize:11, letterSpacing:"0.1em",
            cursor: splitBusy ? "wait" : "pointer",
            display:"flex", alignItems:"center", justifyContent:"space-between",
            marginBottom: splitResult ? 8 : 14,
          }}
        >
          <span>🥫 SPLIT BULK ROWS INTO STACKS</span>
          <span>{splitBusy ? "…" : "→"}</span>
        </button>
        {splitResult && (
          <div style={{
            padding:"10px 12px", marginBottom:14,
            background: splitResult.error ? "#1a0a0a" : "#0a1a0a",
            border: `1px solid ${splitResult.error ? "#3a1a1a" : "#1e3a1e"}`,
            borderRadius:10,
            fontFamily:"'DM Sans',sans-serif", fontSize:12,
            color: splitResult.error ? "#ef4444" : "#7ec87e",
            lineHeight: 1.5,
          }}>
            {splitResult.error
              ? `Couldn't split: ${splitResult.error}`
              : splitResult.splitCount === 0
                ? "Nothing to split — your pantry is already per-instance."
                : `Migrated ${splitResult.splitCount} bulk row${splitResult.splitCount === 1 ? "" : "s"} into ${splitResult.totalInstances} stacked instance${splitResult.totalInstances === 1 ? "" : "s"}.`}
          </div>
        )}

        {/* Admin entry — visible only when the viewer's own profile row
            has role='admin' (set via the 0042 migration + a manual
            SQL UPDATE). Intentionally at the bottom near Account so
            it's out of the way for everyday settings edits. */}
        {profile?.role === "admin" && onOpenAdmin && (
          <>
            <SectionHeader label="ADMIN" />
            <button
              onClick={onOpenAdmin}
              style={{ width:"100%", padding:"14px", background:"#1a0a0a", border:"1px solid #3a1a1a", color:"#ef4444", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, letterSpacing:"0.1em", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}
            >
              <span>🛠 ADMIN TOOLS</span>
              <span>→</span>
            </button>
          </>
        )}

        {/* Account footer */}
        <SectionHeader label="ACCOUNT" />
        <button
          onClick={signOut}
          style={{ width:"100%", padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", color:"#888", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, letterSpacing:"0.1em", cursor:"pointer" }}
        >
          SIGN OUT
        </button>
      </div>
    </div>
  );
}

// Per-device push enablement. Renders one of four states:
//   * "not-supported" — browser lacks the APIs (older Safari / non-PWA iOS)
//   * "blocked"       — user denied permission at some point
//   * "off"           — supported + allowed, but no active subscription
//   * "on"            — subscription exists in push_subscriptions
function PushNotificationsSection({ userId }) {
  const { supported, permission, enabled, busy, error, enable, disable } = useWebPush(userId);

  if (!supported) {
    return (
      <>
        <SectionHeader label="NOTIFICATIONS" />
        <div style={{
          padding: "12px 14px", marginBottom: 14,
          background: "#141414", border: "1px solid #252525",
          borderRadius: 12,
          fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#777", lineHeight: 1.5,
        }}>
          This browser can't receive push notifications. On iOS, add
          mise to your home screen (Share → Add to Home Screen) — the
          Safari PWA supports push.
        </div>
      </>
    );
  }

  const blocked = permission === "denied";

  return (
    <>
      <SectionHeader label="NOTIFICATIONS" />
      <div style={{
        padding: "14px 16px", marginBottom: 14,
        background: enabled ? "#0f1a0f" : "#141414",
        border: `1px solid ${enabled ? "#1e3a1e" : "#252525"}`,
        borderRadius: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700,
              color: enabled ? "#7ec87e" : "#888",
              letterSpacing: "0.1em", marginBottom: 4,
            }}>
              ON THIS DEVICE · {enabled ? "ON" : blocked ? "BLOCKED" : "OFF"}
            </div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#bbb", lineHeight: 1.5 }}>
              {enabled
                ? "Family pantry edits, cook-log reviews, scheduled meals, and badge earns will reach you even when mise is closed."
                : blocked
                  ? "You blocked notifications for this site. Unblock in your browser's site settings (🔒 in the address bar) to enable here."
                  : "Get pinged when your family adds something, schedules a meal, or finishes a cook — even when mise is closed."}
            </div>
          </div>
          <button
            onClick={enabled ? disable : enable}
            disabled={busy || blocked}
            style={{
              padding: "10px 14px", flexShrink: 0,
              background: enabled ? "#1a1a1a" : "#f5c842",
              color: enabled ? "#bbb" : "#111",
              border: `1px solid ${enabled ? "#2a2a2a" : "#f5c842"}`,
              borderRadius: 10,
              fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700,
              letterSpacing: "0.08em",
              cursor: (busy || blocked) ? "not-allowed" : "pointer",
              opacity: (busy || blocked) ? 0.5 : 1,
            }}
          >
            {busy ? "…" : enabled ? "TURN OFF" : "ENABLE"}
          </button>
        </div>
        {error && (
          <div style={{
            marginTop: 10, padding: "8px 10px",
            background: "#2a1515", border: "1px solid #3a1e1e",
            color: "#d77777", borderRadius: 8,
            fontFamily: "'DM Sans',sans-serif", fontSize: 12,
          }}>
            {error}
          </div>
        )}
      </div>
    </>
  );
}

// ── Notification preferences ────────────────────────────────────────
// Per-user toggles (stored in notification_preferences, migration 0133).
// Every toggle here gates the DB trigger that inserts into the
// notifications table — so a disabled toggle kills BOTH the in-app row
// AND the Web Push delivery (since push is fanned out from the same
// insert). The "ON THIS DEVICE" switch above toggles push-only; the
// switches below toggle notifications at the source.
//
// The key design decision: pantry activity defaults OFF. The app was
// firing a push on every fridge-door event; that trains users to mute
// the app. Meaningful events (meal scheduled, someone will cook for
// you, a prep reminder) stay on by default because those are the ones
// users actually want.
function PrefToggle({ label, hint, value, onChange, tone = "#f5c842" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 14px", marginBottom: 8,
      background: value ? "#141612" : "#141414",
      border: `1px solid ${value ? "#2a3a1e" : "#1e1e1e"}`,
      borderRadius: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700,
          color: value ? tone : "#888",
          letterSpacing: "0.1em", marginBottom: 4,
        }}>
          {label} · {value ? "ON" : "OFF"}
        </div>
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#999", lineHeight: 1.45 }}>
          {hint}
        </div>
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{
          flexShrink: 0, width: 44, height: 26, padding: 0,
          background: value ? tone : "#2a2a2a",
          border: `1px solid ${value ? tone : "#3a3a3a"}`,
          borderRadius: 13, cursor: "pointer", position: "relative",
          transition: "background 120ms",
        }}
        aria-pressed={value}
        aria-label={`Toggle ${label}`}
      >
        <span style={{
          position: "absolute", top: 2, left: value ? 20 : 2,
          width: 20, height: 20, borderRadius: 10,
          background: value ? "#111" : "#888",
          transition: "left 120ms",
          display: "block",
        }} />
      </button>
    </div>
  );
}

function NotificationPreferencesSection({ userId }) {
  const { preferences, loading, setPref } = useNotificationPreferences(userId);

  if (loading) return null;

  const quietOn = preferences.quiet_hours_start != null && preferences.quiet_hours_end != null;

  const setQuietHours = (start, end) => {
    // Both must be set, or both cleared — mixed state is invalid.
    if (start && end) {
      setPref({ quiet_hours_start: start, quiet_hours_end: end });
    } else {
      setPref({ quiet_hours_start: null, quiet_hours_end: null });
    }
  };

  return (
    <>
      <SectionHeader label="WHAT TO NOTIFY ME ABOUT" />

      <PrefToggle
        label="PREP REMINDERS"
        hint="Start-the-prep reminders before scheduled meals. Cascades all the way back to overnight: freeze the butter at 10pm for tomorrow's pie."
        value={!!preferences.prep_reminders}
        onChange={v => setPref({ prep_reminders: v })}
        tone="#e07a3a"
      />

      <PrefToggle
        label="MEAL COORDINATION"
        hint="Who's cooking, meal rescheduled, requests to cook. Doesn't cover prep — that's above."
        value={!!preferences.meal_coordination}
        onChange={v => setPref({ meal_coordination: v })}
        tone="#7eb8d4"
      />

      <PrefToggle
        label="SOMEONE COOKED FOR YOU"
        hint="When a family member logs a cook and tags you as a diner."
        value={!!preferences.cook_log_diners}
        onChange={v => setPref({ cook_log_diners: v })}
        tone="#c7a8d4"
      />

      <PrefToggle
        label="RECEIPTS"
        hint="One summary per receipt scan. Low volume — the dedup warning fires here too."
        value={!!preferences.receipt_activity}
        onChange={v => setPref({ receipt_activity: v })}
        tone="#b8a878"
      />

      <PrefToggle
        label="PANTRY SCANS"
        hint="Batch summaries when someone scans the fridge/pantry. One line per scan, not per item."
        value={!!preferences.pantry_scan_activity}
        onChange={v => setPref({ pantry_scan_activity: v })}
        tone="#b8a878"
      />

      <PrefToggle
        label="SHOPPING LIST"
        hint="Adds, edits, and removals on the shared shopping list."
        value={!!preferences.shopping_activity}
        onChange={v => setPref({ shopping_activity: v })}
        tone="#7eb8d4"
      />

      <PrefToggle
        label="PANTRY FIDDLING"
        hint="Every time someone adds, renames, or deletes a pantry item. Off by default — this is the noisy one."
        value={!!preferences.pantry_activity}
        onChange={v => setPref({ pantry_activity: v })}
        tone="#a8553a"
      />

      <SectionHeader label="QUIET HOURS" />
      <div style={{
        padding: "12px 14px", marginBottom: 14,
        background: "#141414", border: "1px solid #1e1e1e",
        borderRadius: 12,
      }}>
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#999", lineHeight: 1.5, marginBottom: 10 }}>
          Prep reminders inside this window get shifted EARLIER — a
          freeze-overnight ping scheduled for 2am fires at 9:30pm
          instead so you don't wake up to it (and the butter actually
          gets in the freezer).
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="time"
            value={preferences.quiet_hours_start || ""}
            onChange={e => setQuietHours(e.target.value || null, preferences.quiet_hours_end)}
            style={{
              flex: 1, padding: "10px 12px",
              background: "#0c0c0c", border: "1px solid #2a2a2a",
              color: "#f0ece4", borderRadius: 10,
              fontFamily: "'DM Mono',monospace", fontSize: 13,
            }}
          />
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#666", letterSpacing: "0.1em" }}>TO</span>
          <input
            type="time"
            value={preferences.quiet_hours_end || ""}
            onChange={e => setQuietHours(preferences.quiet_hours_start, e.target.value || null)}
            style={{
              flex: 1, padding: "10px 12px",
              background: "#0c0c0c", border: "1px solid #2a2a2a",
              color: "#f0ece4", borderRadius: 10,
              fontFamily: "'DM Mono',monospace", fontSize: 13,
            }}
          />
          {quietOn && (
            <button
              onClick={() => setQuietHours(null, null)}
              style={{
                padding: "10px 12px", background: "#1a1a1a", color: "#888",
                border: "1px solid #2a2a2a", borderRadius: 10,
                fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.08em",
                cursor: "pointer",
              }}
            >
              CLEAR
            </button>
          )}
        </div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#555", letterSpacing: "0.1em", marginTop: 10 }}>
          TIMEZONE · {preferences.timezone || "UTC"}
        </div>
      </div>
    </>
  );
}
