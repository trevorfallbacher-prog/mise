import { useState } from "react";
import { signOut } from "../lib/useAuth";

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
        <div style={{ width:40, height:40, borderRadius:20, background:"#2a2015", color:"#f5c842", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:500, flexShrink:0 }}>
          {initial}
        </div>
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

/**
 * Settings screen. Shown as a full overlay — tap the × to close.
 *
 * Props:
 *   profile         — current user's profile row (needs .invite_code)
 *   relationships   — object returned by useRelationships()
 *   onClose         — close the overlay
 *   onEditProfile   — (optional) open the profile editor
 */
export default function Settings({ profile, relationships, upsertProfile, onClose, onOpenProfile, onOpenReleaseNotes }) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState("family"); // "family" | "friend"
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
    <div style={{ position:"fixed", inset:0, background:"#111", zIndex:200, maxWidth:480, margin:"0 auto", overflowY:"auto" }}>
      <div style={{ padding:"24px 20px 80px" }}>
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
