import { useState } from "react";
import Onboarding from "./components/Onboarding";
import Home from "./components/Home";
import CookMode from "./components/CookMode";
import Cookbook from "./components/Cookbook";
import Pantry from "./components/Pantry";

const NAV = [
  { id:"home",     emoji:"🏠", label:"Home"     },
  { id:"cook",     emoji:"🧑‍🍳", label:"Cook"     },
  { id:"cookbook", emoji:"📖", label:"Cookbook" },
  { id:"pantry",   emoji:"🥫", label:"Pantry"   },
];

export default function App() {
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("home");

  if (!profile) return (
    <div style={{ minHeight:"100vh", background:"#111", color:"#f5f5f0", maxWidth:480, margin:"0 auto", backgroundImage:"radial-gradient(ellipse at 30% 0%,#1e1408 0%,transparent 60%)" }}>
      <Onboarding onComplete={setProfile} />
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#111", color:"#f5f5f0", maxWidth:480, margin:"0 auto", backgroundImage:"radial-gradient(ellipse at 70% 100%,#1a1209 0%,transparent 60%)" }}>
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
