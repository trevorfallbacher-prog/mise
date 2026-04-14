import { useState, useEffect } from "react";
import Onboarding from "./components/Onboarding";
import Home from "./components/Home";
import CookMode from "./components/CookMode";
import Cookbook from "./components/Cookbook";
import Pantry from "./components/Pantry";
import SignIn from "./components/SignIn";
import { useAuth, signOut } from "./lib/useAuth";
import { useProfile } from "./lib/useProfile";

const NAV = [
  { id:"home",     emoji:"🏠", label:"Home"     },
  { id:"cook",     emoji:"🧑‍🍳", label:"Cook"     },
  { id:"cookbook", emoji:"📖", label:"Cookbook" },
  { id:"pantry",   emoji:"🥫", label:"Pantry"   },
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
  const [tab, setTab] = useState("home");

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

  // Auth check still in flight
  if (authLoading) return <LoadingSplash />;

  // Not signed in
  if (!user) {
    return (
      <div style={{ ...pageShell, backgroundImage:"radial-gradient(ellipse at 30% 0%,#1e1408 0%,transparent 60%)" }}>
        <SignIn />
      </div>
    );
  }

  // Signed in but we haven't heard back from the profiles table yet
  if (profileLoading) return <LoadingSplash />;

  // Signed in but onboarding isn't done yet (no dietary preference saved).
  // The profile row may already exist with just a name from the effect above.
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

  // Fully signed in + onboarded
  return (
    <div style={{ ...pageShell, backgroundImage:"radial-gradient(ellipse at 70% 100%,#1a1209 0%,transparent 60%)" }}>
      {/* Temporary sign-out affordance — replace with a real settings screen later */}
      <button
        onClick={signOut}
        title="Sign out"
        style={{
          position: "fixed", top: 12, right: 12, zIndex: 50,
          background: "#161616", border: "1px solid #2a2a2a",
          borderRadius: 20, padding: "4px 10px",
          fontFamily: "'DM Mono',monospace", fontSize: 9,
          color: "#666", letterSpacing: "0.1em", cursor: "pointer",
        }}
      >
        SIGN OUT
      </button>

      <div style={{ paddingBottom:80 }}>
        {tab === "home"     && <Home profile={profile} />}
        {tab === "cook"     && <CookMode onDone={() => setTab("cookbook")} />}
        {tab === "cookbook" && <Cookbook />}
        {tab === "pantry"   && <Pantry />}
      </div>

      {/* Bottom nav */}
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
