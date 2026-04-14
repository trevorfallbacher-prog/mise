import { SKILL_TREE, UPCOMING_EVENTS, LEVEL_OPTIONS, GOAL_OPTIONS, DIETARY_OPTIONS } from "../data";

// Time-of-day greeting. 5am-noon morning, noon-5pm afternoon, else evening.
function greetingForHour(hour) {
  if (hour < 5)  return "GOOD NIGHT";
  if (hour < 12) return "GOOD MORNING";
  if (hour < 17) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

// Take the static SKILL_TREE defs and overlay the user's actual levels from
// profile.skill_levels. Skills the user hasn't touched yet default to level 0.
// All skills are always visible and levelable — unlock gating lives on recipes.
function computeSkillTree(userLevels) {
  const levels = userLevels || {};
  return SKILL_TREE.map(s => ({ ...s, level: levels[s.id] ?? 0 }));
}

export default function Home({ profile }) {
  const dietLabel = DIETARY_OPTIONS.find(d => d.id === profile.dietary)?.label || "Everything";
  const firstName = profile.name?.trim().split(/\s+/)[0] || null;
  const greeting  = greetingForHour(new Date().getHours());
  const streak    = profile.streak_count || 0;
  const skills    = computeSkillTree(profile.skill_levels);

  return (
    <div style={{ minHeight:"100vh", paddingBottom:80 }}>
      {/* Header */}
      <div style={{ padding:"24px 20px 0" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontFamily:"'DM Mono', monospace", fontSize:10, color:"#555", letterSpacing:"0.12em" }}>
              {greeting}{firstName ? `, ${firstName.toUpperCase()}` : ""}
            </div>
            <h1 style={{ fontFamily:"'Fraunces', serif", fontSize:30, fontWeight:300, fontStyle:"italic", color:"#f5c842", letterSpacing:"-0.02em", marginTop:2 }}>mise</h1>
          </div>
          {streak > 0 && (
            <div style={{ background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:20, padding:"6px 12px", display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:14 }}>🔥</span>
              <span style={{ fontFamily:"'DM Mono', monospace", fontSize:12, color:"#f5c842" }}>
                {streak} day{streak === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Seasonal banner */}
      <div style={{ margin:"20px 20px 0", padding:"18px 20px", background:"linear-gradient(135deg,#1a2f1a 0%,#0f1a0f 100%)", border:"1px solid #2a4a2a", borderRadius:18, position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", right:-10, top:-10, fontSize:64, opacity:0.15 }}>🌸</div>
        <div style={{ fontFamily:"'DM Mono', monospace", fontSize:9, color:"#7ec87e", letterSpacing:"0.15em", marginBottom:6 }}>🌸 SPRING IS HERE</div>
        <div style={{ fontFamily:"'Fraunces', serif", fontSize:20, color:"#f0ece4", fontWeight:300, fontStyle:"italic", marginBottom:12 }}>Easter is in 6 days</div>
        <div style={{ display:"flex", gap:8 }}>
          {UPCOMING_EVENTS.map(ev => (
            <div key={ev.name} style={{ flex:1, background:"#ffffff0a", border:"1px solid #ffffff0f", borderRadius:10, padding:"10px 8px", textAlign:"center" }}>
              <div style={{ fontSize:18, marginBottom:4 }}>{ev.emoji}</div>
              <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:11, color:"#aaa", lineHeight:1.3 }}>{ev.name}</div>
              <div style={{ fontFamily:"'DM Mono', monospace", fontSize:9, color:"#f5c842", marginTop:3 }}>in {ev.daysAway}d</div>
            </div>
          ))}
        </div>
      </div>

      {/* Easter course unlock */}
      <div style={{ margin:"12px 20px 0", padding:"16px 18px", background:"#1a1209", border:"1px solid #f5c84233", borderRadius:14, display:"flex", alignItems:"center", gap:14 }}>
        <div style={{ fontSize:32 }}>🐣</div>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"'DM Mono', monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.12em", marginBottom:4 }}>COURSE UNLOCKING SOON</div>
          <div style={{ fontFamily:"'Fraunces', serif", fontSize:16, color:"#f0ece4", fontWeight:400 }}>Easter Brunch</div>
          <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12, color:"#666", marginTop:2 }}>
            {profile.dietary === "vegan"
              ? "Tofu scramble, spring salads, lemon tart"
              : profile.dietary === "keto"
              ? "Deviled eggs, glazed ham, asparagus"
              : "Hot cross buns, lamb roast, simnel cake"}
          </div>
        </div>
        <div style={{ fontFamily:"'DM Mono', monospace", fontSize:11, color:"#f5c842", background:"#f5c84222", padding:"4px 10px", borderRadius:20 }}>6d</div>
      </div>

      {/* Skill tree */}
      <div style={{ margin:"28px 20px 0" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontFamily:"'DM Mono', monospace", fontSize:10, color:"#555", letterSpacing:"0.12em" }}>YOUR SKILL TREE</div>
          <button style={{ background:"none", border:"none", fontFamily:"'DM Mono', monospace", fontSize:10, color:"#f5c842", cursor:"pointer" }}>SEE ALL →</button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {skills.map(skill => (
            <div key={skill.id} style={{ background:"#161616", border:"1px solid #2a2a2a", borderRadius:14, padding:"14px 16px", display:"flex", alignItems:"center", gap:14 }}>
              <div style={{ fontSize:28, flexShrink:0 }}>{skill.emoji}</div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <div style={{ fontFamily:"'Fraunces', serif", fontSize:15, color:"#f0ece4", fontWeight:400 }}>{skill.name}</div>
                  <div style={{ fontFamily:"'DM Mono', monospace", fontSize:10, color: skill.color }}>LVL {skill.level}/{skill.maxLevel}</div>
                </div>
                <div style={{ height:3, background:"#222", borderRadius:2, overflow:"hidden" }}>
                  <div style={{ height:"100%", borderRadius:2, background: skill.color, width:`${(skill.level/skill.maxLevel)*100}%`, boxShadow: skill.level > 0 ? `0 0 8px ${skill.color}88` : "none" }} />
                </div>
                <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:11, color:"#555", marginTop:4 }}>
                  Unlocks: {skill.unlocks.join(", ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Continue where you left off — only when the user has actually cooked
          something. Still cosmetic until the cooking log is wired up. */}
      {profile.last_cooked_date && (
        <div style={{ margin:"28px 20px 0" }}>
          <div style={{ fontFamily:"'DM Mono', monospace", fontSize:10, color:"#555", letterSpacing:"0.12em", marginBottom:16 }}>CONTINUE WHERE YOU LEFT OFF</div>
          <div style={{ background:"#161616", border:"1px solid #2a2a2a", borderRadius:16, padding:"18px", display:"flex", gap:14, alignItems:"center" }}>
            <div style={{ fontSize:36 }}>🔥</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'DM Mono', monospace", fontSize:9, color:"#e07a3a", letterSpacing:"0.12em", marginBottom:4 }}>HEAT CONTROL · LEVEL 1</div>
              <div style={{ fontFamily:"'Fraunces', serif", fontSize:18, color:"#f0ece4", fontWeight:300, fontStyle:"italic" }}>
                {profile.dietary === "vegan" ? "Caramelized Onion Galette" : profile.dietary === "keto" ? "Pan-Seared Ribeye" : "Brown Butter Pasta"}
              </div>
              <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12, color:"#666", marginTop:3 }}>Lesson 3 of 5 · ~18 min</div>
            </div>
            <button style={{ background:"#e07a3a", border:"none", borderRadius:10, width:40, height:40, fontSize:16, cursor:"pointer", flexShrink:0 }}>▶</button>
          </div>
        </div>
      )}

      {/* Profile pill */}
      <div style={{ margin:"20px 20px 0", padding:"12px 16px", background:"#111", border:"1px solid #1e1e1e", borderRadius:12, display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:16 }}>{DIETARY_OPTIONS.find(d => d.id === profile.dietary)?.emoji}</span>
        <span style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13, color:"#555" }}>
          {dietLabel} · {LEVEL_OPTIONS.find(l => l.id === profile.level)?.label} · {GOAL_OPTIONS.find(g => g.id === profile.goal)?.label}
        </span>
        <button style={{ marginLeft:"auto", background:"none", border:"none", fontFamily:"'DM Mono', monospace", fontSize:9, color:"#444", cursor:"pointer", letterSpacing:"0.1em" }}>EDIT</button>
      </div>
    </div>
  );
}
