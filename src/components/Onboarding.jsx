import { useState, useEffect } from "react";
import { DIETARY_OPTIONS, VEGAN_STYLE_OPTIONS, LEVEL_OPTIONS, GOAL_OPTIONS } from "../data";

function ProgressDots({ total, current }) {
  return (
    <div style={{ display:"flex", gap:6, justifyContent:"center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === current ? 20 : 6, height:6, borderRadius:3,
          background: i < current ? "#a8d5a2" : i === current ? "#f5c842" : "#2a2a2a",
          transition:"all 0.35s ease"
        }} />
      ))}
    </div>
  );
}

function OptionCard({ option, selected, onSelect, wide }) {
  return (
    <button onClick={() => onSelect(option.id)} style={{
      width:"100%", textAlign:"left",
      border:`1.5px solid ${selected ? "#f5c842" : "#2a2a2a"}`,
      borderRadius:14, padding: wide ? "14px 16px" : "16px",
      background: selected ? "#1e1a0e" : "#161616",
      cursor:"pointer", display:"flex", alignItems:"center", gap:14,
      boxShadow: selected ? "0 0 0 1px #f5c84244, 0 4px 24px #f5c84211" : "none",
      transition:"all 0.2s", transform: selected ? "scale(1.01)" : "scale(1)"
    }}>
      <span style={{ fontSize: wide ? 24 : 28, flexShrink:0 }}>{option.emoji}</span>
      <div>
        <div style={{ fontFamily:"'Fraunces', serif", fontSize: wide ? 15 : 16,
          color: selected ? "#f5c842" : "#f0ece4", fontWeight:400, lineHeight:1.2 }}>
          {option.label}
        </div>
        <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12, color:"#666", marginTop:2 }}>
          {option.desc}
        </div>
      </div>
      {selected && (
        <div style={{ marginLeft:"auto", width:20, height:20, borderRadius:"50%",
          background:"#f5c842", display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:11, color:"#111", fontWeight:900, flexShrink:0 }}>✓</div>
      )}
    </button>
  );
}

function SplashScreen({ onNext }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 100); }, []);
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", minHeight:"100vh", padding:32, textAlign:"center" }}>
      <div style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(20px)", transition:"all 0.7s ease" }}>
        <div style={{ fontSize:72, marginBottom:16 }}>👨‍🍳</div>
        <h1 style={{ fontFamily:"'Fraunces', serif", fontSize:52, fontWeight:300, fontStyle:"italic",
          color:"#f5c842", letterSpacing:"-0.03em", lineHeight:1, marginBottom:12 }}>mise</h1>
        <p style={{ fontFamily:"'DM Sans', sans-serif", fontSize:16, color:"#888",
          lineHeight:1.6, maxWidth:260, margin:"0 auto 40px" }}>
          Learn to cook like a pro. One skill at a time.
        </p>
        <button onClick={onNext} style={{
          background:"#f5c842", color:"#111", border:"none", borderRadius:50,
          padding:"16px 40px", fontFamily:"'DM Mono', monospace", fontSize:13,
          fontWeight:600, letterSpacing:"0.08em", cursor:"pointer",
          boxShadow:"0 0 40px #f5c84244"
        }}>LET'S GET STARTED</button>
      </div>
    </div>
  );
}

function QuestionScreen({ stepLabel, title, subtitle, options, value, onSelect, onNext, onBack, step, total, nextLabel, wide }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", minHeight:"100vh", padding:"24px 20px 40px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:32 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#555", fontSize:20, cursor:"pointer" }}>←</button>
        <ProgressDots total={total} current={step} />
        <div style={{ width:28 }} />
      </div>
      <div style={{ marginBottom:28 }}>
        <div style={{ fontFamily:"'DM Mono', monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.15em", marginBottom:10 }}>
          {stepLabel || `STEP ${step + 1} OF ${total}`}
        </div>
        <h2 style={{ fontFamily:"'Fraunces', serif", fontSize:34, fontWeight:300, fontStyle:"italic",
          color:"#f0ece4", letterSpacing:"-0.02em", lineHeight:1.1 }}>{title}</h2>
        {subtitle && <p style={{ fontFamily:"'DM Sans', sans-serif", fontSize:14, color:"#666", marginTop:8 }}>{subtitle}</p>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap: wide ? 10 : 14, flex:1 }}>
        {options.map(opt => (
          <OptionCard key={opt.id} option={opt} selected={value === opt.id} onSelect={onSelect} wide={wide} />
        ))}
      </div>
      <button onClick={onNext} disabled={!value} style={{
        marginTop:24, width:"100%", padding:"16px",
        background: value ? "#f5c842" : "#1a1a1a",
        color: value ? "#111" : "#444", border:"none", borderRadius:14,
        fontFamily:"'DM Mono', monospace", fontSize:13, fontWeight:600,
        letterSpacing:"0.08em", cursor: value ? "pointer" : "not-allowed", transition:"all 0.3s"
      }}>{nextLabel || "CONTINUE →"}</button>
    </div>
  );
}

