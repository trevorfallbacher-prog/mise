import { useState, useEffect } from "react";
import { difficultyLabel, totalTimeMin } from "../data/recipes";
import { findIngredient, unitLabel, compareQty } from "../data/ingredients";
import IngredientCard from "./IngredientCard";
import CookComplete from "./CookComplete";

// ── Animations ────────────────────────────────────────────────────────────────
function BoilAnimation() {
  return (
    <div style={{ position:"relative", width:120, height:120, margin:"0 auto" }}>
      <svg viewBox="0 0 120 120" style={{ width:"100%", height:"100%" }}>
        <rect x="25" y="60" width="70" height="45" rx="6" fill="#2a2a2a" />
        <rect x="20" y="58" width="80" height="10" rx="4" fill="#3a3a3a" />
        <rect x="10" y="60" width="12" height="6" rx="3" fill="#444" />
        <rect x="98" y="60" width="12" height="6" rx="3" fill="#444" />
        <rect x="27" y="68" width="66" height="35" rx="4" fill="#1a6fa0" opacity="0.8" />
        {[40,55,70,85].map((x,i) => (
          <circle key={i} cx={x} cy={85} r={3} fill="#7dd3fc" opacity="0.7">
            <animateMotion dur={`${1.2+i*0.2}s`} repeatCount="indefinite" path={`M0,0 Q${i%2===0?5:-5},${-15} 0,-30`} />
          </circle>
        ))}
        {[45,60,75].map((x,i) => (
          <path key={i} d={`M${x},58 Q${x+5},50 ${x},42 Q${x-5},34 ${x},26`} stroke="#e0e0e0" strokeWidth="2" fill="none" opacity="0.4"
            style={{ animation:`steam 2s ${i*0.4}s infinite` }} />
        ))}
      </svg>
      <style>{`@keyframes steam{0%,100%{opacity:0;transform:translateY(0)}50%{opacity:0.5;transform:translateY(-8px)}}`}</style>
    </div>
  );
}

function StirAnimation() {
  const [angle, setAngle] = useState(0);
  useEffect(() => { const id = setInterval(() => setAngle(a => (a+8)%360),40); return () => clearInterval(id); },[]);
  const r=28, cx=60, cy=70, rad=(angle*Math.PI)/180;
  const tipX=cx+r*Math.sin(rad), tipY=cy-r*Math.cos(rad)*0.4;
  return (
    <div style={{ width:120, height:120, margin:"0 auto" }}>
      <svg viewBox="0 0 120 120">
        <ellipse cx="60" cy="75" rx="40" ry="28" fill="#2a2a2a" />
        <ellipse cx="60" cy="68" rx="38" ry="22" fill="#c9a96e" opacity="0.9" />
        {[0,1,2,3].map(i=>(
          <ellipse key={i} cx={55+i*4} cy={68} rx={8} ry={3} fill="#f5deb3" opacity="0.6"
            style={{ transform:`rotate(${angle+i*45}deg)`, transformOrigin:"60px 68px" }} />
        ))}
        <line x1={cx} y1={cy} x2={tipX} y2={tipY} stroke="#888" strokeWidth="3" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={cx+(cx-tipX)*0.3} y2={cy-25} stroke="#aaa" strokeWidth="4" strokeLinecap="round" />
        <ellipse cx={tipX} cy={tipY} rx={5} ry={3.5} style={{ transform:`rotate(${angle}deg)`, transformOrigin:`${tipX}px ${tipY}px` }} fill="#999" />
      </svg>
    </div>
  );
}

