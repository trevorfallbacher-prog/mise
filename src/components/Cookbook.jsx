import { useState } from "react";
import { SAVED_RECIPES, OCCASIONS, MOODS, UPCOMING_MOMENTS } from "../data";

function OccasionPill({ id }) {
  const o = OCCASIONS.find(o => o.id === id);
  if (!o) return null;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:20, padding:"3px 10px", fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#888" }}>
      {o.emoji} {o.label}
    </span>
  );
}

function RecipeDetail({ recipe, onBack }) {
  const [tab, setTab] = useState("memory");
  return (
    <div style={{ minHeight:"100vh", paddingBottom:40 }}>
      <div style={{ padding:"20px 20px 0", display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#555", fontSize:20, cursor:"pointer" }}>←</button>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em" }}>YOUR COOKBOOK</div>
      </div>
      <div style={{ padding:"24px 20px 0", textAlign:"center" }}>
        <div style={{ fontSize:56, marginBottom:12 }}>{recipe.emoji}</div>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:300, fontStyle:"italic", color:"#f0ece4", letterSpacing:"-0.02em", marginBottom:6 }}>{recipe.title}</h1>
        <div style={{ display:"flex", justifyContent:"center", gap:16 }}>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#555" }}>cooked {recipe.cookedCount}×</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f5c842" }}>+{recipe.xpEarned} XP total</span>
        </div>
      </div>
      <div style={{ display:"flex", margin:"24px 20px 0", background:"#161616", borderRadius:12, padding:4, gap:4 }}>
        {[["memory","Memory"],["notes","Notes"],["suggest","What's Next"]].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:"8px", background: tab===id?"#f5c842":"none", border:"none", borderRadius:9, fontFamily:"'DM Mono',monospace", fontSize:10, color: tab===id?"#111":"#555", cursor:"pointer", letterSpacing:"0.06em", fontWeight: tab===id?600:400, transition:"all 0.2s" }}>
            {label.toUpperCase()}
          </button>
        ))}
      </div>
      <div style={{ padding:"20px 20px 0" }}>
        {tab === "memory" && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {recipe.moment && (
              <div style={{ padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.12em", marginBottom:8 }}>YOUR MEMORY</div>
                <p style={{ fontFamily:"'Fraunces',serif", fontSize:16, color:"#ccc", fontStyle:"italic", lineHeight:1.6 }}>"{recipe.moment}"</p>
              </div>
            )}
            <div style={{ padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.12em", marginBottom:10 }}>COOKED FOR</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {recipe.occasions.map(o => <OccasionPill key={o} id={o} />)}
              </div>
            </div>
            <div style={{ padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.12em", marginBottom:10 }}>TAGS</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {recipe.tags.map(t => <span key={t} style={{ background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:20, padding:"3px 10px", fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#888" }}>{t}</span>)}
              </div>
            </div>
          </div>
        )}
        {tab === "notes" && (
          <div style={{ padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.12em", marginBottom:10 }}>YOUR NOTES</div>
            <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:15, color:"#ccc", lineHeight:1.7 }}>{recipe.notes || "No notes yet."}</p>
          </div>
        )}
        {tab === "suggest" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ padding:"18px", background:"#161616", border:"1px solid #f5c84233", borderRadius:14 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.12em", marginBottom:8 }}>LEVEL UP FROM HERE</div>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:20, color:"#f0ece4", fontWeight:400, marginBottom:4 }}>{recipe.nextSuggestion.title}</div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", marginBottom:14 }}>{recipe.nextSuggestion.reason}</div>
              <button style={{ width:"100%", padding:"12px", background:"#f5c842", border:"none", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, letterSpacing:"0.08em", cursor:"pointer", color:"#111" }}>EXPLORE THIS DISH →</button>
            </div>
            {UPCOMING_MOMENTS.map(m => (
              <div key={m.id} style={{ padding:"14px 16px", background:"#161616", border:"1px solid #222", borderRadius:12, display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:24 }}>{m.emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#ccc" }}>{m.name} is in {m.daysAway} days</div>
                  <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#555", marginTop:2 }}>{recipe.title} would be perfect for this</div>
                </div>
                <button style={{ background:"#1a1a1a", border:"1px solid #333", borderRadius:8, padding:"6px 10px", fontFamily:"'DM Mono',monospace", fontSize:9, color:"#888", cursor:"pointer", flexShrink:0 }}>PLAN IT</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Cookbook() {
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");

  const filters = [
    { id:"all", label:"All" }, { id:"nailed", label:"🤩 Nailed" },
    { id:"kids", label:"🧒 Kids" }, { id:"partner", label:"🕯️ Date" },
    { id:"friends", label:"🥂 Friends" }, { id:"holiday", label:"🎉 Holiday" },
  ];

  const filtered = SAVED_RECIPES.filter(r => {
    if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "nailed") return r.rating === "nailed";
    return r.occasions.includes(filter) || r.savedFor?.includes(filter);
  });

  if (detail) return <RecipeDetail recipe={detail} onBack={() => setDetail(null)} />;

  return (
    <div style={{ minHeight:"100vh", paddingBottom:100 }}>
      <div style={{ padding:"24px 20px 0" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em", marginBottom:6 }}>YOUR</div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
          <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:38, fontWeight:300, fontStyle:"italic", color:"#f0ece4", letterSpacing:"-0.03em" }}>Cookbook</h1>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:18, color:"#f5c842" }}>{SAVED_RECIPES.length}</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555" }}>SAVED</div>
          </div>
        </div>
      </div>

      {/* Calendar moments */}
      <div style={{ margin:"20px 20px 0", padding:"14px 16px", background:"#0f0f1a", border:"1px solid #2a2a3a", borderRadius:14 }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7b7bf0", letterSpacing:"0.12em", marginBottom:10 }}>FROM YOUR CALENDAR</div>
        <div style={{ display:"flex", gap:8 }}>
          {UPCOMING_MOMENTS.map(m => (
            <div key={m.id} style={{ flex:1, background:"#161628", border:"1px solid #2a2a4a", borderRadius:10, padding:"10px 8px", textAlign:"center" }}>
              <div style={{ fontSize:18, marginBottom:4 }}>{m.emoji}</div>
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#888", lineHeight:1.3 }}>{m.name}</div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#7b7bf0", marginTop:3 }}>in {m.daysAway}d</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ margin:"16px 20px 0", position:"relative" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search your cookbook..."
          style={{ width:"100%", background:"#161616", border:"1px solid #2a2a2a", borderRadius:12, padding:"12px 16px 12px 40px", color:"#f0ece4", fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none" }} />
        <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, opacity:0.4 }}>🔍</span>
      </div>

      <div style={{ display:"flex", gap:8, padding:"14px 20px 0", overflowX:"auto", scrollbarWidth:"none" }}>
        {filters.map(f => (
          <button key={f.id} onClick={()=>setFilter(f.id)} style={{ background: filter===f.id?"#f5c842":"#161616", border:`1px solid ${filter===f.id?"#f5c842":"#2a2a2a"}`, borderRadius:20, padding:"7px 14px", whiteSpace:"nowrap", fontFamily:"'DM Sans',sans-serif", fontSize:12, color: filter===f.id?"#111":"#888", cursor:"pointer", transition:"all 0.2s", flexShrink:0 }}>{f.label}</button>
        ))}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:12, padding:"16px 20px 0" }}>
        {filtered.map(r => (
          <button key={r.id} onClick={()=>setDetail(r)} style={{ width:"100%", textAlign:"left", background:"#141414", border:"1px solid #222", borderRadius:16, padding:"16px", cursor:"pointer" }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
              <div style={{ fontSize:36, flexShrink:0 }}>{r.emoji}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                  <span style={{ fontFamily:"'Fraunces',serif", fontSize:17, color:"#f0ece4", fontWeight:400 }}>{r.title}</span>
                  <span style={{ fontSize:16 }}>{MOODS.find(m=>m.id===r.rating)?.emoji}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:r.skillColor, flexShrink:0 }} />
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666" }}>{r.skill}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#444" }}>·</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>cooked {r.cookedCount}×</span>
                </div>
                {r.moment && <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#888", fontStyle:"italic", lineHeight:1.5, marginBottom:8 }}>"{r.moment}"</p>}
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {r.occasions.map(o => <OccasionPill key={o} id={o} />)}
                </div>
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#444", flexShrink:0, marginTop:2 }}>{r.lastCooked}</div>
            </div>
            <div style={{ marginTop:12, padding:"10px 12px", background:"#0f0f0f", borderRadius:10, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:12 }}>✨</span>
              <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666", flex:1 }}>Try next: <span style={{ color:"#aaa" }}>{r.nextSuggestion.title}</span></span>
              <span style={{ fontSize:12, color:"#444" }}>→</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
