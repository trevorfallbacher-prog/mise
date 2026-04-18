import { useCallback, useEffect, useMemo, useState } from "react";
import Onboarding from "./components/Onboarding";
import Home from "./components/Home";
import Courses from "./components/Courses";
import Plan from "./components/Plan";
import QuickCook from "./components/QuickCook";
import Kitchen from "./components/Kitchen";
import SignIn from "./components/SignIn";
import Settings from "./components/Settings";
import AdminPanel from "./components/AdminPanel";
import NotificationsPanel from "./components/NotificationsPanel";
import UserProfile from "./components/UserProfile";
import WhatsNewNotification from "./components/WhatsNewNotification";
import ReleaseNotesModal from "./components/ReleaseNotesModal";
import { useWhatsNew } from "./lib/useWhatsNew";
import { useAuth } from "./lib/useAuth";
import { useProfile } from "./lib/useProfile";
import { usePantry } from "./lib/usePantry";
import { useShoppingList } from "./lib/useShoppingList";
import { useRelationships } from "./lib/useRelationships";
import { useNotifications } from "./lib/useNotifications";
import { ToastProvider, useToast } from "./lib/toast";
import { supabase } from "./lib/supabase";
import { IngredientInfoProvider } from "./lib/useIngredientInfo";

// Four regular tabs + a floating ➕ Quick Cook button slotted between
// slot 2 (COURSES) and slot 3 (CALENDAR). The ➕ is not a tab — it opens
// an overlay chooser, so the currently-active tab stays active underneath.
const NAV = [
  { id:"home",    emoji:"🏠",   label:"Home"     },
  { id:"courses", emoji:"🎓",   label:"Courses"  },
  { id:"plan",    emoji:"📅",   label:"Calendar" },
  { id:"pantry",  emoji:"🍽️",  label:"Kitchen"  },
];

const pageShell = {
  minHeight: "100vh",
  background: "#111",
  color: "#f5f5f0",
  maxWidth: 480,
  margin: "0 auto",
};