function BrownAnimation() {
  const [phase, setPhase] = useState(0);
  useEffect(() => { const id = setInterval(() => setPhase(p=>(p+1)%100),80); return () => clearInterval(id); },[]);
  const color=`hsl(${40-phase*0.15},${70+phase*0.3}%,${70-phase*0.35}%)`;
  return (
    <div style={{ width:120, height:120, margin:"0 auto" }}>
      <svg viewBox="0 0 120 120">
        <ellipse cx="60" cy="72" rx="48" ry="32" fill="#1a1a1a" />
        <ellipse cx="60" cy="65" rx="42" ry="26" fill={color} />
        {phase>20 && [35,50,70,82].map((x,i)=>(
          <circle key={i} cx={x} cy={65+(i%2)*4} r={2.5} fill="white" opacity={0.3+(phase/200)}>
            <animate attributeName="r" values="2;4;2" dur="1.5s" repeatCount="indefinite" />
          </circle>
        ))}
      </svg>
    </div>
  );
}

function BloomAnimation() {
  return (
    <div style={{ width:120, height:120, margin:"0 auto" }}>
      <svg viewBox="0 0 120 120">
        <ellipse cx="60" cy="72" rx="44" ry="28" fill="#2a1800" />
        <ellipse cx="60" cy="65" rx="38" ry="20" fill="#6b3a0a" />
        {[...Array(12)].map((_,i)=>{const a=(i/12)*Math.PI*2,r=14+(i%3)*4; return (
          <circle key={i} cx={60+r*Math.cos(a)} cy={65+r*0.5*Math.sin(a)} r={2+(i%2)} fill="#1a0a00" opacity="0.8"
            style={{ animation:`pepperPop 2s ${i*0.15}s infinite alternate` }} />
        );})}
        <style>{`@keyframes pepperPop{0%{opacity:0.4}100%{opacity:1}}`}</style>
      </svg>
    </div>
  );
}

function TossAnimation() {
  const [t, setT] = useState(0);
  useEffect(() => { const id = setInterval(() => setT(p=>p+1),50); return () => clearInterval(id); },[]);
  const wave=Math.sin(t/8)*6;
  return (
    <div style={{ width:120, height:120, margin:"0 auto" }}>
      <svg viewBox="0 0 120 120">
        <ellipse cx="60" cy="78" rx="44" ry="26" fill="#1a1a1a" />
        {[...Array(8)].map((_,i)=>{const base=65+Math.sin((t+i*15)/8)*4,x=30+i*9; return (
          <path key={i} d={`M${x},${base+wave*0.5} Q${x+4},${base-8+wave} ${x+8},${base+wave*0.5}`}
            stroke="#f5deb3" strokeWidth="2.5" fill="none" opacity="0.85" strokeLinecap="round" />
        );})}
        {[40,55,70,82].map((x,i)=>(
          <circle key={i} cx={x+Math.sin((t+i*20)/8)*3} cy={62+Math.cos((t+i*20)/8)*4} r={2} fill="#f0e68c" opacity="0.7" />
        ))}
      </svg>
    </div>
  );
}

function PlateAnimation() {
  return (
    <div style={{ width:120, height:120, margin:"0 auto" }}>
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="68" r="44" fill="#f0ece4" />
        <circle cx="60" cy="68" r="36" fill="#e8e2d8" />
        {[...Array(6)].map((_,i)=>{const a=(i/6)*Math.PI*2; return (
          <path key={i} d={`M60,68 Q${60+16*Math.cos(a-0.4)},${68+10*Math.sin(a-0.4)} ${60+20*Math.cos(a)},${68+12*Math.sin(a)}`}
            stroke="#d4a853" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.8" />
        );})}
        <circle cx="60" cy="55" r="5" fill="#daa520" opacity="0.6" />
      </svg>
    </div>
  );
}

const AnimationMap = { boil:BoilAnimation, stir:StirAnimation, brown:BrownAnimation, bloom:BloomAnimation, toss:TossAnimation, plate:PlateAnimation };