function VeganStyleScreen({ value, onSelect, onNext, onBack, step, total }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", minHeight:"100vh", padding:"24px 20px 40px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:32 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#555", fontSize:20, cursor:"pointer" }}>←</button>
        <ProgressDots total={total} current={step} />
        <div style={{ width:28 }} />
      </div>
      <div style={{ marginBottom:32 }}>
        <div style={{ fontFamily:"'DM Mono', monospace", fontSize:10, color:"#a8d5a2", letterSpacing:"0.15em", marginBottom:10 }}>
          STEP {step + 1} OF {total}
        </div>
        <h2 style={{ fontFamily:"'Fraunces', serif", fontSize:34, fontWeight:300, fontStyle:"italic",
          color:"#f0ece4", letterSpacing:"-0.02em", lineHeight:1.1 }}>What's your vegan style?</h2>
        <p style={{ fontFamily:"'DM Sans', sans-serif", fontSize:14, color:"#666", marginTop:8 }}>
          This helps us show you the right version of every dish.
        </p>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:14, flex:1 }}>
        {VEGAN_STYLE_OPTIONS.map(opt => (
          <OptionCard key={opt.id} option={opt} selected={value === opt.id} onSelect={onSelect} />
        ))}
      </div>
      <div style={{ margin:"24px 0", padding:"14px 16px", background:"#0f1a0f",
        border:"1px solid #1e3a1e", borderRadius:12 }}>
        <div style={{ fontFamily:"'DM Mono', monospace", fontSize:10, color:"#7ec87e", letterSpacing:"0.1em", marginBottom:6 }}>FOR EXAMPLE</div>
        <p style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13, color:"#7ec87e", lineHeight:1.5 }}>
          {value === "alternatives" && "Thanksgiving? We'll show you tofurkey, seitan roast, and stuffed squash."}
          {value === "whole"        && "Thanksgiving? Lentil loaf, mushroom wellington, roasted root vegetables."}
          {value === "flexible"     && "We'll show you both and let you choose based on the dish."}
          {!value                   && "Select an option to see how we'll personalize your recipes."}
        </p>
      </div>
      <button onClick={onNext} disabled={!value} style={{
        width:"100%", padding:"16px",
        background: value ? "#f5c842" : "#1a1a1a",
        color: value ? "#111" : "#444", border:"none", borderRadius:14,
        fontFamily:"'DM Mono', monospace", fontSize:13, fontWeight:600,
        letterSpacing:"0.08em", cursor: value ? "pointer" : "not-allowed", transition:"all 0.3s"
      }}>CONTINUE →</button>
    </div>
  );
}

function BuildingScreen({ onDone, profile }) {
  const [progress, setProgress] = useState(0);
  const messages = ["Analyzing your profile...","Building your skill tree...","Adding seasonal events...","Personalizing recipes...","Almost ready..."];
  const [msg, setMsg] = useState(messages[0]);
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i++;
      setProgress(Math.min(i * 22, 100));
      setMsg(messages[Math.min(i, messages.length - 1)]);
      if (i >= 5) { clearInterval(id); setTimeout(onDone, 600); }
    }, 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:40, textAlign:"center" }}>
      <div style={{ fontSize:56, marginBottom:24, animation:"spin 2s linear infinite" }}>
        {profile.dietary === "vegan" ? "🌱" : profile.dietary === "keto" ? "🥩" : "👨‍🍳"}
      </div>
      <h2 style={{ fontFamily:"'Fraunces', serif", fontSize:28, fontWeight:300, fontStyle:"italic", color:"#f0ece4", marginBottom:8 }}>
        Building your kitchen
      </h2>
      <p style={{ fontFamily:"'DM Sans', sans-serif", fontSize:14, color:"#666", marginBottom:40 }}>{msg}</p>
      <div style={{ width:"100%", maxWidth:280, height:4, background:"#222", borderRadius:2, overflow:"hidden" }}>
        <div style={{ height:"100%", background:"#f5c842", borderRadius:2, width:`${progress}%`,
          transition:"width 0.4s ease", boxShadow:"0 0 12px #f5c84266" }} />
      </div>
      <style>{`@keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
    </div>
  );
}

export default function Onboarding({ onComplete }) {
  const [screen, setScreen] = useState("splash");
  const [profile, setProfile] = useState({ dietary:"", veganStyle:"", level:"", goal:"" });
  const set = (key, val) => setProfile(p => ({ ...p, [key]: val }));
  const isVegan = profile.dietary === "vegan";
  const TOTAL = isVegan ? 4 : 3;

  const stepOf = { dietary:0, veganstyle:1, level: isVegan ? 2 : 1, goal: isVegan ? 3 : 2 };

  return (
    <div>
      {screen === "splash"     && <SplashScreen onNext={() => setScreen("dietary")} />}
      {screen === "dietary"    && (
        <QuestionScreen title="How do you eat?" subtitle="Pick the one that fits best. You can always change it later."
          options={DIETARY_OPTIONS} value={profile.dietary} onSelect={v => set("dietary",v)} wide
          step={0} total={TOTAL} onNext={() => setScreen(isVegan ? "veganstyle" : "level")}
          onBack={() => setScreen("splash")} />
      )}
      {screen === "veganstyle" && (
        <VeganStyleScreen value={profile.veganStyle} onSelect={v => set("veganStyle",v)}
          step={1} total={TOTAL} onNext={() => setScreen("level")} onBack={() => setScreen("dietary")} />
      )}
      {screen === "level"      && (
        <QuestionScreen title="How comfortable are you in the kitchen?" subtitle="Be honest — we won't judge."
          options={LEVEL_OPTIONS} value={profile.level} onSelect={v => set("level",v)}
          step={stepOf.level} total={TOTAL}
          onNext={() => setScreen("goal")} onBack={() => setScreen(isVegan ? "veganstyle" : "dietary")} />
      )}
      {screen === "goal"       && (
        <QuestionScreen title="What do you want to get out of this?" subtitle="This shapes your entire skill tree."
          options={GOAL_OPTIONS} value={profile.goal} onSelect={v => set("goal",v)}
          step={stepOf.goal} total={TOTAL} nextLabel="BUILD MY SKILL TREE →"
          onNext={() => setScreen("building")} onBack={() => setScreen("level")} />
      )}
      {screen === "building"   && <BuildingScreen profile={profile} onDone={() => onComplete(profile)} />}
    </div>
  );
}
