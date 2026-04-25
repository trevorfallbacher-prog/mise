import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Onboarding from "./components/Onboarding";
import Home from "./components/Home";
import Courses from "./components/Courses";
import Plan from "./components/Plan";
import CreateMenu from "./components/CreateMenu";
import Kitchen from "./components/Kitchen";
import SignIn from "./components/SignIn";
import Settings from "./components/Settings";
import AdminPanel from "./components/AdminPanel";
import NotificationsPanel from "./components/NotificationsPanel";
import UserProfile from "./components/UserProfile";
import WhatsNewNotification from "./components/WhatsNewNotification";
import ReleaseNotesModal from "./components/ReleaseNotesModal";
import LevelUpCeremony from "./components/LevelUpCeremony";
import XpToastStack from "./components/XpToastStack";
import CookMode from "./components/CookMode";
import CookBanner from "./components/CookBanner";
import MCMCookingShowcase from "./experiments/mcm-cooking/Showcase";
import MCMKitchenScreen, { MCMAddDraftSheet } from "./experiments/mcm-cooking/KitchenScreen";
import { ThemeProvider as MCMThemeProvider } from "./experiments/mcm-cooking/theme";
import ItemCard from "./components/ItemCard";
import { useActiveCookSession } from "./lib/useActiveCookSession";
import { useUserRecipes } from "./lib/useUserRecipes";
import { useWhatsNew } from "./lib/useWhatsNew";
import { useAuth } from "./lib/useAuth";
import { useProfile } from "./lib/useProfile";
import { useAvatars } from "./lib/useAvatars";
import { usePantry } from "./lib/usePantry";
import { useShoppingList } from "./lib/useShoppingList";
import { useMonthlySpend } from "./lib/useMonthlySpend";
import ReceiptHistoryModal from "./components/ReceiptHistoryModal";
import { useRelationships } from "./lib/useRelationships";
import { useNotifications } from "./lib/useNotifications";
import { ToastProvider, useToast } from "./lib/toast";
import { supabase } from "./lib/supabase";
import { IngredientInfoProvider } from "./lib/useIngredientInfo";
import { BrandNutritionProvider } from "./lib/useBrandNutrition";

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

// Experimental MCM/liquid-glass cooking-app showcase, reachable via
// `#mcm-cooking` in the URL hash. Kept entirely separate from the
// main dark app — it short-circuits App() before any auth / data
// hooks run, so it's a pure design sandbox.
function useHashRoute() {
  const [hash, setHash] = useState(() =>
    typeof window !== "undefined" ? window.location.hash : ""
  );
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHashRoute();
  if (hash === "#mcm-cooking") return <MCMCookingShowcase />;

  return <MainApp />;
}

function MainApp() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, upsert: upsertProfile, patchLocal: patchProfile } =
    useProfile(user?.id);

  // Avatar catalog + owned pool + pin RPC. Single source of truth
  // for anything character-avatar related — Settings renders the
  // collection grid and drives pin. See migrations 0117/0118 for
  // the backend.
  const avatars = useAvatars(user?.id);

  // On first sign-in (or if an older account has no name yet), save whatever
  // the provider gave us so Home can personalise greetings. Avatars are
  // no longer sourced from the OAuth session — we use an in-game catalog
  // (migration 0117) so users feel like a character, not themselves. The
  // starter-grant RPC seeds their pool + picks an initial avatar_slug
  // the first time they land.
  useEffect(() => {
    if (!user || profileLoading) return;
    const googleName = nameFromAuth(user);
    if (!profile) {
      upsertProfile({ name: googleName }).catch(console.error);
    } else if (!profile.name && googleName) {
      upsertProfile({ name: googleName }).catch(console.error);
    }
  }, [user, profile, profileLoading, upsertProfile]);

  // Grant starter avatars as soon as the user + catalog are both
  // loaded. RPC short-circuits if they already own anything. The
  // returned row carries the active slug / URL — patch the local
  // profile so the first render after sign-in already shows a
  // character instead of the initial-letter fallback.
  useEffect(() => {
    if (!user?.id) return;
    if (!avatars.ready) return;
    let cancelled = false;
    (async () => {
      const result = await avatars.grantStarters();
      if (cancelled || !result) return;
      patchProfile({ avatar_slug: result.slug, avatar_url: result.url });
    })();
    return () => { cancelled = true; };
  }, [user?.id, avatars.ready, avatars.grantStarters, patchProfile]);

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
              dietary:           answers.dietary,
              vegan_style:       answers.veganStyle || null,
              skill_self_report: answers.level,
              goal:              answers.goal,
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
        <BrandNutritionProvider>
          <AuthedApp
            user={user}
            profile={profile}
            upsertProfile={upsertProfile}
            patchProfile={patchProfile}
            avatars={avatars}
          />
        </BrandNutritionProvider>
      </IngredientInfoProvider>
    </ToastProvider>
  );
}