function Timer({ seconds, onDone }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!running || remaining <= 0) return;
    const id = setTimeout(() => setRemaining(r => { if(r<=1){setRunning(false);setDone(true);onDone?.();return 0;} return r-1; }), 1000);
    return () => clearTimeout(id);
  }, [running, remaining]);
  const mins=Math.floor(remaining/60), secs=remaining%60;
  const pct=((seconds-remaining)/seconds)*100;
  return (
    <div style={{ marginTop:16, display:"flex", alignItems:"center", gap:12 }}>
      <div style={{ position:"relative", width:52, height:52 }}>
        <svg viewBox="0 0 52 52" style={{ width:52, height:52, transform:"rotate(-90deg)" }}>
          <circle cx="26" cy="26" r="22" fill="none" stroke="#333" strokeWidth="3" />
          <circle cx="26" cy="26" r="22" fill="none" stroke={done?"#4ade80":"#f59e0b"} strokeWidth="3"
            strokeDasharray={`${2*Math.PI*22}`} strokeDashoffset={`${2*Math.PI*22*(1-pct/100)}`}
            strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s linear" }} />
        </svg>
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
          fontFamily:"'DM Mono',monospace", fontSize:10, color: done?"#4ade80":"#f5f5f0" }}>
          {done ? "✓" : `${mins}:${String(secs).padStart(2,"0")}`}
        </div>
      </div>
      {!done && (
        <button onClick={() => setRunning(r=>!r)} style={{
          background: running ? "#3f3f3f" : "#f59e0b", color: running ? "#f5f5f0" : "#1a1a1a",
          border:"none", borderRadius:8, padding:"8px 16px", fontFamily:"'DM Mono',monospace",
          fontSize:12, cursor:"pointer", fontWeight:600, letterSpacing:"0.05em", transition:"all 0.2s"
        }}>{running ? "⏸ PAUSE" : remaining===seconds ? "▶ START" : "▶ RESUME"}</button>
      )}
    </div>
  );
}

// True when a pantry row carries the given canonical ingredient id in its
// tag set. Handles both the new plural shape (row.ingredientIds array) and
// the legacy singular (row.ingredientId) — lets composite items (frozen
// pizza tagged with mozzarella + sausage + dough) satisfy a recipe calling
// for any one of their components.
function rowHasIngredient(row, ingredientId) {
  if (!row || !ingredientId) return false;
  if (Array.isArray(row.ingredientIds) && row.ingredientIds.length) {
    return row.ingredientIds.includes(ingredientId);
  }
  return row.ingredientId === ingredientId;
}

// Look up a recipe ingredient in the pantry by canonical ingredientId.
// Ingredients without an ingredientId are treated as untrackable (pasta water,
// "to taste" salt, herbs we don't model, etc).
//
// Multi-canonical aware (migration 0033): matches rows whose
// ingredient_ids array CONTAINS the recipe's ingredient — so a pizza
// tagged [mozzarella, sausage, dough] satisfies a mozzarella recipe,
// and an Italian Blend cheese satisfies any of its component cheeses.
//
// State-aware: when the recipe specifies a state ("crumbs"), we only count
// pantry rows in that exact state. When the recipe is state-agnostic, we
// match any state.
function findInPantry(ing, pantry) {
  if (!pantry || !ing.ingredientId) return null;
  const pool = pantry.filter(p => rowHasIngredient(p, ing.ingredientId));
  if (ing.state) {
    return pool.find(p => (p.state || null) === ing.state) || null;
  }
  return pool[0] || null;
}

// Pantry rows that share the ingredient id but are in the WRONG state for
// the recipe. Used to surface a "Make X from Y" hint on the ingredient
// card when we have raw material for a conversion.
function wrongStateCandidates(ing, pantry) {
  if (!pantry || !ing.ingredientId || !ing.state) return [];
  return pantry.filter(p =>
    rowHasIngredient(p, ing.ingredientId) &&
    (p.state || null) !== ing.state &&
    Number(p.amount) > 0
  );
}