function LoadingSplash() {
  return (
    <div style={{ ...pageShell, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ fontSize: 40, animation: "pulse 1.2s ease-in-out infinite" }}>👨‍🍳</div>
      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:1} }`}</style>
    </div>
  );
}

// Best-effort name from whatever the auth provider gave us.
// Google returns full_name / given_name / family_name; magic-link gives nothing.
function nameFromAuth(user) {
  const md = user?.user_metadata || {};
  return (
    md.full_name ||
    md.name ||
    [md.given_name, md.family_name].filter(Boolean).join(" ") ||
    null
  );
}

export default function App() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, upsert: upsertProfile } =
    useProfile(user?.id);

  // On first sign-in (or if an older account has no name yet), save whatever
  // the provider gave us so Home can personalise greetings.
  useEffect(() => {
    if (!user || profileLoading) return;
    const googleName = nameFromAuth(user);
    if (!profile) {
      upsertProfile({ name: googleName }).catch(console.error);
    } else if (!profile.name && googleName) {
      upsertProfile({ name: googleName }).catch(console.error);
    }
  }, [user, profile, profileLoading, upsertProfile]);

  if (authLoading) return <LoadingSplash />;

  if (!user) {
    return (
      <div style={{ ...pageShell, backgroundImage:"radial-gradient(ellipse at 30% 0%,#1e1408 0%,transparent 60%)" }}>
        <SignIn />
      </div>
    );
  }

  if (profileLoading) return <LoadingSplash />;

  if (!profile || !profile.dietary) {
    return (
      <div style={{ ...pageShell, backgroundImage:"radial-gradient(ellipse at 30% 0%,#1e1408 0%,transparent 60%)" }}>
        <Onboarding
          onComplete={async (answers) => {
            await upsertProfile({
              dietary:     answers.dietary,
              vegan_style: answers.veganStyle || null,
              level:       answers.level,
              goal:        answers.goal,
            });
          }}
        />
      </div>
    );
  }

  // ToastProvider wraps the authenticated tree so useToast() works inside
  // the hooks that hang off of user data (usePantry's realtime callback etc.).
  return (
    <ToastProvider>
      <IngredientInfoProvider>
        <AuthedApp user={user} profile={profile} upsertProfile={upsertProfile} />
      </IngredientInfoProvider>
    </ToastProvider>
  );
}

// The authenticated app tree. Lives inside ToastProvider so realtime
// callbacks can raise toasts.
function AuthedApp({ user, profile, upsertProfile }) {
  const [tab, setTab] = useState("home");
  const { push: pushToast } = useToast();

  // What's-new notification state. Compares the bundled CURRENT_VERSION
  // against the user's locally-stored last-seen version; surfaces a
  // slim notification + (on tap) the full ReleaseNotesModal. First-paint
  // unknown-history is silent — see useWhatsNew.js for the rationale.
  const whatsNew = useWhatsNew();

  // NOTE: the ingredient_info seed + fetch used to live here as a separate
  // useEffect. It's now consolidated inside IngredientInfoProvider so the
  // seeded data is actually in React state (not just in the DB) by the
  // time IngredientCard mounts — zero delay on card opens after first
  // paint. See src/lib/useIngredientInfo.js.

  const relationships = useRelationships(user?.id);
  const { familyKey } = relationships;

  // userId → display name lookup. Still useful for in-UI attribution
  // ("+ Butter added by Alice") even though notification text is now
  // pre-formatted server-side.
  const nameFor = useMemo(() => {
    const map = new Map();
    if (user?.id) map.set(user.id, profile?.name ? `${profile.name.split(/\s+/)[0]} (you)` : "You");
    for (const row of [...relationships.family, ...relationships.friends]) {
      const first = row.other?.name?.split(/\s+/)[0];
      if (row.otherId) map.set(row.otherId, first || "Family");
    }
    return (id) => map.get(id) || "Someone";
  }, [user?.id, profile?.name, relationships.family, relationships.friends]);

  // Pantry + shopping list still subscribe to realtime so their UI updates
  // when family edits land — but we no longer raise toasts from them. Toasts
  // are now driven by the inbound notifications row (which the DB trigger
  // produces), so all surfaces stay in sync with one another.
  const [pantry, setPantry]               = usePantry(user?.id, familyKey);
  const [shoppingList, setShoppingList]   = useShoppingList(user?.id, familyKey);

  // Persistent inbox + ephemeral toast + browser notification, all wired off
  // a single inbound stream.
  const onNewNotification = useCallback((row) => {
    pushToast(row.msg, { emoji: row.emoji || "🔔", kind: row.kind || "info" });
    // OS-level notification while the tab is hidden so users get pinged even
    // when mise isn't the active tab. Permission is requested lazily on
    // bell-click below; if it was never granted this is a silent no-op.
    if (typeof document !== "undefined" && document.hidden &&
        typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification("mise", { body: `${row.emoji || ""} ${row.msg}`.trim(), tag: row.id }); }
      catch (e) { /* some browsers throw on Service-Worker-only contexts */ }
    }
  }, [pushToast]);

  const notifications = useNotifications(user?.id, { onNew: onNewNotification });

  const [pantryView, setPantryView]       = useState("stock"); // "stock" | "shopping"
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [notifsOpen, setNotifsOpen]       = useState(false);
  // Quick Cook chooser overlay. Opened by the floating ➕ in the tab
  // bar; renders on top of whatever tab is currently active.
  const [quickCookOpen, setQuickCookOpen] = useState(false);
  // Admin-panel open state. Only reachable via Settings → ADMIN entry,
  // which is itself gated on profile.role === 'admin' (0042).
  const [adminOpen, setAdminOpen]         = useState(false);
  // deepLink is set when a notification tap wants to navigate. Cookbook
  // consumes it on mount and calls setDeepLink(null) to clear.
  // Shape: { kind: 'cook_log', id: '<uuid>' } | null
  const [deepLink, setDeepLink]           = useState(null);
  // Whose profile is open, if any. A string user id; null = closed.
  // Lives at App level so every surface (Settings, Cookbook, etc) can
  // route into the same overlay.
  const [profileUserId, setProfileUserId] = useState(null);
  const incomingCount = relationships.incoming.length;

  // Classify a user id relative to the viewer so the UserProfile overlay
  // shows the right chip and doesn't tease cook history it won't have.
  const relationshipFor = useCallback((id) => {
    if (!id || id === user.id) return "self";
    if (relationships.family.some(r => r.otherId === id))  return "family";
    if (relationships.friends.some(r => r.otherId === id)) return "friend";
    return "stranger";
  }, [user.id, relationships.family, relationships.friends]);

  const openProfile = useCallback((id) => {
    if (!id) return;
    // Close other overlays so the user doesn't stack screens.
    setSettingsOpen(false);
    setNotifsOpen(false);
    setProfileUserId(id);
  }, []);

  // Same deep-link path the UserProfile's CookRow uses — lets the Home
  // feed hand a cook_log id and surface the meal's detail. Cookbook is
  // no longer a top-level tab (v0.11.0 nav restructure); the full
  // archive now lives inside UserProfile behind "VIEW FULL COOKBOOK",
  // so we open the viewer's own profile with the deep-link attached
  // and let UserProfile's Cookbook overlay consume it.
  const openCook = useCallback((cookLogId) => {
    if (!cookLogId) return;
    setDeepLink({ kind: "cook_log", id: cookLogId });
    setProfileUserId(user.id);
  }, [user?.id]);

  // Stabilized list of family otherIds for the activity feed cohort.
  const familyIds = useMemo(
    () => relationships.family.map(r => r.otherId).filter(Boolean),
    [relationships.family]
  );

  // Route a notification tap. Currently supported:
  //   * 'cook_log'     — lands on Cookbook → that meal's detail,
  //                      composer open if the viewer was a diner.
  //   * 'user_profile' — opens the target user's profile overlay (used
  //                      by badge earn/fan-out notifications so a tap
  //                      lands on the badge wall).
  //   * 'receipt'      — lands on Kitchen tab and opens ReceiptView on
  //                      the receipt row (photo, total, item list).
  //                      Populated by migration 0040.
  //   * 'pantry_scan'  — same as receipt but for a fridge/pantry/
  //                      freezer scan artifact (pantry_scans.id).
  // Unknown kinds fall through silently so future server-side targets
  // ship without breaking old clients.
  const openNotificationTarget = useCallback((targetKind, targetId) => {
    if (!targetId) return;
    if (targetKind === "cook_log") {
      // Cookbook tab was removed in v0.11.0. Route through the viewer's
      // own UserProfile → Cookbook overlay, which consumes the deep-link
      // exactly the same way the tab did.
      setDeepLink({ kind: targetKind, id: targetId });
      setNotifsOpen(false);
      setProfileUserId(user.id);
      return;
    }
    if (targetKind === "user_profile") {
      setNotifsOpen(false);
      setProfileUserId(targetId);
      return;
    }
    if (targetKind === "receipt" || targetKind === "pantry_scan") {
      setDeepLink({ kind: targetKind, id: targetId });
      setPantryView("stock");
      setTab("pantry");
      setNotifsOpen(false);
      return;
    }
  }, []);

  // Lazy permission request — only on explicit bell click so we don't prompt
  // on first paint.
  const openNotifs = useCallback(() => {
    setNotifsOpen(true);
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => { /* user declined */ });
    }
  }, []);

  // Service-worker registration for Web Push. Registering doesn't
  // prompt or do anything visible — it just makes the SW available
  // so Settings → Enable can subscribe when the user opts in. Kept
  // idempotent because registering the same script twice is a no-op
  // per spec; React's Strict Mode double-invoke during dev is fine.
  //
  // The SW also dispatches `notification-tap` postMessages when a
  // user taps a push while mise is open — we route those through
  // openNotificationTarget so the deep-link behavior matches what
  // the bell panel does for the same rows.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(err => {
      console.error("[sw] registration failed:", err);
    });
    const onMessage = (event) => {
      const msg = event.data;
      if (!msg || msg.kind !== "notification-tap") return;
      const { target_kind, target_id } = msg.payload || {};
      if (target_kind && target_id) {
        openNotificationTarget(target_kind, target_id);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [openNotificationTarget]);

  // Deep-link via URL query — used when the user taps a push and no
  // mise tab was open, so the SW opens a new window with
  // ?target_kind=…&target_id=…. Consume the params on first load,
  // route, then clear the URL so a refresh doesn't re-trigger.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const targetKind = params.get("target_kind");
    const targetId   = params.get("target_id");
    if (targetKind && targetId) {
      openNotificationTarget(targetKind, targetId);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [openNotificationTarget]);

  return (
    <div style={{ ...pageShell, backgroundImage:"radial-gradient(ellipse at 70% 100%,#1a1209 0%,transparent 60%)" }}>
      <button
        onClick={() => setSettingsOpen(true)}
        title="Settings"
        style={{
          position: "fixed", top: 12, right: 12, zIndex: 50,
          background: "#161616", border: "1px solid #2a2a2a",
          borderRadius: 20, width: 36, height: 36,
          color: "#aaa", fontSize: 18, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        ⚙
        {incomingCount > 0 && (
          <span style={{ position:"absolute", top:-2, right:-2, width:14, height:14, borderRadius:7, background:"#f5c842", color:"#111", fontFamily:"'DM Mono',monospace", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>
            {incomingCount}
          </span>
        )}
      </button>

      {/* Admin quick-link — pill in the top-left that both confirms
          elevated permissions and opens the admin portal in one tap.
          Previously display-only; now the primary entry point so the
          admin doesn't have to walk Settings → ADMIN TOOLS. */}
      {profile?.role === "admin" && (
        <button
          onClick={() => setAdminOpen(true)}
          title="Open admin tools"
          aria-label="Open admin tools"
          style={{
            position: "fixed", top: 12, left: 12, zIndex: 50,
            background: "#2a0a0a",
            border: "1px solid #ef4444",
            color: "#ef4444",
            borderRadius: 14, padding: "4px 10px",
            fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
            letterSpacing: "0.14em",
            display: "flex", alignItems: "center", gap: 6,
            cursor: "pointer",
          }}
        >
          🛠 ADMIN
        </button>
      )}

      <button
        onClick={openNotifs}
        title="Notifications"
        style={{
          position: "fixed", top: 12, right: 56, zIndex: 50,
          background: "#161616", border: "1px solid #2a2a2a",
          borderRadius: 20, width: 36, height: 36,
          color: "#aaa", fontSize: 16, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        🔔
        {(() => {
          // Badge counts real unread notifications PLUS the synthetic
          // release-notes pin when an unacknowledged release exists.
          // Mirrors what the user actually sees when they open the
          // panel — pin is rendered as if it were one extra row.
          const total = notifications.unreadCount + (whatsNew.showNotification ? 1 : 0);
          if (total <= 0) return null;
          return (
            <span style={{ position:"absolute", top:-2, right:-2, minWidth:14, height:14, padding:"0 3px", borderRadius:7, background:"#f5c842", color:"#111", fontFamily:"'DM Mono',monospace", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>
              {total > 99 ? "99+" : total}
            </span>
          );
        })()}
      </button>

      <div style={{ paddingBottom:80 }}>
        {tab === "home"     && (
          <Home
            profile={profile}
            userId={user.id}
            familyIds={familyIds}
            familyLoading={relationships.loading}
            nameFor={nameFor}
            openProfile={openProfile}
            openCook={openCook}
          />
        )}
        {tab === "courses"  && (
          <Courses
            profile={profile}
            userId={user.id}
            familyKey={familyKey}
            pantry={pantry}
            setPantry={setPantry}
            shoppingList={shoppingList}
            setShoppingList={setShoppingList}
            onGoToShopping={() => { setPantryView("shopping"); setTab("pantry"); }}
            family={relationships.family}
            friends={relationships.friends}
            onCooked={() => setProfileUserId(user.id)}
          />
        )}
        {tab === "plan"     && (
          <Plan
            profile={profile}
            userId={user.id}
            familyKey={familyKey}
            nameFor={nameFor}
            hasFamily={relationships.family.length > 0}
            family={relationships.family}
            friends={relationships.friends}
            pantry={pantry}
            setPantry={setPantry}
            shoppingList={shoppingList}
            setShoppingList={setShoppingList}
            onGoToShopping={() => { setPantryView("shopping"); setTab("pantry"); }}
            onOpenCook={openCook}
          />
        )}
        {tab === "pantry"   && (
          <Kitchen
            userId={user.id}
            pantry={pantry}
            setPantry={setPantry}
            shoppingList={shoppingList}
            setShoppingList={setShoppingList}
            familyIds={familyIds}
            view={pantryView}
            setView={setPantryView}
            deepLink={deepLink}
            onDeepLinkConsumed={() => setDeepLink(null)}
          />
        )}
      </div>

      {settingsOpen && (
        <Settings
          userId={user.id}
          profile={profile}
          relationships={relationships}
          upsertProfile={upsertProfile}
          onClose={() => setSettingsOpen(false)}
          onOpenProfile={openProfile}
          // Re-open release notes from Settings — covers both casual
          // re-reading and the silent first-paint heuristic in
          // useWhatsNew (new users get notes silently marked-as-seen
          // and need this entry to ever see them).
          onOpenReleaseNotes={() => { setSettingsOpen(false); whatsNew.openFromSettings(); }}
          onOpenAdmin={() => { setSettingsOpen(false); setAdminOpen(true); }}
        />
      )}

      {adminOpen && (
        <AdminPanel
          userId={user.id}
          onClose={() => setAdminOpen(false)}
        />
      )}

      {profileUserId && (
        <UserProfile
          targetUserId={profileUserId}
          viewerId={user.id}
          relationship={relationshipFor(profileUserId)}
          familyKey={familyKey}
          nameFor={nameFor}
          deepLink={deepLink}
          onConsumeDeepLink={() => setDeepLink(null)}
          onOpenProfile={openProfile}
          onOpenCook={(cookId) => {
            // Cookbook is now an overlay inside UserProfile, so we
            // stay on this profile and just hand the deep link in —
            // the embedded Cookbook opens the detail once it resolves.
            setDeepLink({ kind: "cook_log", id: cookId });
          }}
          onClose={() => setProfileUserId(null)}
        />
      )}

      {notifsOpen && (
        <NotificationsPanel
          notifications={notifications.notifications}
          loading={notifications.loading}
          unreadCount={notifications.unreadCount}
          markAllRead={notifications.markAllRead}
          dismiss={notifications.dismiss}
          clearAll={notifications.clearAll}
          onClose={() => setNotifsOpen(false)}
          onOpen={openNotificationTarget}
          // Pinned release-notes entry — only when there's an
          // unacknowledged release. whatsNew.showNotification is the
          // single source of truth for "user hasn't seen this version
          // yet" — if the slim modal is/was eligible to fire, the
          // panel pin is too. Tap routes to the full modal (closes
          // panel first so the modal isn't buried), dismiss marks
          // the version as seen via useWhatsNew.
          pinned={whatsNew.showNotification ? [{
            id: `release-${whatsNew.latestVersion || "current"}`,
            emoji: "📋",
            msg: whatsNew.latestTitle || "What's new in this release",
            sublabel: `v${whatsNew.latestVersion || ""} · TAP TO READ`,
            onTap: () => { setNotifsOpen(false); whatsNew.openFromSettings(); },
            onDismiss: () => whatsNew.dismiss(),
          }] : []}
          // Always-available footer link to browse past notes anytime.
          // Closes the panel first so the modal lands clean.
          onOpenReleaseNotes={() => { setNotifsOpen(false); whatsNew.openFromSettings(); }}
        />
      )}

      {/* Bottom tab bar — four regular tabs (HOME · COURSES · CALENDAR ·
          KITCHEN) with a floating ➕ Quick Cook button slotted between
          tabs 2 and 3. The ➕ isn't a tab — tapping it opens QuickCook
          as a full-screen overlay on top of whichever tab is active. */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, maxWidth:480, margin:"0 auto", background:"#0f0f0f", borderTop:"1px solid #1e1e1e", display:"flex", padding:"12px 0 20px" }}>
        {NAV.slice(0, 2).map(({ id, emoji, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, opacity: tab===id ? 1 : 0.35, transition:"opacity 0.2s" }}>
            <span style={{ fontSize:20 }}>{emoji}</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color: tab===id?"#f5c842":"#666", letterSpacing:"0.08em" }}>
              {label.toUpperCase()}
            </span>
          </button>
        ))}

        {/* Floating ➕ — raised circle, reserves a flex slot so the
            labels on either side don't collide with it. */}
        <div style={{ flex:1, display:"flex", justifyContent:"center", alignItems:"flex-start" }}>
          <button
            onClick={() => setQuickCookOpen(true)}
            title="Quick Cook"
            aria-label="Quick Cook"
            style={{
              width:56, height:56, borderRadius:28,
              background:"#f5c842", color:"#111",
              border:"none", cursor:"pointer",
              fontSize:28, lineHeight:1, fontWeight:300,
              display:"flex", alignItems:"center", justifyContent:"center",
              transform:"translateY(-18px)",
              boxShadow:"0 6px 18px rgba(245,200,66,0.35), 0 2px 6px rgba(0,0,0,0.45)",
            }}
          >
            +
          </button>
        </div>

        {NAV.slice(2).map(({ id, emoji, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, opacity: tab===id ? 1 : 0.35, transition:"opacity 0.2s" }}>
            <span style={{ fontSize:20 }}>{emoji}</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color: tab===id?"#f5c842":"#666", letterSpacing:"0.08em" }}>
              {label.toUpperCase()}
            </span>
          </button>
        ))}
      </div>

      {/* Quick Cook overlay — the three-branch chooser (custom / AI /
          template) launched by the floating ➕ above. Returns via
          onClose. onCooked fires after CookMode's done-flow so we can
          land the user on their own profile archive where the freshly
          logged cook surfaces. */}
      {quickCookOpen && (
        <QuickCook
          userId={user.id}
          profile={profile}
          familyKey={familyKey}
          pantry={pantry}
          setPantry={setPantry}
          shoppingList={shoppingList}
          setShoppingList={setShoppingList}
          onGoToShopping={() => { setPantryView("shopping"); setTab("pantry"); setQuickCookOpen(false); }}
          family={relationships.family}
          friends={relationships.friends}
          onClose={() => setQuickCookOpen(false)}
          onCooked={() => {
            setQuickCookOpen(false);
            setProfileUserId(user.id);
          }}
        />
      )}

      {/* Post-update notification + full release-notes modal. The slim
          notification opens automatically via useWhatsNew when the
          bundled version differs from the user's last-seen; the full
          modal opens from "SEE WHAT'S NEW" or (later) Settings. */}
      {whatsNew.showNotification && (
        <WhatsNewNotification
          onSeeWhatsNew={whatsNew.openFull}
          onDismiss={whatsNew.dismiss}
        />
      )}
      {whatsNew.showFullModal && (
        <ReleaseNotesModal onClose={whatsNew.closeFull} />
      )}
    </div>
  );
}