// The authenticated app tree. Lives inside ToastProvider so realtime
// callbacks can raise toasts.
function AuthedApp({ user, profile, upsertProfile, patchProfile, avatars }) {
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

  // Parallel lookup for the user's profile picture. Relationships rows
  // carry avatar_url (see useRelationships select), the viewer's own
  // row carries it via useProfile. Activity feed rows only have an
  // actorId — this closure hands them the URL without re-fetching
  // per row.
  const avatarFor = useMemo(() => {
    const map = new Map();
    if (user?.id && profile?.avatar_url) map.set(user.id, profile.avatar_url);
    for (const row of [...relationships.family, ...relationships.friends]) {
      if (row.otherId && row.other?.avatar_url) {
        map.set(row.otherId, row.other.avatar_url);
      }
    }
    return (id) => map.get(id) || null;
  }, [user?.id, profile?.avatar_url, relationships.family, relationships.friends]);

  // Pantry + shopping list still subscribe to realtime so their UI updates
  // when family edits land — but we no longer raise toasts from them. Toasts
  // are now driven by the inbound notifications row (which the DB trigger
  // produces), so all surfaces stay in sync with one another.
  const [pantry, setPantry, pantryLoading] = usePantry(user?.id, familyKey);
  // Monthly receipt spend for the hero spend chip. Cheap query
  // (scoped to the current month, user's own receipts) — refreshKey
  // stays 0 since realtime pantry/receipt changes don't need to
  // re-trigger this often.
  const { cents: spendCents } = useMonthlySpend(user?.id);
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
  // --- MCM pantry state ---------------------------------------------
  // `mcmOpenItem` — which pantry row is open in the shared ItemCard
  // overlay, set when the user taps a card in MCM's grid. Null
  // when nothing is open. Kept at App level so the overlay renders
  // above the MCM screen instead of inside its motion wrapper
  // (which would clip modals and duplicate portals).
  const [mcmOpenItem, setMcmOpenItem]     = useState(null);
  // Whether the MCM-hero receipt button has opened the receipt-
  // history modal. Rendered at App-level (not inside MCM) so the
  // modal stacks above everything including the floating dock.
  const [mcmReceiptsOpen, setMcmReceiptsOpen] = useState(false);
  // MCM scan + manual-add sheet. When set, the AddDraftSheet
  // overlay opens at App level. Initial value is the seed
  // record the sheet renders against — { mode: "blank" } for
  // manual entry, { mode: "scan", ...prefilledFields } for
  // post-scan draft. Null = sheet closed.
  const [mcmAddDraft, setMcmAddDraft]     = useState(null);
  // `forceClassicPantry` — one-tap escape hatch back to the classic
  // Kitchen render for the Pantry tab. Not wired to a UI yet; exists
  // so we can flip it via devtools / localStorage if the MCM path
  // breaks in the field without forcing a deploy. Default false so
  // users get the new UI on their next open.
  const [forceClassicPantry]              = useState(false);
  const isAdmin = profile?.role === "admin";
  // Create menu overlay. Opened by the floating ➕ in the tab bar;
  // renders on top of whatever tab is currently active. Hosts every
  // creation flow: cooking (custom / AI / template recipe) AND
  // pantry ingress (scan / manual add).
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  // Pantry-action intent dispatched by CreateMenu's ADD TO PANTRY
  // branch. Kitchen consumes this in an effect and flips its
  // already-mounted Scanner / AddItemModal into the open state that
  // matches. 'scan' | 'add' | null.
  const [pendingPantryAction, setPendingPantryAction] = useState(null);
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

  // ── Cook mode (lifted from CreateMenu / Plan) ────────────────────
  // CookMode is mounted ONCE at the App level so it survives tab
  // changes and overlay dismissals. useActiveCookSession tails the
  // cook_sessions table; when a session is open (status='active',
  // within the 2h resume window), CookBanner appears pinned at the
  // top of the app with the live step + timer countdown. Tapping the
  // banner re-opens CookMode at the step the user was on.
  //
  // Why ONE mount, not per-tab: before, CreateMenu and Plan each
  // rendered their own CookMode. Unmounting either (closing the
  // overlay, navigating tabs) destroyed the cook view and made "close
  // the app then come back" a broken experience. One mount + a banner
  // for resume + no auto-abandon-on-unmount inside CookMode = the
  // cook survives everything short of the 2h window elapsing or the
  // user explicitly finalizing from the DONE LOG IT button.
  const [cookModeRecipe, setCookModeRecipe]     = useState(null);
  const [cookModeView, setCookModeView]         = useState("overview");
  const [cookModeStepIdx, setCookModeStepIdx]   = useState(0);
  const [cookModeEndsAt, setCookModeEndsAt]     = useState(null);
  const activeCook = useActiveCookSession(user?.id);
  const { saveRecipe: saveUserRecipe } = useUserRecipes(user?.id);

  // Open CookMode on a recipe. Default flow: land on overview
  // (ingredient checklist + swap UI) and let the user tap "Start
  // cooking" to enter the step-by-step view. When there's an ACTIVE
  // cook_session for this recipe (push deep-link, tap on the pinned
  // banner, a fresh Cook Now on a recipe you walked away from 10 min
  // ago), jump straight to the live step instead — nobody wants to
  // re-approve ingredients mid-braise. Explicit opts override.
  const openCookMode = useCallback((recipe, opts = {}) => {
    if (!recipe) return;
    const activeSameRecipe = activeCook.session && activeCook.session.recipe_slug === recipe.slug;
    const liveStepIdx = activeSameRecipe && activeCook.activeStep && recipe.steps
      ? recipe.steps.findIndex(s => String(s.id) === String(activeCook.activeStep.step_id))
      : -1;
    setCookModeRecipe(recipe);
    setCookModeView(opts.view || (activeSameRecipe ? "cook" : "overview"));
    setCookModeStepIdx(
      Number.isFinite(opts.stepIndex)
        ? opts.stepIndex
        : liveStepIdx >= 0 ? liveStepIdx : 0,
    );
    // Carry the server-side deadline through so the in-app Timer
    // calibrates to "the push is 30s away" instead of starting a
    // fresh mm:ss. Null on fresh cooks.
    setCookModeEndsAt(activeSameRecipe ? activeCook.timerEndsAt : null);
  }, [activeCook.session, activeCook.activeStep, activeCook.timerEndsAt]);

  // Close CookMode without killing the session. The session row stays
  // active in cook_sessions; CookBanner surfaces it. Explicit abandon
  // only happens when the user finalizes (DONE LOG IT → endCook with
  // status='finished') or when the 2h window lapses.
  const closeCookMode = useCallback(() => {
    setCookModeRecipe(null);
    // activeCook will refresh via realtime; force one in case the
    // realtime channel was mid-reconnect.
    activeCook.refresh();
  }, [activeCook]);

  // Resume a cook from the CookBanner tap. Resolves the live step
  // index off activeStep.step_id so we land inside the cook view on
  // the correct step. Priming the step index also makes the first
  // step-advance cancel the right pending timer push.
  const resumeCookFromBanner = useCallback((recipe) => {
    if (!recipe) return;
    const idx = activeCook.activeStep && recipe.steps
      ? Math.max(0, recipe.steps.findIndex(s => String(s.id) === String(activeCook.activeStep.step_id)))
      : 0;
    openCookMode(recipe, { view: "cook", stepIndex: idx });
  }, [activeCook.activeStep, openCookMode]);

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
    // Prep reminders (migration 0134) stamp scheduled_meal / the
    // cook-timer pushes (migration 0137) stamp cook_session. Both
    // route to the Plan tab; Plan consumes deepLink and opens the
    // matching meal drawer (for scheduled_meal) or auto-opens
    // CookMode against the live session's recipe (for cook_session).
    if (targetKind === "scheduled_meal" || targetKind === "cook_session") {
      setDeepLink({ kind: targetKind, id: targetId });
      setTab("plan");
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
      {/* Level-up ceremony — watches profile.level for upward
          movement and plays a full-screen celebration. Self-dismissing
          and zIndex 9999 so it lands on top of any open sheet. */}
      <LevelUpCeremony level={profile?.level || 1} />

      {/* Realtime XP toast stack — top-right slide-ins for non-cook
          earn events (scans, photos, reviews, badges, …). Subscribes
          to xp_events filtered to this user; suppressed by
          CookCompleteSummary via context while a beat sequence plays. */}
      <XpToastStack userId={user?.id} />

      {/* Admin quick-link — only fixed chrome left in the top bar.
          Bell + settings moved into the profile screen header; access
          them via the enlarged avatar in Home's top-right. */}
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

      {/* Tab switcher. Wrapping in AnimatePresence/motion so the
          active tab cross-fades with a subtle upward slide when the
          user taps the bottom bar. mode="wait" holds the next tab
          until the previous unmounts — prevents the brief stacking
          flash that a simple transition would cause. Keeping the
          animation short (120ms) so nothing feels sluggish; taps
          still register instantly. */}
      <div style={{ paddingBottom:80 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === "home"     && (
              <Home
                profile={profile}
                userId={user.id}
                familyIds={familyIds}
                familyLoading={relationships.loading}
                nameFor={nameFor}
                avatarFor={avatarFor}
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
                onStartCook={openCookMode}
                deepLink={deepLink}
                onDeepLinkConsumed={() => setDeepLink(null)}
              />
            )}
            {tab === "pantry" && pantryView === "stock" && !forceClassicPantry && (
              // MCM Pantry — re-skinned stock view with real Supabase
              // data. Wraps in MCMThemeProvider so the time-of-day
              // palette (dawn/dusk/day/night anchors) resolves inside
              // the screen without leaking to the rest of the dark
              // UI. Tap on a card sets `mcmOpenItem`, which raises
              // the shared ItemCard overlay further down — same edit
              // flow the Kitchen stock view uses, just reached from a
              // different visual. Escape hatch: `forceClassicPantry`
              // flips the view back to the original Kitchen render
              // if something here breaks (keeps users unblocked).
              <MCMThemeProvider>
                <MCMKitchenScreen
                  items={pantry}
                  loading={pantryLoading}
                  onOpenItem={setMcmOpenItem}
                  // Shopping-list bridge: tapping the cart in the
                  // hero flips pantryView to "shopping", which the
                  // same tab render handles by falling through to
                  // the classic Kitchen (see below). shoppingCount
                  // feeds the badge on the cart button.
                  onGoToShopping={() => setPantryView("shopping")}
                  shoppingCount={Array.isArray(shoppingList) ? shoppingList.length : 0}
                  onOpenReceipts={() => setMcmReceiptsOpen(true)}
                  spendCents={spendCents}
                  // Scan + manual-add bridge. Seeds the AddDraftSheet
                  // with `{ mode: "blank" }` — empty fields. The sheet
                  // itself will offer a Scan button that re-seeds with
                  // OFF lookup results when used.
                  onOpenAdd={() => setMcmAddDraft({ mode: "blank" })}
                  // Cook-flow entry — wired to the Plan tab where the
                  // user can pick a recipe and launch CookMode. Used
                  // by MCMKitchenScreen's positive CTA when the
                  // pantry is healthy (no warn items) so a stocked
                  // user has a clear path forward instead of an
                  // empty surface.
                  onStartCooking={() => setTab("plan")}
                  onRemoveItem={(item) => {
                    // Swipe-to-remove from the MCM item card. Filters
                    // the row out of the local pantry; useSyncedList
                    // persists the delete to Supabase via the diff
                    // path. Family pantries propagate the delete via
                    // realtime to other members.
                    setPantry(prev => prev.filter(p => p.id !== item.id));
                  }}
                  onUpdateItem={(item, patch) => {
                    // Inline-edit hook for the shelf row's fill gauge
                    // (and any future inline editors). Patches the
                    // matching row in-place; useSyncedList's diff
                    // detects the field-level change and persists.
                    setPantry(prev => prev.map(p => p.id === item.id ? { ...p, ...patch } : p));
                  }}
                  hideDock
                />
              </MCMThemeProvider>
            )}
            {tab === "pantry" && (pantryView !== "stock" || forceClassicPantry) && (
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
                pendingPantryAction={pendingPantryAction}
                onPendingActionConsumed={() => setPendingPantryAction(null)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* MCM Pantry edit overlay — shared ItemCard rendered above
          the MCM grid when the user taps a card. Looks up the fresh
          pantry row by id so realtime edits from the family flow
          through without a close+reopen. Uses the same updatePantry-
          style wrapper Kitchen uses internally so corrections go
          through the standard pantry_items update path. Minimal
          callbacks for now: onUpdate applies a shallow merge via
          setPantry; onDelete removes the row outright. Tag-editing
          and provenance drill-through are left for follow-up PRs
          (they depend on Kitchen-level infra — LinkIngredient,
          ReceiptView, etc.). Passing undefined for those callbacks
          lets ItemCard hide the corresponding affordances. */}
      {mcmOpenItem && (() => {
        const fresh = pantry.find(p => p.id === mcmOpenItem.id);
        if (!fresh) {
          // Row was deleted (from this client or a family member).
          // Close the overlay on next tick so we don't rip the
          // modal out from under a mid-edit user; setTimeout = 0
          // defers to avoid a setState-during-render warning.
          setTimeout(() => setMcmOpenItem(null), 0);
          return null;
        }
        return (
          <ItemCard
            key={fresh.id}
            item={fresh}
            pantry={pantry}
            userId={user.id}
            isAdmin={isAdmin}
            familyIds={familyIds}
            onUpdate={(patch) => setPantry(prev => prev.map(p => (
              p.id === fresh.id ? { ...p, ...patch } : p
            )))}
            onDelete={() => {
              setPantry(prev => prev.filter(p => p.id !== fresh.id));
              setMcmOpenItem(null);
            }}
            onClose={() => setMcmOpenItem(null)}
          />
        );
      })()}

      {/* Receipt history from the MCM hero's receipt button.
          Same component Kitchen uses. Tapping a specific receipt
          forwards through classic Kitchen's deepLink system:
          close the history modal, flip pantryView out of "stock"
          (Kitchen renders in "shopping" view and consumes the
          deep link), and set the receipt deepLink so
          ReceiptView stacks above. User sees the receipt
          contents, closes it, lands back on classic Kitchen
          shopping — a reasonable re-entry point since they just
          paged through receipts. */}
      {mcmReceiptsOpen && (
        <ReceiptHistoryModal
          userId={user.id}
          onOpenReceipt={(id) => {
            setMcmReceiptsOpen(false);
            setPantryView("shopping");
            setDeepLink({ kind: "receipt", id });
          }}
          onClose={() => setMcmReceiptsOpen(false)}
        />
      )}

      {/* MCM scan + manual-add sheet. Renders inside its own
          MCMThemeProvider so the warm palette holds even though
          it's mounted at App level (above the dark UI). On
          submit, the sheet hands back a complete pantry-row
          shape and we append it via setPantry — useSyncedList's
          diff path persists the insert to Supabase
          automatically. */}
      {mcmAddDraft && (
        <MCMThemeProvider>
          <MCMAddDraftSheet
            seed={mcmAddDraft}
            userId={user.id}
            isAdmin={isAdmin}
            onClose={() => setMcmAddDraft(null)}
            onSubmit={(row) => {
              setPantry(prev => [...prev, {
                id: crypto.randomUUID(),
                purchasedAt: new Date(),
                ...row,
              }]);
              setMcmAddDraft(null);
            }}
          />
        </MCMThemeProvider>
      )}

      {settingsOpen && (
        <Settings
          userId={user.id}
          profile={profile}
          relationships={relationships}
          upsertProfile={upsertProfile}
          avatarCatalog={avatars.catalog}
          ownedAvatars={avatars.owned}
          onPinAvatar={async (slug) => {
            await avatars.pin(slug);
            const cat = avatars.catalog.find(c => c.slug === slug);
            patchProfile({ avatar_slug: slug, avatar_url: cat?.image_url || null });
          }}
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
          // Both handlers close the profile before opening their
          // overlay — Settings + UserProfile are both zIndex:200, so
          // stacking them makes the newer one disappear behind this
          // one. Same goes for NotificationsPanel (zIndex:100, would
          // land behind us). Close first, land clean.
          onOpenSettings={() => { setProfileUserId(null); setSettingsOpen(true); }}
          onOpenNotifs={() => { setProfileUserId(null); openNotifs(); }}
          notifsUnread={notifications.unreadCount + (whatsNew.showNotification ? 1 : 0)}
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
          KITCHEN) with a floating ➕ button slotted between tabs 2 and
          3. The ➕ isn't a tab — tapping it opens CreateMenu as a full-
          screen overlay, the universal creation hub for cooking and
          pantry ingress. */}
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
            onClick={() => setCreateMenuOpen(true)}
            title="Create"
            aria-label="Create"
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

      {/* CreateMenu overlay — the universal creation hub launched by
          the floating ➕ above. Hosts the four-branch chooser (custom /
          AI / template recipe / add to pantry). Cook branches land in
          CookMode; ADD TO PANTRY dispatches back to Kitchen via
          onRequestPantryAction. Returns via onClose. onCooked fires
          after CookMode's done-flow so we can land the user on their
          own profile archive where the freshly logged cook surfaces. */}
      {createMenuOpen && (
        <CreateMenu
          userId={user.id}
          profile={profile}
          familyKey={familyKey}
          pantry={pantry}
          setPantry={setPantry}
          shoppingList={shoppingList}
          setShoppingList={setShoppingList}
          onGoToShopping={() => { setPantryView("shopping"); setTab("pantry"); setCreateMenuOpen(false); }}
          family={relationships.family}
          friends={relationships.friends}
          onClose={() => setCreateMenuOpen(false)}
          onCooked={() => {
            setCreateMenuOpen(false);
            setProfileUserId(user.id);
          }}
          // CookMode lives at App level now; CreateMenu bubbles
          // recipe-to-cook selections up here. App opens the overlay
          // and keeps it alive across navigation so the resume banner
          // can pop it back from any tab.
          onStartCook={openCookMode}
          onRequestPantryAction={(kind) => {
            // Route the intent back to Kitchen: flip to the pantry
            // tab, stash the action so Kitchen's effect can open the
            // matching flow, then dismiss CreateMenu.
            setPendingPantryAction(kind);
            setTab("pantry");
            setCreateMenuOpen(false);
          }}
        />
      )}

      {/* Pinned "cooking in progress" banner. Reads live state from
          useActiveCookSession; renders only when there IS an active
          cook and the user hasn't dismissed. Tap re-opens CookMode
          at the live step; × hides until next session change. Mounted
          outside AnimatePresence because it should be visible across
          every tab, including during tab cross-fades. */}
      <CookBanner
        active={activeCook}
        onResume={resumeCookFromBanner}
        onDismiss={activeCook.dismiss}
      />

      {/* App-level CookMode overlay. One mount, shared by every
          entry point (CreateMenu's start-cooking, Plan's Cook Now,
          cook_session deeplinks, the pinned banner's resume tap).
          Full-screen over the page shell; z-index above the banner +
          nav, below modal sheets (160). onExit just closes the
          overlay — the cook_sessions row stays active for 2h so the
          banner can surface it. onDone (finalize) closes the overlay
          AND lands the user on their profile so the fresh cook_log
          shows up. */}
      {cookModeRecipe && (
        <div style={{
          position: "fixed", inset: 0, maxWidth: 480, margin: "0 auto",
          background: "#111", color: "#f5f5f0",
          zIndex: 140, overflowY: "auto",
        }}>
          <CookMode
            recipe={cookModeRecipe}
            initialView={cookModeView}
            initialStepIndex={cookModeStepIdx}
            initialTimerEndsAt={cookModeEndsAt}
            onExit={closeCookMode}
            onDone={() => {
              closeCookMode();
              setProfileUserId(user.id);
            }}
            pantry={pantry}
            setPantry={setPantry}
            shoppingList={shoppingList}
            setShoppingList={setShoppingList}
            onGoToShopping={() => { setPantryView("shopping"); setTab("pantry"); closeCookMode(); }}
            userId={user.id}
            family={relationships.family}
            friends={relationships.friends}
            onForkRecipe={saveUserRecipe}
          />
        </div>
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