// Decide how a recipe ingredient shows up in the checklist. Does unit
// conversion under the hood (e.g. "2 tbsp butter" vs "1.5 sticks in pantry").
//   status: "skip"          — not tracked (no ingredientId)
//   status: "missing"       — not in pantry, or not enough on hand
//   status: "wrong-state"   — have the ingredient but in the wrong form
//                             (loaf when recipe wants crumbs). Carries the
//                             candidate rows so the UI can offer a convert
//                             shortcut.
//   status: "low"           — have enough, but cooking will drain us below threshold
//   status: "ok"            — plenty on hand
function statusFor(ing, pantry) {
  if (!ing.ingredientId) return { ing, status: "skip" };
  const canonical = findIngredient(ing.ingredientId);
  const row = findInPantry(ing, pantry);
  if (!row || row.amount <= 0) {
    // If the recipe wanted a specific state and we have the same
    // ingredient in a DIFFERENT state, that's an actionable case:
    // the user can convert. Flag it specifically.
    const candidates = wrongStateCandidates(ing, pantry);
    if (candidates.length > 0) {
      return { ing, status: "wrong-state", row: null, candidates };
    }
    return { ing, status: "missing", row: null };
  }
  if (!canonical || !ing.qty)  return { ing, status: "ok", row }; // can't compare; trust presence
  const cmp = compareQty({
    have: { amount: row.amount,       unit: row.unit },
    need: ing.qty,
    lowThreshold: row.lowThreshold,
    ingredient: canonical,
  });
  if (cmp === "unknown") return { ing, status: "ok", row }; // mismatched units — trust presence
  return { ing, status: cmp, row };
}

