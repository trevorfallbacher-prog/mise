import { useCallback, useEffect, useMemo, useState } from "react";
import Onboarding from "./components/Onboarding";
import Home from "./components/Home";
import Cook from "./components/Cook";
import Plan from "./components/Plan";
import Cookbook from "./components/Cookbook";
import Pantry from "./components/Pantry";
import SignIn from "./components/SignIn";
import Settings from "./components/Settings";
import NotificationsPanel from "./components/NotificationsPanel";
import UserProfile from "./components/UserProfile";
import { useAuth } from "./lib/useAuth";
import { useProfile } from "./lib/useProfile";
import { usePantry } from "./lib/usePantry";
import { useShoppingList } from "./lib/useShoppingList";
import { useRelationships } from "./lib/useRelationships";
import { useNotifications } from "./lib/useNotifications";
import { ToastProvider, useToast } from "./lib/toast";

const NAV = [
  { id:"home",     emoji:"🏠",   label:"Home"     },
  { id:"cook",     emoji:"🧑‍🍳", label:"Cook"     },
  { id:"plan",     emoji:"📅",   label:"Plan"     },
  { id:"cookbook", emoji:"📖",   label:"Cookbook" },
  { id:"pantry",   emoji:"🥫",   label:"Pantry"   },
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
      <AuthedApp user={user} profile={profile} upsertProfile={upsertProfile} />
    </ToastProvider>
  );
}

// The authenticated app tree. Lives inside ToastProvider so realtime
// callbacks can raise toasts.
function AuthedApp({ user, profile, upsertProfile }) {
  const [tab, setTab] = useState("home");
  const { push: pushToast } = useToast();

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
  // feed hand a cook_log id and land on its detail in Cookbook.
  const openCook = useCallback((cookLogId) => {
    if (!cookLogId) return;
    setProfileUserId(null);
    setDeepLink({ kind: "cook_log", id: cookLogId });
    setTab("cookbook");
  }, []);

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
  // Unknown kinds fall through silently so future server-side targets
  // ship without breaking old clients.
  const openNotificationTarget = useCallback((targetKind, targetId) => {
    if (!targetId) return;
    if (targetKind === "cook_log") {
      setDeepLink({ kind: targetKind, id: targetId });
      setTab("cookbook");
      setNotifsOpen(false);
      return;
    }
    if (targetKind === "user_profile") {
      setNotifsOpen(false);
      setProfileUserId(targetId);
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
        {notifications.unreadCount > 0 && (
          <span style={{ position:"absolute", top:-2, right:-2, minWidth:14, height:14, padding:"0 3px", borderRadius:7, background:"#f5c842", color:"#111", fontFamily:"'DM Mono',monospace", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>
            {notifications.unreadCount > 99 ? "99+" : notifications.unreadCount}
          </span>
        )}
      </button>

      <div style={{ paddingBottom:80 }}>
        {tab === "home"     && (
          <Home
            profile={profile}
            userId={user.id}
            familyIds={familyIds}
            nameFor={nameFor}
            openProfile={openProfile}
            openCook={openCook}
          />
        )}
        {tab === "cook"     && (
          <Cook
            profile={profile}
            userId={user.id}
            onCooked={() => setTab("cookbook")}
            pantry={pantry}
            shoppingList={shoppingList}
            setShoppingList={setShoppingList}
            onGoToShopping={() => { setPantryView("shopping"); setTab("pantry"); }}
            family={relationships.family}
            friends={relationships.friends}
            hasFamily={relationships.family.length > 0}
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
            shoppingList={shoppingList}
            setShoppingList={setShoppingList}
            onGoToShopping={() => { setPantryView("shopping"); setTab("pantry"); }}
          />
        )}
        {tab === "cookbook" && (
          <Cookbook
            userId={user.id}
            familyKey={familyKey}
            nameFor={nameFor}
            deepLink={deepLink}
            onConsumeDeepLink={() => setDeepLink(null)}
            onOpenProfile={openProfile}
          />
        )}
        {tab === "pantry"   && (
          <Pantry
            userId={user.id}
            pantry={pantry}
            setPantry={setPantry}
            shoppingList={shoppingList}
            setShoppingList={setShoppingList}
            view={pantryView}
            setView={setPantryView}
          />
        )}
      </div>

      {settingsOpen && (
        <Settings
          profile={profile}
          relationships={relationships}
          upsertProfile={upsertProfile}
          onClose={() => setSettingsOpen(false)}
          onOpenProfile={openProfile}
        />
      )}

      {profileUserId && (
        <UserProfile
          targetUserId={profileUserId}
          viewerId={user.id}
          relationship={relationshipFor(profileUserId)}
          nameFor={nameFor}
          onOpenCook={(cookId) => {
            // Route through the existing cook_log deep-link: close
            // the profile, switch to the Cookbook tab, and let it open
            // the detail once it finds the row in either scope.
            setProfileUserId(null);
            setDeepLink({ kind: "cook_log", id: cookId });
            setTab("cookbook");
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
        />
      )}

      <div style={{ position:"fixed", bottom:0, left:0, right:0, maxWidth:480, margin:"0 auto", background:"#0f0f0f", borderTop:"1px solid #1e1e1e", display:"flex", padding:"12px 0 20px" }}>
        {NAV.map(({ id, emoji, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, opacity: tab===id ? 1 : 0.35, transition:"opacity 0.2s" }}>
            <span style={{ fontSize:20 }}>{emoji}</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color: tab===id?"#f5c842":"#666", letterSpacing:"0.08em" }}>
              {label.toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