export default function CookMode({
  recipe, onDone, onExit, onSchedule,
  pantry = [], setPantry, setShoppingList, onGoToShopping,
  userId, family = [], friends = [],
}) {
  const [view, setView] = useState("overview");
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [justAdded, setJustAdded] = useState(0);
  const [cardIng, setCardIng] = useState(null); // { ingredientId, fallbackName, fallbackEmoji }
  // Non-null while the 4-phase celebration/rating/notes flow is on screen.
  // Mounts CookComplete; on finish we hand off to parent's onDone.
  const [completing, setCompleting] = useState(false);

  // Defensive: if no recipe was passed, render nothing. Parent owns selection.
  if (!recipe) return null;

  const steps    = recipe.steps || [];
  const step     = steps[activeStep];
  const AnimComp = AnimationMap[step?.animation];
  const progress = steps.length ? (completedSteps.size / steps.length) * 100 : 0;

  // Bucket recipe ingredients by pantry status. Ingredients tagged with an
  // `ingredientId` (and usually a `qty`) get checked against the pantry with
  // proper unit conversion; untagged ones (pasta water, "to taste" salt,
  // decorative herbs) render without a badge.
  const ingredientStatus = (recipe.ingredients || []).map(ing => statusFor(ing, pantry));
  const missingIngs    = ingredientStatus.filter(s => s.status === "missing");
  const lowIngs        = ingredientStatus.filter(s => s.status === "low");
  const wrongStateIngs = ingredientStatus.filter(s => s.status === "wrong-state");
  const okCount        = ingredientStatus.filter(s => s.status === "ok").length;
  const trackedCount   = ingredientStatus.filter(s => s.status !== "skip").length;

  const addMissingToShoppingList = () => {
    if (!setShoppingList) return;
    const toAdd = [...missingIngs, ...lowIngs];
    if (toAdd.length === 0) return;
    setShoppingList(prev => {
      // de-dupe by ingredientId when present, else by name
      const existing = new Set(prev.map(i => i.ingredientId || i.name.toLowerCase()));
      const next = [...prev];
      toAdd.forEach(({ ing, row }) => {
        const canonical = findIngredient(ing.ingredientId);
        const key = ing.ingredientId || (row?.name || ing.item).toLowerCase();
        if (existing.has(key)) return;
        existing.add(key);
        next.push({
          id: crypto.randomUUID(),
          ingredientId: ing.ingredientId || null,
          name: canonical?.name || row?.name || ing.item,
          emoji: canonical?.emoji || row?.emoji || "🥫",
          amount: ing.qty?.amount ?? 1,
          unit: ing.qty?.unit ?? (row?.unit || "unit"),
          category: canonical?.category || row?.category || "pantry",
          source: "recipe",
        });
      });
      return next;
    });
    setJustAdded(toAdd.length);
    setTimeout(() => setJustAdded(0), 3500);
  };

  const markDone = () => {
    setCompletedSteps(s => new Set([...s, activeStep]));
    if (activeStep < steps.length - 1) setTimeout(() => setActiveStep(s => s + 1), 300);
  };

  const timeLabel = `${totalTimeMin(recipe)} min`;
  const diffLabel = difficultyLabel(recipe.difficulty);

  if (view === "overview") return (
    <div style={{ padding:"20px 24px 40px", maxWidth:480, margin:"0 auto" }}>
      {/* Back out of the recipe to the browser */}
      {onExit && (
        <button onClick={onExit} style={{
          background:"none", border:"none", color:"#666", fontSize:22,
          cursor:"pointer", padding:0, marginBottom:4
        }}>←</button>
      )}
      <div style={{ marginTop:12 }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          {(recipe.cuisine || "").toUpperCase()} · {(recipe.category || "").toUpperCase()}
        </div>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:42, fontWeight:300, lineHeight:1.05, letterSpacing:"-0.03em" }}>{recipe.title}</h1>
        {recipe.subtitle && (
          <p style={{ fontFamily:"'Fraunces',serif", fontStyle:"italic", fontSize:18, color:"#888", marginTop:4 }}>{recipe.subtitle}</p>
        )}
      </div>
      <div style={{ display:"flex", gap:12, marginTop:24 }}>
        {[["⏱", timeLabel],["📊", diffLabel],["👥",`Serves ${recipe.serves}`]].map(([icon,val])=>(
          <div key={val} style={{ flex:1, background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, padding:"12px 8px", textAlign:"center" }}>
            <div style={{ fontSize:18, marginBottom:4 }}>{icon}</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#bbb" }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop:28 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#666", letterSpacing:"0.12em" }}>INGREDIENTS</div>
          {trackedCount > 0 && (
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color: missingIngs.length===0?"#4ade80":"#f59e0b", letterSpacing:"0.12em" }}>
              PANTRY {okCount}/{trackedCount}
            </div>
          )}
        </div>

        {/* Pantry availability summary */}
        {trackedCount > 0 && (
          <div style={{
            marginBottom:14, padding:"12px 14px", borderRadius:12,
            background: missingIngs.length===0 ? "#0f1a0f" : "#1a0f00",
            border: `1px solid ${missingIngs.length===0 ? "#22c55e44" : "#f59e0b44"}`,
          }}>
            {missingIngs.length === 0 && lowIngs.length === 0 ? (
              <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#4ade80" }}>
                ✓ You have everything you need. Let's cook.
              </div>
            ) : (
              <>
                <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color: missingIngs.length>0 ? "#f59e0b" : "#eab308", marginBottom: (missingIngs.length + lowIngs.length) > 0 ? 10 : 0 }}>
                  {missingIngs.length > 0 && <>⚠ Missing {missingIngs.length} ingredient{missingIngs.length>1?"s":""}</>}
                  {missingIngs.length > 0 && lowIngs.length > 0 && " • "}
                  {lowIngs.length > 0 && <>{lowIngs.length} running low</>}
                </div>
                <button
                  onClick={addMissingToShoppingList}
                  style={{ width:"100%", padding:"10px", background:"#f59e0b22", border:"1px solid #f59e0b66", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f59e0b", cursor:"pointer", letterSpacing:"0.08em", fontWeight:600 }}
                >
                  ADD MISSING TO SHOPPING LIST →
                </button>
                {justAdded > 0 && (
                  <div style={{ marginTop:10, fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#4ade80", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span>✓ Added {justAdded} item{justAdded>1?"s":""} to shopping list</span>
                    {onGoToShopping && (
                      <button onClick={onGoToShopping} style={{ background:"none", border:"none", color:"#4ade80", fontFamily:"'DM Mono',monospace", fontSize:10, cursor:"pointer", letterSpacing:"0.08em", textDecoration:"underline" }}>
                        VIEW →
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ background:"#161616", border:"1px solid #2a2a2a", borderRadius:12, overflow:"hidden" }}>
          {ingredientStatus.map(({ ing, status, row, candidates }, i) => {
            const badge = status === "ok"          ? { label:"IN PANTRY",  color:"#4ade80", bg:"#0f1a0f" }
                        : status === "low"         ? { label:"LOW",        color:"#f59e0b", bg:"#1a0f00" }
                        : status === "missing"     ? { label:"MISSING",    color:"#ef4444", bg:"#1a0a0a" }
                        : status === "wrong-state" ? { label:"WRONG FORM", color:"#7eb8d4", bg:"#0f1620" }
                        :                            null;
            // Only rows with a canonical ingredientId are tappable — everything
            // else ("to taste" salt, decorative herbs) just renders static.
            const tappable = !!ing.ingredientId;
            const Row = tappable ? "button" : "div";
            return (
              <Row
                key={i}
                onClick={tappable ? () => setCardIng({
                  ingredientId: ing.ingredientId,
                  fallbackName: row?.name || ing.item,
                  fallbackEmoji: row?.emoji,
                }) : undefined}
                style={{
                  display:"block", width:"100%", textAlign:"left",
                  padding:"12px 16px",
                  borderBottom: i<ingredientStatus.length-1?"1px solid #222":"none",
                  background: "transparent", border: "none",
                  borderBottomStyle: i<ingredientStatus.length-1 ? "solid" : "none",
                  borderBottomWidth: i<ingredientStatus.length-1 ? 1 : 0,
                  borderBottomColor: "#222",
                  cursor: tappable ? "pointer" : "default",
                  color:"inherit",
                }}
              >
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ color:"#bbb", fontSize:14, display:"flex", alignItems:"center", gap:6 }}>
                    {ing.item}
                    {tappable && <span style={{ color:"#444", fontSize:11 }}>ⓘ</span>}
                  </span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#f5c842", fontWeight:500 }}>{ing.amount}</span>
                </div>
                {badge && (
                  <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:badge.color, background:badge.bg, border:`1px solid ${badge.color}44`, padding:"2px 7px", borderRadius:4, letterSpacing:"0.08em" }}>
                      {badge.label}
                    </span>
                    {row && (
                      <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>
                        have {Math.round(row.amount*10)/10} {unitLabel(findIngredient(row.ingredientId), row.unit)}
                      </span>
                    )}
                    {/* WRONG-FORM hint — surfaces when the recipe wants a
                        specific state (crumbs) and the user has the same
                        ingredient in a different state (loaf). Tells them
                        what they CAN work with; the convert chip on the
                        pantry row is the actual action site. */}
                    {status === "wrong-state" && candidates && candidates.length > 0 && (
                      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#7eb8d4", fontStyle:"italic" }}>
                        Have {candidates[0].amount} {candidates[0].state || "(other form)"} — convert in Pantry to make {ing.state}
                      </span>
                    )}
                  </div>
                )}
              </Row>
            );
          })}
        </div>
      </div>
      <div style={{ display:"flex", gap:10, marginTop:32 }}>
        {onSchedule && (
          <button
            onClick={onSchedule}
            style={{
              flex:1, padding:"18px 12px",
              background:"#1a1a1a", color:"#bbb",
              border:"1px solid #2a2a2a", borderRadius:14,
              fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600,
              letterSpacing:"0.06em", cursor:"pointer",
            }}
          >
            SCHEDULE
          </button>
        )}
        <button
          onClick={() => setView("cook")}
          style={{
            flex:2, padding:"18px 24px",
            background:"#f5c842", color:"#111",
            border:"none", borderRadius:14,
            fontFamily:"'DM Mono',monospace", fontSize:14, fontWeight:600,
            letterSpacing:"0.08em", cursor:"pointer",
            boxShadow:"0 0 40px #f5c84233",
          }}
        >
          START COOKING →
        </button>
      </div>
      {cardIng && (
        <IngredientCard
          ingredientId={cardIng.ingredientId}
          fallbackName={cardIng.fallbackName}
          fallbackEmoji={cardIng.fallbackEmoji}
          pantry={pantry}
          currentRecipeSlug={recipe.slug}
          onClose={() => setCardIng(null)}
        />
      )}
    </div>
  );

  return (
    <div style={{ padding:"16px 24px 40px", maxWidth:480, margin:"0 auto" }}>
      <div style={{ height:3, background:"#222", borderRadius:2, marginTop:16, overflow:"hidden" }}>
        <div style={{ height:"100%", background:"#f5c842", borderRadius:2, width:`${progress}%`, transition:"width 0.5s ease" }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:8 }}>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>STEP {activeStep+1} OF {steps.length}</span>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>{completedSteps.size} DONE</span>
      </div>
      <div style={{ display:"flex", gap:8, marginTop:16, justifyContent:"center" }}>
        {steps.map((_,i)=>(
          <button key={i} onClick={()=>setActiveStep(i)} style={{ width: completedSteps.has(i)||i===activeStep?24:8, height:8, borderRadius:4, border:"none", cursor:"pointer", background: completedSteps.has(i)?"#22c55e":i===activeStep?"#f5c842":"#333", transition:"all 0.3s" }} />
        ))}
      </div>
      <div style={{ marginTop:28, background:"#161616", border:"1px solid #2a2a2a", borderRadius:20, padding:"28px 24px", display:"flex", flexDirection:"column", alignItems:"center" }}>
        {AnimComp && <AnimComp />}
        <div style={{ marginTop:20, textAlign:"center" }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", marginBottom:8 }}>{step.icon} STEP {step.id}</div>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:28, fontWeight:300, letterSpacing:"-0.02em" }}>{step.title}</h2>
        </div>
      </div>
      <div style={{ marginTop:20, padding:"20px", background:"#141414", border:"1px solid #252525", borderRadius:14 }}>
        <p style={{ fontSize:16, lineHeight:1.6, color:"#ddd", fontWeight:300 }}>{step.instruction}</p>
        {step.timer && <Timer seconds={step.timer} />}
      </div>
      <div style={{ marginTop:12, padding:"14px 16px", background:"#0f1a0f", border:"1px solid #1e3a1e", borderRadius:10, display:"flex", gap:10 }}>
        <span style={{ fontSize:14, flexShrink:0 }}>💡</span>
        <p style={{ fontSize:13, color:"#7ec87e", lineHeight:1.5, fontStyle:"italic" }}>{step.tip}</p>
      </div>
      <div style={{ display:"flex", gap:12, marginTop:24 }}>
        <button onClick={()=>setActiveStep(s=>Math.max(0,s-1))} disabled={activeStep===0} style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", color: activeStep===0?"#444":"#bbb", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, cursor: activeStep===0?"not-allowed":"pointer" }}>← PREV</button>
        {activeStep < steps.length-1 ? (
          <button onClick={markDone} style={{ flex:2, padding:"14px", background: completedSteps.has(activeStep)?"#1a3a1a":"#f5c842", color: completedSteps.has(activeStep)?"#4ade80":"#111", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.3s" }}>
            {completedSteps.has(activeStep)?"✓ DONE → NEXT":"DONE → NEXT"}
          </button>
        ) : (
          <button onClick={() => setCompleting(true)} style={{ flex:2, padding:"14px", background:"#22c55e", color:"#111", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, cursor:"pointer", boxShadow:"0 0 30px #22c55e44" }}>
            🍝 DONE! LOG IT →
          </button>
        )}
      </div>

      {completing && (
        <CookComplete
          recipe={recipe}
          userId={userId}
          family={family}
          friends={friends}
          pantry={pantry}
          setPantry={setPantry}
          onFinish={() => {
            setCompleting(false);
            onDone?.();
          }}
        />
      )}
    </div>
  );
}
