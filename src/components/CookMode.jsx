import { useState, useEffect, useMemo, useRef } from "react";
import { difficultyLabel, totalTimeMin } from "../data/recipes";
import { findIngredient, unitLabel, compareQty, inferCanonicalFromName, getIngredientInfo, siblingsInHub, INGREDIENTS } from "../data/ingredients";
import IngredientCard from "./IngredientCard";
import CookComplete from "./CookComplete";
import { recipeNutrition, formatMacros } from "../lib/nutrition";
import { useIngredientInfo } from "../lib/useIngredientInfo";
import { useBrandNutrition } from "../lib/useBrandNutrition";
import { pairRecipeIngredients, describePairing, normalizeForMatch, sameCanonicalFamily, deriveRowHeader } from "../lib/recipePairing";
import { useCookSession } from "../lib/useCookSession";
import { useCookTelemetry } from "../lib/useCookTelemetry";
import { useUserRecipes } from "../lib/useUserRecipes";
import { applyCookSessionToRecipe, countActiveSwaps, recipeBrandUpgrades, recipeSwapSummary, relevantSwapsForStep, tokenizeSwappedInstruction } from "../lib/effectiveRecipe";
import { playTimerChime, playStepCompleteChime, primeCookAudio } from "../lib/cookAudio";
import { useWebPush } from "../lib/useWebPush";
import UnitPicker from "./UnitPicker";
import { applyPreferredUnit, prefKeyForIngredient, useUnitPrefsVersion, DISPLAY_CONTEXT } from "../lib/unitPrefs";

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

function Timer({ seconds, onDone, endsAt }) {
  // Wall-clock-driven countdown.
  //
  // The old implementation decremented `remaining` every setTimeout(1s),
  // which sounded fine but drifted badly whenever the browser throttled
  // JS — phone locks, tab backgrounds for long stretches, OS battery
  // saver. On unlock the countdown would resume from its paused value
  // instead of catching up to real wall-clock elapsed, leaving the
  // in-app timer wildly out of sync with the server-side push.
  //
  // Now we pin an absolute `deadline` once, then every render-interval
  // compute remaining = ceil((deadline - Date.now())/1000). Throttled
  // browsers will just re-render late; the MATH always reads from the
  // wall clock, so an unlock snaps the UI to the correct remaining in
  // one paint. The push in cook_step_notifications fires off the same
  // absolute instant, so the two surfaces stay aligned regardless of
  // what JS was doing in the meantime.
  //
  // `endsAt` (from the banner resume handoff) wins over `seconds`
  // because it's the real server-side deadline. Fresh starts use
  // seconds → now + seconds*1000.
  const initialDeadline = endsAt
    ? new Date(endsAt).getTime()
    : Date.now() + seconds * 1000;
  const [deadline, setDeadline]    = useState(initialDeadline);
  const [pausedAt, setPausedAt]    = useState(null);  // ms — when running=false
  const [tick, setTick]            = useState(0);
  const [done, setDone]            = useState(false);
  const running = pausedAt == null;

  const remaining = Math.max(
    0,
    Math.ceil(((running ? deadline : pausedAt) - Date.now()) / 1000),
  );

  // Reset to the step's full duration. Fires from the RESET button
  // when the cook needs to re-run a step without advancing.
  const reset = () => {
    setDeadline(Date.now() + seconds * 1000);
    setPausedAt(null);
    setDone(false);
  };
  // Re-pin the deadline when `seconds` itself changes mid-cook
  // (calibration update or step-navigation remount).
  useEffect(() => {
    setDeadline(Date.now() + seconds * 1000);
    setPausedAt(null);
    setDone(false);
  }, [seconds]);

  // Tick the render clock. 500ms is plenty for a 1s-precision display
  // and smooths over Safari's coarser throttle on backgrounded tabs
  // (Safari's minimum throttle is ~1s, so 500ms gives us two shots at
  // a one-second grid). No cleanup complexity; we just repaint.
  useEffect(() => {
    if (!running || done) return undefined;
    const id = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, [running, done]);

  // Detect rollover to 0 on any render (including the first one after
  // unlock that snaps from 3:42 past the deadline). Guarded by `done`
  // so onDone fires exactly once — idempotent re-triggers would double
  // the chime + fire extra local notifications.
  useEffect(() => {
    if (!done && running && remaining <= 0) {
      setDone(true);
      setPausedAt(Date.now());   // stop the interval
      onDone?.();
    }
  }, [remaining, running, done, onDone]);

  // Pause / resume — preserve "time remaining" across the flip.
  const togglePause = () => {
    if (done) return;
    if (running) {
      setPausedAt(Date.now());
    } else {
      // Shift the deadline forward by however long we were paused.
      setDeadline(d => d + (Date.now() - pausedAt));
      setPausedAt(null);
    }
  };

  // Also recheck remaining whenever the page becomes visible again —
  // covers the lock-screen case where `setInterval` got suspended for
  // N seconds; we want to repaint immediately on unlock, not wait for
  // the next 500ms tick.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVis = () => { if (document.visibilityState === "visible") setTick(t => t + 1); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const mins=Math.floor(remaining/60), secs=remaining%60;
  const pct=((seconds-remaining)/seconds)*100;
  const showReset = done || remaining !== seconds;
  const pulsing = !done && running && remaining > 0 && remaining <= 10;
  return (
    <div style={{ marginTop:16, display:"flex", alignItems:"center", gap:12 }}>
      <div style={{ position:"relative", width:52, height:52 }}>
        <svg viewBox="0 0 52 52" style={{ width:52, height:52, transform:"rotate(-90deg)" }}>
          <circle cx="26" cy="26" r="22" fill="none" stroke="#333" strokeWidth="3" />
          <circle cx="26" cy="26" r="22" fill="none" stroke={done?"#4ade80":pulsing?"#ef4444":"#f59e0b"} strokeWidth="3"
            strokeDasharray={`${2*Math.PI*22}`} strokeDashoffset={`${2*Math.PI*22*(1-pct/100)}`}
            strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s linear, stroke 0.3s" }} />
        </svg>
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
          fontFamily:"'DM Mono',monospace", fontSize:10, color: done?"#4ade80":pulsing?"#ef4444":"#f5f5f0",
          animation: pulsing ? "cookTimerPulse 1s ease-in-out infinite" : "none" }}>
          {done ? "✓" : `${mins}:${String(secs).padStart(2,"0")}`}
        </div>
      </div>
      {!done && (
        <button onClick={togglePause} style={{
          background: running ? "#3f3f3f" : "#f59e0b", color: running ? "#f5f5f0" : "#1a1a1a",
          border:"none", borderRadius:8, padding:"8px 16px", fontFamily:"'DM Mono',monospace",
          fontSize:12, cursor:"pointer", fontWeight:600, letterSpacing:"0.05em", transition:"all 0.2s"
        }}>{running ? "⏸ PAUSE" : "▶ RESUME"}</button>
      )}
      {done && (
        <div style={{
          fontFamily:"'DM Mono',monospace", fontSize:11, color:"#4ade80",
          letterSpacing:"0.12em",
        }}>⏰ TIMER'S UP</div>
      )}
      {showReset && (
        <button onClick={reset} style={{
          background: "transparent", color: "#9a9a9a",
          border: "1px solid #3a3a3a", borderRadius: 8, padding: "8px 14px",
          fontFamily: "'DM Mono',monospace", fontSize: 12, cursor: "pointer",
          fontWeight: 600, letterSpacing: "0.05em", transition: "all 0.2s",
        }}>↻ RESET</button>
      )}
      <style>{`@keyframes cookTimerPulse{0%,100%{opacity:1}50%{opacity:0.55}}`}</style>
    </div>
  );
}

// True when a pantry row's PRIMARY canonical identity matches the given
// ingredient id (after alias / hub-family redirect). A recipe calling for
// standalone mozzarella is NOT satisfied by a frozen pizza that happens
// to list mozzarella in its ingredientIds[] composition — user won't
// crack open the pizza to cook with. Deduction needs primary identity.
//
// Previously this function ALSO checked ingredientIds[] membership (the
// migration-0033 "composite items satisfy component calls" rule), which
// caused pizzas / leftovers to auto-pair with component ingredients.
// The composition axis still exists in the data; it's useful for "what
// macros does this pizza contain?" questions but not for deduction
// pairing.
//
// Hub-family aware: a recipe asking for `chicken_breast` (legacy
// compound slug) matches a pantry row tagged `chicken` + cut=breast
// (new model) and vice-versa, because both resolve to chicken_hub.
// Without this, a user with Chicken Breast in the pantry saw
// "Not in pantry — add to shopping list" on any recipe the AI tagged
// with the legacy slug — the exact "it's purposely trying to fuck us"
// bug user hit on Chicken Tortillas.
function rowHasIngredient(row, ingredientId) {
  if (!row || !ingredientId) return false;
  if (row.ingredientId === ingredientId) return true;
  return sameCanonicalFamily(row.ingredientId, ingredientId);
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
  // Fork-to-new-recipe callback. Wired by the parent (Plan.jsx /
  // CreateMenu.jsx) to useUserRecipes.saveRecipe. When the user
  // finishes a cook with active swaps, CookComplete offers "SAVE
  // CHANGES AS NEW RECIPE" which calls this with the materialized
  // effective recipe; saveRecipe generates a unique slug, so the
  // original recipe stays untouched — "the recipe remains the
  // golden standard" principle the user called out when designing
  // this flow. Optional: if not provided, the save action simply
  // isn't offered.
  onForkRecipe = null,
  // Resume-from-banner handoff. When the CookBanner re-opens CookMode
  // on an already-active session, App passes the live step index + a
  // hint to skip past the ingredient-prep overview + the real
  // cook_step_notifications.deliver_at so the in-app Timer shows
  // wall-clock-accurate remaining seconds instead of a fresh
  // step.timer countdown. Defaults keep the first-launch flow
  // (overview → step 0 → fresh countdown from step.timer) intact.
  initialView       = "overview",
  initialStepIndex  = 0,
  initialTimerEndsAt = null,
}) {
  const [view, setView] = useState(initialView);
  const [activeStep, setActiveStep] = useState(initialStepIndex);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [justAdded, setJustAdded] = useState(0);
  const [cardIng, setCardIng] = useState(null); // { ingredientId, fallbackName, fallbackEmoji }
  // UnitPicker state — user-chosen unit overrides for ingredient
  // amounts in the "FOR THIS STEP" list. Keyed by ingredientId so
  // the override carries across every step that references the
  // same canonical (pick tbsp for butter once, every step shows
  // butter in tbsp). `unitPicker` holds the row currently open
  // in the modal.
  const [unitOverrides, setUnitOverrides] = useState({});
  const [unitPicker, setUnitPicker] = useState(null);
  // Subscribe to preference changes so a Settings toggle re-renders
  // amounts in-place without a page reload.
  useUnitPrefsVersion();
  // Shared cook-time session state (src/lib/useCookSession.js). Owns
  // per-ingredient overrides (pantryItemId swaps, shopping promotions,
  // skip flags) and user-added extras. Passed as a prop to
  // CookComplete so the "What did you use?" screen reads the same
  // swaps the user made on cook-prep. Previously each screen kept
  // its own parallel override shape and overrides vanished on screen
  // transition; session fixes that permanently.
  const cookSession = useCookSession();
  const { session, setOverride, clearOverride, resetSession } = cookSession;
  // Reset the ephemeral swap/skip session whenever the cooked recipe
  // changes. useState inside useCookSession already resets on remount,
  // so this only matters when the parent swaps the recipe prop without
  // unmounting CookMode — but that path DOES exist (CreateMenu and
  // Plan both keep CookMode alive across some transitions), and a
  // stale session carrying butter→HWC overrides into a v2 where HWC
  // is already canon would re-paint the v2 as "swapped" on first
  // render. Keying on recipe.slug (stable across ingredient edits)
  // rather than identity avoids spurious resets when the parent hands
  // back a fresh object reference for the same recipe.
  useEffect(() => {
    resetSession();
  }, [recipe?.slug, resetSession]);

  // Web Push subscription for this device. We don't AUTO-prompt on
  // mount (browsers blacklist you for that). Instead, render an inline
  // "enable" card inside the cook view the first time a user starts
  // a timer on an unsubscribed device. Rationale: without a push
  // subscription, the server-side cron drain that fires
  // cook_step_notifications has nobody to deliver to — lock-screen
  // rings never arrive. Opt-in is the difference between "the timer
  // works" and "the timer only works when I'm looking at it."
  const webPush = useWebPush(userId);

  // ── Cook telemetry + timer pushes (migration 0136 / 0137) ─────────
  // Records per-step durations and queues mid-cook timer notifications
  // so a user who locks their phone during a 30-min braise still gets
  // pinged when it's time to act. All side-effects fire-and-forget;
  // failures inside useCookTelemetry log + swallow.
  const telemetry = useCookTelemetry(userId);
  const lastStartedStepRef = useRef(null);
  // Guards the unmount-cleanup so a user who finalized the cook
  // doesn't ALSO get a competing endCook(abandoned) racing with
  // their endCook(finished) write.
  const finalizedRef = useRef(false);
  // Captured at the "DONE! LOG IT" moment so CookComplete can stamp
  // cook_log_id onto the session row AFTER it creates the cook_log.
  // endCook is async + sets session → null on re-render; grabbing the
  // id synchronously on the button click keeps the thread-back correct
  // even if the endCook write is still in flight when CookComplete
  // mounts.
  const [completingSessionId, setCompletingSessionId] = useState(null);

  // Open a cook_sessions row the first time the user enters the live
  // cook view. Gated on the session not already existing so toggling
  // back to overview and forward again doesn't open duplicates.
  useEffect(() => {
    if (view !== "cook" || !recipe?.slug || telemetry.session) return;
    telemetry.startCook({
      recipeSlug:  recipe.slug,
      recipeTitle: recipe.title,
      recipeEmoji: recipe.emoji,
    });
    // Prime the Web Audio context on this explicit user action so
    // subsequent Timer chimes land on an unsuspended context — mobile
    // browsers suspend until a gesture. Safe to call repeatedly.
    primeCookAudio();
  }, [view, recipe?.slug, recipe?.title, recipe?.emoji, telemetry]);

  // Each time activeStep changes (and we're inside a live session),
  // start a new cook_session_steps row + queue a timer push when the
  // step has a nominal timer. The hook auto-finishes the previous
  // step + cancels its pending push, so back-and-forth nav between
  // steps stays clean.
  useEffect(() => {
    if (view !== "cook" || !telemetry.session) return;
    const recipeSteps = recipe?.steps || [];
    const step = recipeSteps[activeStep];
    if (!step) return;
    const key = `${telemetry.session.id}:${step.id}`;
    if (lastStartedStepRef.current === key) return;
    lastStartedStepRef.current = key;
    telemetry.startStep({
      stepId:         step.id,
      stepTitle:      step.title,
      nominalSeconds: Number.isFinite(step.timer) ? step.timer : 0,
      timerBody:      step.title
        ? `Step ${step.id}: ${step.title} — timer's up`
        : null,
    });
  }, [view, activeStep, telemetry, recipe]);

  // NOTE: we intentionally DO NOT mark the session abandoned when
  // CookMode unmounts. Before, any back-button / parent-close path
  // flipped status → 'abandoned', which made the "resume your cook"
  // banner impossible — the row we'd key off was torched before the
  // user even noticed they'd navigated away. Now unmounts are treated
  // as "stepping out of the kitchen for a moment"; the session stays
  // active for up to 2h (enforced by useCookTelemetry.startCook's
  // resume window) and surfaces as a pinned top banner via
  // useActiveCookSession. Explicit abandonment is still reachable —
  // it happens when the user starts a different recipe (startCook
  // creates a fresh row) or when the 2h window lapses.

  // Wake lock — keep the screen on while CookMode is visible.
  // navigator.wakeLock is supported on Chrome/Edge/Android; silently
  // no-ops on Safari and older browsers. Re-acquires on visibility
  // change because the browser drops the lock whenever the tab is
  // backgrounded.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return undefined;
    let sentinel = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch (e) {
        // Battery-saver mode or permissions policy — not fatal.
        console.warn("[cookMode] wake lock denied:", e?.message || e);
      }
    };
    acquire();
    const onVis = () => {
      if (!cancelled && document.visibilityState === "visible" && (!sentinel || sentinel.released)) {
        acquire();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      try { sentinel && sentinel.release && sentinel.release(); } catch { /* ignore */ }
    };
  }, []);

  const [swapOpenIdx, setSwapOpenIdx] = useState(null);
  const [swapSearch, setSwapSearch] = useState("");
  const openSwapPicker = (idx) => { setSwapOpenIdx(idx); setSwapSearch(""); };
  // Non-null while the 4-phase celebration/rating/notes flow is on screen.
  // Mounts CookComplete; on finish we hand off to parent's onDone.
  const [completing, setCompleting] = useState(false);

  // Two-state confirm for the cook-view EXIT button. MINIMIZE keeps
  // the session alive (banner resumes); EXIT ends it — drops pending
  // timer pushes, flips cook_sessions.status to 'abandoned'. Separate
  // from CookComplete's "finish" path so accidentally backing out of
  // a cook doesn't log it as cooked.
  const [confirmExit, setConfirmExit] = useState(false);
  const exitCook = async () => {
    finalizedRef.current = true;
    try { await telemetry.endCook({ status: "abandoned" }); } catch (_) { /* non-fatal */ }
    onExit?.();
  };

  // Author + share state for THIS recipe. If the viewer owns a
  // user_recipes row matching the recipe's slug, the overview
  // exposes a SHARE WITH FAMILY toggle (otherwise no toggle — you
  // can't share someone else's recipe, and the bundled library
  // isn't share-able either). The row lookup is cheap; useUserRecipes
  // already subscribes to realtime so share state flips in place
  // after the server confirms.
  const { recipes: userRecipesList, setSharing: setRecipeSharing } = useUserRecipes(userId);
  const ownRecipeRow = useMemo(
    () => userRecipesList.find(r => r.userId === userId && r.slug === recipe?.slug) || null,
    [userRecipesList, userId, recipe?.slug],
  );
  const canShare = !!ownRecipeRow;
  const isShared = ownRecipeRow?.shared === true;
  const toggleShare = async () => {
    if (!ownRecipeRow) return;
    try {
      await setRecipeSharing(ownRecipeRow.id, { shared: !isShared });
    } catch (e) {
      console.error("[cookMode] toggleShare failed:", e);
    }
  };

  // Nutrition rollup for the recipe — drives the calorie tile in the
  // meta row below. Pulls from the full resolver chain (pantry
  // override → brand_nutrition → ingredient_info → bundled canonical
  // fallback) so the number reflects the user's actual stocked items
  // whenever the recipe references something they've scanned. Hooks
  // must run unconditionally; kept above the `if (!recipe)` guard.
  const ingredientInfo = useIngredientInfo();
  const { get: getBrandNutrition } = useBrandNutrition();
  const brandNutrition = useMemo(
    () => ({ get: (k) => getBrandNutrition?.(k) || null }),
    [getBrandNutrition],
  );
  const nutritionSummary = useMemo(
    () => recipe ? recipeNutrition(recipe, { pantry, getInfo: ingredientInfo?.getInfo, brandNutrition }) : null,
    [recipe, pantry, ingredientInfo, brandNutrition],
  );

  // Defensive: if no recipe was passed, render nothing. Parent owns selection.
  if (!recipe) return null;

  // Project the cook session's swaps/skips into an "effective" view of
  // the recipe so step-level renders see what the overview swap UI
  // already knows about. See src/lib/effectiveRecipe.js — pure
  // derivation, never persisted. The original recipe prop stays
  // untouched; only the explicit "save changes as new recipe" path
  // in CookComplete materializes this into a user_recipes row.
  const effectiveRecipe = applyCookSessionToRecipe(recipe, session, pantry);
  const swapCount = countActiveSwaps(session);
  // Recipe-wide swap list for the per-step prose banner + inline
  // tokenizer. Built once per render; derived from
  // effectiveRecipe.ingredients so every swap — even ones the AI
  // omitted from step.uses — can surface in prose that mentions the
  // original name.
  const allSwaps = recipeSwapSummary(effectiveRecipe);
  // Brand-upgrade rewrites — same-canonical pantry rows whose branded
  // display name we lift into the recipe ("butter" → "Kerrygold
  // Butter"). Applied to prose as a plain rename BEFORE the swap
  // tokenizer runs, so branded replacements never collide with
  // strike-through markup.
  const allBrandUpgrades = recipeBrandUpgrades(effectiveRecipe);

  const steps    = effectiveRecipe.steps || [];
  const step     = steps[activeStep];
  const AnimComp = AnimationMap[step?.animation];
  const progress = steps.length ? (completedSteps.size / steps.length) * 100 : 0;

  // Bucket recipe ingredients by pantry status. Ingredients tagged with an
  // `ingredientId` (and usually a `qty`) get checked against the pantry with
  // proper unit conversion; untagged ones (pasta water, "to taste" salt,
  // decorative herbs) render without a badge.
  const ingredientStatus = (recipe.ingredients || []).map(ing => statusFor(ing, pantry));
  // Live pairing pass against CURRENT pantry — intentionally
  // computed fresh every render, NEVER persisted on the recipe.
  // The recipe stores canonical + dietaryClaims intent only; which
  // specific pantry row backs each ingredient is a live decision
  // so brand/availability drift a month from now doesn't fossilize
  // a stale pair. Zipped by index into ingredientStatus.
  //
  // Swaps/skips are already baked into effectiveRecipe.ingredients
  // (via applyCookSessionToRecipe) — swapped entries carry
  // pantryItemId for the Tier 0 short-circuit in
  // pairRecipeIngredients. Using effectiveRecipe here keeps the
  // step renderer, pairing pass, and CookComplete all reading from
  // the same derivation.
  const ingredientPairings = pairRecipeIngredients(effectiveRecipe.ingredients || [], pantry || []);

  // Look up a pairing by an ingredient identity (canonical id first,
  // normalized name second). Same key strategy applyCookSessionToRecipe
  // uses internally, so step.uses entries (which carry their own
  // ingredientId from the recipe) line up with effectiveRecipe.ingredients
  // pairings. Built here so the step-render scope can reach matched
  // pantry rows without re-running pairRecipeIngredients per step.
  const pairingByKey = new Map();
  (effectiveRecipe.ingredients || []).forEach((ing, i) => {
    const p = ingredientPairings[i];
    if (!p) return;
    if (ing.ingredientId) pairingByKey.set(`id:${ing.ingredientId}`, p);
    const nm = normalizeForMatch(ing.item || "");
    if (nm) pairingByKey.set(`nm:${nm}`, p);
  });
  const findPairing = (ing) => {
    if (!ing) return null;
    if (ing.ingredientId) {
      const hit = pairingByKey.get(`id:${ing.ingredientId}`);
      if (hit) return hit;
    }
    const nm = normalizeForMatch(ing.item || "");
    if (nm) return pairingByKey.get(`nm:${nm}`) || null;
    return null;
  };

  // Per-ingredient amount substitutions for the prose tokenizer:
  // when the user picks a different unit on the FOR-THIS-STEP chip
  // (or has a saved preference that resolves to a different unit),
  // the displayed amount on the chip drifts from the recipe's
  // authored amount string. Push the (authored → displayed) pairs
  // into the prose tokenizer so the inline instruction's measurements
  // track the chip the cook is reading from. Skipped when the chip
  // matches the recipe (no rewrite needed) and when the recipe author
  // omitted ing.amount (nothing to find/replace).
  const allAmountReplacements = (effectiveRecipe.ingredients || [])
    .map(ing => {
      const overrideKey = prefKeyForIngredient(ing);
      const overrideAmount = overrideKey ? unitOverrides[overrideKey] : null;
      const preferred = overrideAmount || applyPreferredUnit(ing.amount, ing, DISPLAY_CONTEXT.COOK);
      if (!preferred || !ing.amount) return null;
      if (String(preferred).trim() === String(ing.amount).trim()) return null;
      return { from: String(ing.amount), to: String(preferred) };
    })
    .filter(Boolean);

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
        // Canonical backfill: Claude may leave ing.ingredientId null
        // for "staples it assumed" or newly-introduced ingredients
        // (per generate-recipe/index.ts:447). Run the item text
        // through inferCanonicalFromName to hit any bundled canonical
        // that substring-matches — that stamps ingredientId on the
        // shopping-list row so the downstream receipt-scan bias
        // (+30 for ingredientId match) fires, not just the weaker
        // +20 name-substring tier. No AI call — cheap local lookup.
        const candidateName = row?.name || ing.item;
        const resolvedId = ing.ingredientId
          || inferCanonicalFromName(candidateName)
          || null;
        const canonical = findIngredient(resolvedId);
        const key = resolvedId || candidateName.toLowerCase();
        if (existing.has(key)) return;
        existing.add(key);
        next.push({
          id: crypto.randomUUID(),
          ingredientId: resolvedId,
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

  // Single-row "+ SHOP" — mirrors addMissingToShoppingList's canonical-
  // backfill logic but scoped to one ingredient at a time. Marks the
  // row as added locally so the button flips to ✓ without a re-render
  // race on the parent's shopping list.
  const addOneToShoppingList = (ing, row, idx) => {
    if (!setShoppingList) return;
    if (session.overrides[idx]?.promotedToShopping) return;
    setShoppingList(prev => {
      const existing = new Set(prev.map(i => i.ingredientId || i.name.toLowerCase()));
      const candidateName = row?.name || ing.item;
      const resolvedId = ing.ingredientId
        || inferCanonicalFromName(candidateName)
        || null;
      const canonical = findIngredient(resolvedId);
      const key = resolvedId || candidateName.toLowerCase();
      if (existing.has(key)) return prev;
      return [...prev, {
        id: crypto.randomUUID(),
        ingredientId: resolvedId,
        name: canonical?.name || row?.name || ing.item,
        emoji: canonical?.emoji || row?.emoji || "🥫",
        amount: ing.qty?.amount ?? 1,
        unit: ing.qty?.unit ?? (row?.unit || "unit"),
        category: canonical?.category || row?.category || "pantry",
        source: "recipe",
      }];
    });
    setOverride(idx, { promotedToShopping: true });
  };

  // Rank every pantry row by closeness to a recipe ingredient. Same
  // signal stack as AIRecipe's swap picker: exact canonical (+1000),
  // same hub (+500), same category (+100), plus token overlap. When
  // the user is typing we narrow to substring-matches on the pantry
  // row name so the list feels like a live search, not a rank.
  //
  // Returns { pantry, library } — pantry is the existing "rows the cook
  // already owns" ranking; library surfaces bundled canonicals the cook
  // can legitimately substitute even if they're not in the pantry
  // (2% ↔ whole milk, carrot ↔ celery, chicken ↔ steak). Sources:
  //   1. Author-curated substitutions on the canonical's info.
  //   2. Same-hub siblings (milk_hub → 2%, whole, skim, oat).
  // Library candidates that collide with a pantry canonical are pruned
  // so the user sees one row per ingredient, not two.
  const rankSwapCandidates = (ing, query) => {
    const targetCanon = ing.ingredientId ? findIngredient(ing.ingredientId) : null;
    const targetCat  = targetCanon?.category || null;
    const targetSlug = targetCanon?.id || null;
    const targetHub  = targetCanon?.parentId || targetCanon?.id || null;
    const targetTokens = new Set(
      normalizeForMatch(ing.item || ing.name || targetCanon?.name || "")
        .split(/\s+/).filter(Boolean),
    );
    const q = (query || "").trim().toLowerCase();
    const pantrySeen = new Set();
    const pantryScored = [];
    for (const p of pantry || []) {
      if (!p) continue;
      const canon = p.ingredientId ? findIngredient(p.ingredientId) : null;
      const key = canon?.id || (p.name || "").toLowerCase() || p.id;
      if (pantrySeen.has(key)) continue;
      pantrySeen.add(key);
      if (q && !(p.name || "").toLowerCase().includes(q)) continue;
      let score = 0;
      if (canon?.id && targetSlug && canon.id === targetSlug) score += 1000;
      const pHub = canon?.parentId || canon?.id;
      if (pHub && targetHub && pHub === targetHub) score += 500;
      if (canon?.category && targetCat && canon.category === targetCat) score += 100;
      const pTokens = new Set(
        normalizeForMatch(p.name || "").split(/\s+/).filter(Boolean),
      );
      let overlap = 0;
      for (const t of targetTokens) if (pTokens.has(t)) overlap++;
      score += overlap * 10;
      pantryScored.push({ row: p, score });
    }
    pantryScored.sort((a, b) => b.score - a.score);

    // Library candidates — curated substitutions + hub siblings. Score
    // scale mirrors pantry: hub sibling +500, curated entry +400 (below
    // hub so same-hub alternates top the list even without author
    // curation), category match +100, token overlap +10 each. No +1000
    // tier — a library entry with the target's own canonical would be
    // "swap X for X," which is nonsense; we filter those out below.
    const librarySeen = new Set(pantrySeen); // don't re-surface pantry canonicals as library
    if (targetSlug) librarySeen.add(targetSlug);
    const libraryMap = new Map(); // canonId → { canonical, score, note }
    const addLibraryCandidate = (canonical, baseScore, note = null) => {
      if (!canonical?.id || librarySeen.has(canonical.id)) return;
      if (q && !canonical.name.toLowerCase().includes(q)) return;
      let score = baseScore;
      if (canonical.category && targetCat && canonical.category === targetCat) score += 100;
      const cTokens = new Set(
        normalizeForMatch(canonical.name || "").split(/\s+/).filter(Boolean),
      );
      let overlap = 0;
      for (const t of targetTokens) if (cTokens.has(t)) overlap++;
      score += overlap * 10;
      const prev = libraryMap.get(canonical.id);
      if (!prev || prev.score < score) {
        libraryMap.set(canonical.id, { canonical, score, note: note || prev?.note || null });
      }
    };

    // 1. Curated substitutions from the ingredient's info. These are
    //    author-vetted and carry a short note ("accept that the result
    //    will be more assertive", etc.) — the best-quality signal.
    if (targetCanon) {
      const dbInfo = ingredientInfo?.getInfo ? ingredientInfo.getInfo(targetCanon.id) : null;
      const info = getIngredientInfo(targetCanon, dbInfo);
      for (const sub of info?.substitutions || []) {
        if (!sub?.id) continue;
        const subCanon = findIngredient(sub.id);
        if (!subCanon) continue;
        addLibraryCandidate(subCanon, 400, sub.note || null);
      }
    }
    // 2. Same-hub siblings (milk variants, onion variants, etc.) —
    //    automatic coverage for ladders like 2%/whole/skim even when
    //    nobody authored a substitutions entry.
    if (targetSlug) {
      for (const sib of siblingsInHub(targetSlug)) {
        addLibraryCandidate(sib, 500, null);
      }
    }
    // 3. Free-text search over the full bundled registry when the cook
    //    types a query. Without this, typing "celery" on a carrot
    //    wouldn't surface celery unless an author had already curated
    //    that link — which is exactly the "swap is extremely limited"
    //    complaint. Low base score (50) keeps curated / hub matches
    //    on top when both apply; same-category adds +100 so e.g.
    //    searching "steak" from chicken surfaces sirloin above
    //    off-category collisions. Only fires with a query to avoid
    //    dumping 387 candidates into the picker on open.
    if (q && q.length >= 2) {
      for (const ing of INGREDIENTS) {
        if (!ing?.name || !ing.name.toLowerCase().includes(q)) continue;
        addLibraryCandidate(ing, 50, null);
      }
    }

    const libraryScored = Array.from(libraryMap.values())
      .sort((a, b) => b.score - a.score);

    return { pantry: pantryScored, library: libraryScored };
  };

  const applySwap = (idx, pantryItemId) => setOverride(idx, {
    pantryItemId,
    // A pantry swap clears any prior library swap on the same slot so
    // the override shape stays single-valued. effectiveRecipe.js would
    // otherwise see both set and have to pick a precedence.
    swapCanonicalId: undefined,
    swapCanonicalName: undefined,
    swapCanonicalEmoji: undefined,
  });
  // Library swap — cook picked a canonical that isn't in pantry. We
  // carry the display name + emoji on the override so the cook-surface
  // renderer can show the ingredient without re-resolving the canonical
  // every render. effectiveRecipe.js applies this by producing a
  // swapped ingredient slot that has no pantryItemId — pairing stays
  // "missing" against the pantry (correct: cook said "I'm using
  // celery" but didn't stock any), while steps / ingredient lists
  // reflect the substitution. See applyCookSessionToRecipe.
  const applyLibrarySwap = (idx, canonical) => setOverride(idx, {
    swapCanonicalId:    canonical.id,
    swapCanonicalName:  canonical.name,
    swapCanonicalEmoji: canonical.emoji,
    pantryItemId: undefined,
  });
  const clearSwap = (idx) => clearOverride(idx, [
    "pantryItemId", "swapCanonicalId", "swapCanonicalName", "swapCanonicalEmoji",
  ]);

  const markDone = () => {
    setCompletedSteps(s => new Set([...s, activeStep]));
    // Stamp the step as finished + cancel any pending timer push.
    // No-op if telemetry isn't tracking this step (e.g. session
    // creation hasn't landed yet on a fast-tap user).
    telemetry.finishStep({});
    // Satisfying tactile confirmation the step was logged — quieter
    // than the timer chime so rapid step-taps don't sound like a
    // malfunctioning alarm clock.
    playStepCompleteChime();
    if (activeStep < steps.length - 1) setTimeout(() => setActiveStep(s => s + 1), 300);
  };

  const timeLabel = `${totalTimeMin(recipe)} min`;
  const diffLabel = difficultyLabel(recipe.difficulty);

  if (view === "overview") return (
    <div style={{ padding:"20px 24px 40px", maxWidth:480, margin:"0 auto" }}>
      {/* Top bar — left: ← back to the browser (minimizes if a session
          is live, just closes otherwise). Right: ✕ EXIT button that
          tears the cook down, available from the PREVIEW screen so
          the author isn't forced into the cook view just to bail. */}
      {onExit && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
          <button onClick={onExit} style={{
            background:"none", border:"none", color:"#666", fontSize:22,
            cursor:"pointer", padding:0,
          }}>←</button>
          {confirmExit ? (
            <span style={{ display:"flex", alignItems:"center", gap:6 }}>
              <button
                onClick={() => setConfirmExit(false)}
                style={{
                  background:"#1a1a1a", border:"1px solid #2a2a2a", color:"#888",
                  borderRadius:20, padding:"8px 12px",
                  fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.12em",
                  cursor:"pointer",
                }}
              >
                KEEP
              </button>
              <button
                onClick={exitCook}
                style={{
                  background:"#2a0a0a", border:"1px solid #5a1a1a", color:"#f87171",
                  borderRadius:20, padding:"8px 12px",
                  fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:600, letterSpacing:"0.12em",
                  cursor:"pointer",
                }}
              >
                END COOK
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmExit(true)}
              title="End cook and drop this recipe"
              style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:"#dc2626", border:"1px solid #ef4444", color:"#fff",
                borderRadius:20, padding:"10px 18px",
                fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700, letterSpacing:"0.12em",
                cursor:"pointer",
                boxShadow:"0 0 20px rgba(220,38,38,0.4)",
              }}
            >
              ✕ EXIT
            </button>
          )}
        </div>
      )}
      <div style={{ marginTop:12 }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#f5c842", letterSpacing:"0.15em", marginBottom:8 }}>
          {(recipe.cuisine || "").toUpperCase()} · {(recipe.category || "").toUpperCase()}
        </div>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:42, fontWeight:300, lineHeight:1.05, letterSpacing:"-0.03em" }}>{recipe.title}</h1>
        {recipe.subtitle && (
          <p style={{ fontFamily:"'Fraunces',serif", fontStyle:"italic", fontSize:18, color:"#888", marginTop:4 }}>{recipe.subtitle}</p>
        )}
        {/* SHARE WITH FAMILY toggle — preview-screen placement so the
            author decides sharing at the moment they see the whole
            recipe, not buried inside a row in the template picker.
            Only rendered when the viewer owns this recipe (the
            authoritative check: a matching user_recipes row where
            user_id is the viewer). Bundled recipes and family-
            authored recipes both fall past this gate — neither is
            share-able by the viewer. */}
        {canShare && (
          <button
            onClick={toggleShare}
            title={isShared ? "Shared with family — tap to make private" : "Private — tap to share with family"}
            style={{
              marginTop: 12,
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "8px 14px",
              background: isShared ? "#14201a" : "#1a1a1a",
              border: `1px solid ${isShared ? "#2a4a28" : "#2a2a2a"}`,
              color: isShared ? "#a3d977" : "#aaa",
              borderRadius: 20,
              fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
              letterSpacing: "0.1em", cursor: "pointer",
            }}
          >
            {isShared ? "🤝 SHARED WITH FAMILY" : "🔒 SHARE WITH FAMILY"}
          </button>
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
      {/* Per-serving macros rollup — verbose ('500 kcal · 12g protein
          · 8g carbs · 7g fat') because cooks pre-meal want the full
          picture, not just kcal. Hidden when the resolver couldn't
          map any ingredient to nutrition (coverage.resolved === 0) —
          don't render a misleading all-zeros card. Coverage subtitle
          discloses gaps honestly when the recipe has untracked
          ingredients. Matches the MealDetail macros card in
          CreateMenu.jsx:816 for visual continuity between the
          plan-the-menu surface and the about-to-cook surface. */}
      {nutritionSummary && nutritionSummary.coverage.resolved > 0 && (
        <div style={{
          marginTop: 14, padding: "10px 14px",
          background: "#141414", border: "1px solid #242424",
          borderRadius: 10,
        }}>
          <div style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#f0ece4",
          }}>
            ~ {formatMacros(nutritionSummary.perServing, { verbose: true })}
          </div>
          <div style={{
            marginTop: 3,
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            color: "#666", letterSpacing: "0.08em",
          }}>
            PER SERVING
            {nutritionSummary.coverage.resolved < nutritionSummary.coverage.total
              ? ` · BASED ON ${nutritionSummary.coverage.resolved} OF ${nutritionSummary.coverage.total} INGREDIENTS`
              : ""}
          </div>
        </div>
      )}
      <div style={{ marginTop:28 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:10, flexWrap:"wrap" }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#666", letterSpacing:"0.12em" }}>INGREDIENTS</div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            {/* Active-swap badge — reassurance chip. Tells the user the
                ephemeral cook-session layer is doing its job: swaps/skips
                are active on this cook but the saved recipe is still
                intact. Hidden when no swaps, so the overview stays clean
                for first-pass cooks. */}
            {swapCount > 0 && (
              <div
                title="Your swaps only apply to this cook. The saved recipe is unchanged."
                style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#b8a878", background:"#161310", border:"1px solid #2f2820", padding:"3px 8px", borderRadius:6, letterSpacing:"0.1em", fontWeight:600 }}
              >
                {swapCount} SWAP{swapCount === 1 ? "" : "S"} · ORIGINAL PRESERVED
              </div>
            )}
            {trackedCount > 0 && (
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color: missingIngs.length===0?"#4ade80":"#f59e0b", letterSpacing:"0.12em" }}>
                PANTRY {okCount}/{trackedCount}
              </div>
            )}
          </div>
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
            const badge = status === "ok"          ? { label:"IN KITCHEN", color:"#4ade80", bg:"#0f1a0f" }
                        : status === "low"         ? { label:"LOW",        color:"#f59e0b", bg:"#1a0f00" }
                        : status === "missing"     ? { label:"MISSING",    color:"#ef4444", bg:"#1a0a0a" }
                        : status === "wrong-state" ? { label:"WRONG FORM", color:"#7eb8d4", bg:"#0f1620" }
                        :                            null;
            const pairing = ingredientPairings[i] || null;
            const pairDescribe = describePairing(pairing);
            const pairTone = pairDescribe?.tone === "gray"  ? "#7ec87e"
                           : pairDescribe?.tone === "amber" ? "#f59e0b"
                           : pairDescribe?.tone === "red"   ? "#e8908a"
                           : "#888";
            const lostClaims = pairing?.lostClaims || [];
            // Only rows with a canonical ingredientId are tappable — everything
            // else ("to taste" salt, decorative herbs) just renders static.
            const tappable = !!ing.ingredientId;
            const swapOpen = swapOpenIdx === i;
            const swapped  = !!(session.overrides[i]?.pantryItemId || session.overrides[i]?.swapCanonicalId);
            // SWAP available on every canonical-tagged row — user
            // might want to override the default pair on an IN KITCHEN
            // row (maybe they want to use a different pack that's
            // closer to expiry) or on a WRONG FORM row (their thigh
            // for the recipe's breast). Gating it to just missing /
            // substitute was too narrow — user reported "it won't let
            // me choose any substitutions" on a screen of mostly IN
            // KITCHEN + WRONG FORM rows.
            // SHOP still only on missing — adding a row you already
            // have to the shopping list is almost always a mistake.
            const showSwap = !!ing.ingredientId;
            const showShop = status === "missing" && !!setShoppingList;
            const shopDone = !!session.overrides[i]?.promotedToShopping;
            return (
              <div
                key={i}
                style={{
                  padding:"12px 16px",
                  borderBottom: i<ingredientStatus.length-1 ? "1px solid #222" : "none",
                }}
              >
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
                  <button
                    onClick={tappable ? () => setCardIng({
                      ingredientId: ing.ingredientId,
                      fallbackName: row?.name || ing.item,
                      fallbackEmoji: row?.emoji,
                    }) : undefined}
                    disabled={!tappable}
                    style={{
                      flex: 1, minWidth: 0, textAlign:"left",
                      background:"transparent", border:"none", padding: 0,
                      cursor: tappable ? "pointer" : "default", color:"inherit",
                    }}
                  >
                    <span style={{ color:"#bbb", fontSize:14, display:"inline-flex", alignItems:"center", gap:6 }}>
                      {ing.item}
                      {tappable && <span style={{ color:"#444", fontSize:11 }}>ⓘ</span>}
                    </span>
                  </button>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, color:"#f5c842", fontWeight:500, flexShrink:0 }}>{applyPreferredUnit(ing.amount, ing, DISPLAY_CONTEXT.COOK) || ing.amount}</span>
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
                    {status === "wrong-state" && candidates && candidates.length > 0 && (
                      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#7eb8d4", fontStyle:"italic" }}>
                        Have {candidates[0].amount} {candidates[0].state || "(other form)"} — convert in Pantry to make {ing.state}
                      </span>
                    )}
                  </div>
                )}
                {pairDescribe && (
                  <div style={{
                    marginTop:6,
                    fontFamily:"'DM Sans',sans-serif", fontSize:11, fontStyle:"italic",
                    color: pairTone, lineHeight:1.4,
                  }}>
                    {pairDescribe.text}
                    {lostClaims.length > 0 && (
                      <>
                        {" — "}
                        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, fontStyle:"normal", letterSpacing:"0.04em" }}>
                          ⚠ NO LONGER {lostClaims.map(c => c.toUpperCase()).join(" / ")}
                        </span>
                      </>
                    )}
                  </div>
                )}
                {(showSwap || showShop) && (
                  <div style={{ marginTop:8, display:"flex", gap:6 }}>
                    {showSwap && (
                      <button
                        onClick={() => swapOpen ? openSwapPicker(null) : openSwapPicker(i)}
                        style={swapOpen ? cookSwapBtnActive : cookSwapBtn}
                      >
                        ⇌ SWAP
                      </button>
                    )}
                    {showShop && (
                      <button
                        onClick={() => addOneToShoppingList(ing, row, i)}
                        disabled={shopDone}
                        style={shopDone ? cookShopBtnDone : cookShopBtn}
                      >
                        {shopDone ? "✓ ON LIST" : "+ SHOP"}
                      </button>
                    )}
                  </div>
                )}
                {swapOpen && (() => {
                  const q = swapSearch.trim();
                  const { pantry: rankedPantry, library: rankedLibrary } =
                    rankSwapCandidates(ing, swapSearch);
                  // Pantry: keep the legacy "top 3 > 0 without query"
                  // pattern so the picker doesn't spam unrelated rows
                  // when the user hasn't typed yet.
                  const shownPantry = q
                    ? rankedPantry.slice(0, 8).map(r => r.row)
                    : rankedPantry.filter(r => r.score > 0).slice(0, 3).map(r => r.row);
                  // Library: broader on open (top 6) because the whole
                  // point is "what else could I reasonably use?" — the
                  // curated substitutions + hub siblings stack stays
                  // small per ingredient, so we can afford to show more
                  // of it. Typing narrows via the in-function filter.
                  const shownLibrary = q
                    ? rankedLibrary.slice(0, 8)
                    : rankedLibrary.slice(0, 6);
                  const hasAny = shownPantry.length > 0 || shownLibrary.length > 0;
                  return (
                    <div style={{
                      marginTop:10, paddingTop:10,
                      borderTop:"1px dashed #2a2a2a",
                      display:"flex", flexDirection:"column", gap:6,
                    }}>
                      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#888", letterSpacing:"0.08em" }}>
                        SWAP {String(ing.item).toUpperCase()} FOR:
                      </div>
                      <input
                        type="text"
                        value={swapSearch}
                        onChange={e => setSwapSearch(e.target.value)}
                        placeholder="Search pantry or library…"
                        style={cookSwapSearchInput}
                        autoFocus
                      />
                      {!hasAny && (
                        <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#666", fontStyle:"italic" }}>
                          {q ? "Nothing matches that search." : "No close matches — try typing to search."}
                        </div>
                      )}
                      {shownPantry.length > 0 && (
                        <>
                          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#a3d977", letterSpacing:"0.08em", marginTop:2 }}>
                            FROM YOUR PANTRY
                          </div>
                          {shownPantry.map(c => (
                            <button
                              key={`pantry-${c.id}`}
                              onClick={() => { applySwap(i, c.id); openSwapPicker(null); }}
                              style={cookSwapOptionBtn}
                            >
                              <span style={{ fontSize:16 }}>{c.emoji || "🥫"}</span>
                              <span style={{ flex:1, textAlign:"left", fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#f0ece4" }}>
                                {c.name}
                              </span>
                              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#888" }}>
                                {c.amount}{c.unit ? ` ${c.unit}` : ""}
                              </span>
                            </button>
                          ))}
                        </>
                      )}
                      {shownLibrary.length > 0 && (
                        <>
                          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#d9b877", letterSpacing:"0.08em", marginTop:6 }}>
                            OR TRY — NOT IN PANTRY
                          </div>
                          {shownLibrary.map(({ canonical, note }) => (
                            <button
                              key={`library-${canonical.id}`}
                              onClick={() => { applyLibrarySwap(i, canonical); openSwapPicker(null); }}
                              style={cookSwapOptionBtn}
                              title={note || undefined}
                            >
                              <span style={{ fontSize:16, opacity:0.85 }}>{canonical.emoji || "🥫"}</span>
                              <span style={{ flex:1, textAlign:"left", fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#e8dfc8" }}>
                                {canonical.name}
                                {note && (
                                  <span style={{ display:"block", fontFamily:"'DM Sans',sans-serif", fontSize:10, color:"#777", fontStyle:"italic", marginTop:1, lineHeight:1.3 }}>
                                    {note}
                                  </span>
                                )}
                              </span>
                              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#666", letterSpacing:"0.06em" }}>
                                LIBRARY
                              </span>
                            </button>
                          ))}
                        </>
                      )}
                      {swapped && (
                        <button onClick={() => { clearSwap(i); openSwapPicker(null); }} style={cookSwapClearBtn}>
                          ↺ REVERT TO ORIGINAL ({ing.item})
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* TOOLS — equipment the recipe needs. Surfaces what the
            AI (or bundled recipe author) specified so the user can
            do a mise-en-place scan before starting: "do I have a
            12\" cast iron? a microplane? a fine-mesh strainer?".
            Was previously emitted into the persisted recipe but
            never rendered. Hidden when the recipe carries no
            tools (older drafts, bundled recipes that omitted it). */}
        {Array.isArray(recipe.tools) && recipe.tools.length > 0 && (
          <div style={{ marginTop:24 }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#666", letterSpacing:"0.12em", marginBottom:10 }}>
              TOOLS
            </div>
            <div style={{ background:"#161616", border:"1px solid #2a2a2a", borderRadius:12, padding:"10px 14px" }}>
              <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:6 }}>
                {recipe.tools.map((t, i) => (
                  <li
                    key={i}
                    style={{
                      fontFamily:"'DM Sans',sans-serif", fontSize:13,
                      color:"#bbb", display:"flex", alignItems:"center", gap:8,
                    }}
                  >
                    <span style={{ color:"#555", fontSize:10 }}>▸</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
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
      {/* Top bar: minimize back to the app while the cook stays live.
          The banner picks it up the moment CookMode closes — useful
          when a timer is ticking and the user wants to check pantry /
          message family / whatever, without ending the session.
          Session endures 2h; explicit end is still via DONE LOG IT. */}
      {onExit && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:4, gap:8 }}>
          <button
            onClick={onExit}
            title="Step out — timer keeps running"
            aria-label="Minimize cook view"
            style={{
              display:"inline-flex", alignItems:"center", gap:8,
              background:"#1a1a1a", border:"1px solid #2a2a2a", color:"#bbb",
              borderRadius:20, padding:"8px 14px",
              fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.14em",
              cursor:"pointer",
            }}
          >
            <span style={{ fontSize:14, lineHeight:1 }}>↓</span>
            MINIMIZE
          </button>
          {/* EXIT — available at any point in the cook. First tap arms
              a confirm so an accidental thumb can't drop a braise the
              cook has been tending for 45 minutes. Second tap tears
              down the cook_sessions row (status='abandoned') and
              closes CookMode. Timer pushes for the session are purged
              inside telemetry.endCook so stale notifications don't
              fire after the cook is gone. */}
          {confirmExit ? (
            <span style={{ display:"flex", alignItems:"center", gap:6 }}>
              <button
                onClick={() => setConfirmExit(false)}
                style={{
                  background:"#1a1a1a", border:"1px solid #2a2a2a", color:"#888",
                  borderRadius:20, padding:"8px 12px",
                  fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.12em",
                  cursor:"pointer",
                }}
              >
                KEEP COOKING
              </button>
              <button
                onClick={exitCook}
                style={{
                  background:"#2a0a0a", border:"1px solid #5a1a1a", color:"#f87171",
                  borderRadius:20, padding:"8px 12px",
                  fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:600, letterSpacing:"0.12em",
                  cursor:"pointer",
                }}
              >
                END COOK
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmExit(true)}
              title="End cook and drop this recipe"
              aria-label="Exit cook"
              style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:"#dc2626", border:"1px solid #ef4444", color:"#fff",
                borderRadius:20, padding:"10px 18px",
                fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700, letterSpacing:"0.12em",
                cursor:"pointer",
                boxShadow:"0 0 20px rgba(220,38,38,0.4)",
              }}
            >
              ✕ EXIT
            </button>
          )}
        </div>
      )}
      <div style={{ height:3, background:"#222", borderRadius:2, marginTop:16, overflow:"hidden" }}>
        <div style={{ height:"100%", background:"#f5c842", borderRadius:2, width:`${progress}%`, transition:"width 0.5s ease" }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:8 }}>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>STEP {activeStep+1} OF {steps.length}</span>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>{completedSteps.size} DONE</span>
      </div>

      {/* Push-enable prompt — only renders when:
          - this device CAN do push (supported flag from useWebPush)
          - user hasn't already subscribed
          - user hasn't explicitly denied (respect the blacklist)
          - this step has a timer (otherwise the value-add is unclear;
            no timer step = no push benefit, no reason to nag)

          The copy emphasizes the lock-screen case because that's the
          pain point: an in-app countdown can't wake a locked phone,
          a push can. One tap calls webPush.enable() which handles
          permission prompt, SW register, and push_subscriptions
          upsert in one go. */}
      {webPush.supported && !webPush.enabled && webPush.permission !== "denied" && Number.isFinite(step?.timer) && step.timer > 0 && (
        <div style={{
          marginTop: 16,
          padding: "14px 16px",
          background: "linear-gradient(180deg,#1e1408 0%,#170d05 100%)",
          border: "1px solid #3a2a0a",
          borderRadius: 12,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>🔔</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:700,
              color:"#f5c842", letterSpacing:"0.14em", marginBottom:3,
            }}>
              RING ME ON THE LOCK SCREEN
            </div>
            <div style={{
              fontFamily:"'DM Sans',sans-serif", fontSize:12,
              color:"#bbb", lineHeight:1.4,
            }}>
              Timers only reach your phone when it's locked if notifications are enabled.
            </div>
          </div>
          <button
            onClick={() => { primeCookAudio(); webPush.enable(); }}
            disabled={webPush.busy}
            style={{
              flexShrink: 0,
              padding: "10px 14px",
              background: "#f5c842", color: "#111",
              border: "none", borderRadius: 10,
              fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:700,
              letterSpacing:"0.08em", cursor: webPush.busy ? "not-allowed" : "pointer",
              opacity: webPush.busy ? 0.5 : 1,
            }}
          >
            {webPush.busy ? "…" : "ENABLE"}
          </button>
        </div>
      )}
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

      {/* FOR THIS STEP — ingredient measurements the cook needs RIGHT NOW.
          When a step carries a structured `uses` array, render just those
          rows with amount+item. When it doesn't (legacy bundled recipes
          pre-retrofit, or AI drafts from an older prompt), fall back to
          the full recipe.ingredients list so measurements are always
          one glance away during cooking. The `heat` and `doneCue`
          fields, when present, render alongside — "medium heat" and
          "nutty smell, sand-colored paste" are the signals that
          actually drive the cook. */}
      {(() => {
        // Pull the ingredient list for THIS step from the effective recipe
        // so any swap/skip the user made on the overview lands here too.
        // effectiveRecipe.steps[i].uses has been projected through
        // applyCookSessionToRecipe; entries that matched a swapped slot
        // carry `_swappedFrom`, skipped ones carry `_skipped: true`.
        // Fallback to effectiveRecipe.ingredients (same overrides applied)
        // for older recipes without a structured uses[] array.
        const usesList = Array.isArray(step.uses) && step.uses.length > 0
          ? step.uses
          : (effectiveRecipe.ingredients || []);
        if (!usesList.length && !step.heat && !step.doneCue) return null;
        const isFallback = !(Array.isArray(step.uses) && step.uses.length > 0);
        return (
          <div style={{ marginTop:16, padding:"14px 16px", background:"#14110a", border:"1px solid #2f2818", borderRadius:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#f5c842", letterSpacing:"0.12em", flex:1 }}>
                {isFallback ? "INGREDIENTS" : "FOR THIS STEP"}
              </div>
              {step.heat && (
                <span style={{
                  fontFamily:"'DM Mono',monospace", fontSize:9, fontWeight:700,
                  letterSpacing:"0.08em",
                  color:"#ef8a3a", background:"#2a1608",
                  border:"1px solid #3a2010",
                  padding:"2px 7px", borderRadius:6,
                }}>
                  🔥 {String(step.heat).toUpperCase()} HEAT
                </span>
              )}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              {usesList.map((ing, i) => {
                const swappedFrom = ing._swappedFrom?.item || null;
                const isSkipped   = !!ing._skipped;
                const overrideKey = prefKeyForIngredient(ing);
                const overrideAmount = overrideKey ? unitOverrides[overrideKey] : null;
                // Session override wins (one-off pick); fall back to
                // the user's saved preference via applyPreferredUnit.
                const preferred = overrideAmount || applyPreferredUnit(ing.amount, ing, DISPLAY_CONTEXT.COOK);
                const displayAmount = preferred || ing.amount || "—";
                // Lift the matched pantry row's branded display name
                // (Brand + canonical) so the FOR-THIS-STEP list reads
                // like the prep preview did instead of falling back to
                // the recipe's generic "butter" / "flour" text. AIRecipe
                // already does this via the pairings array; CookMode
                // computed pairings at render time but never threaded
                // them into this list — that's the visible disparity
                // between prep ("Sweet Cream Unsalted Butter") and cook
                // ("butter"). Falls back to the recipe text when no
                // pantry pair exists (missing ingredient, unmatched
                // shop item, etc).
                const pairing = isSkipped ? null : findPairing(ing);
                const matchedRow = pairing?.paired || pairing?.closestMatch || null;
                const matchedName = matchedRow ? deriveRowHeader(matchedRow) : "";
                const displayName = matchedName || ing.item || ing.ingredientId || "ingredient";
                return (
                  <div key={i} style={{ display:"flex", gap:10, fontFamily:"'DM Sans',sans-serif", fontSize:14, color: isSkipped ? "#8a7a5a" : "#e8dfc8", lineHeight:1.5, opacity: isSkipped ? 0.7 : 1 }}>
                    <button
                      type="button"
                      onClick={() => !isSkipped && overrideKey && setUnitPicker({
                        key: overrideKey,
                        ingredientId: ing.ingredientId,
                        itemName: ing.item,
                        amountString: String(displayAmount),
                      })}
                      disabled={isSkipped}
                      style={{
                        fontFamily:"'DM Mono',monospace", fontSize:12, color:"#b8a878",
                        minWidth:68, flexShrink:0, textAlign:"left",
                        display:"inline-flex", alignItems:"center", gap:4,
                        background:"#1a1508", border:"1px solid #3a2f10",
                        borderRadius:6, padding:"3px 8px",
                        cursor: isSkipped ? "default" : "pointer",
                        textDecoration: isSkipped ? "line-through" : "none",
                        opacity: isSkipped ? 0.6 : 1,
                      }}
                    >
                      <span>{displayAmount}</span>
                      {!isSkipped && <span style={{ fontSize:8, opacity:0.7 }}>▾</span>}
                    </button>
                    <span style={{ flex:1 }}>
                      <span style={{ textDecoration: isSkipped ? "line-through" : "none" }}>
                        {displayName}
                      </span>
                      {ing.state ? <span style={{ color:"#c7a8d4", fontSize:12 }}> · {ing.state}</span> : null}
                      {isSkipped && (
                        <span style={{ marginLeft:8, fontFamily:"'DM Mono',monospace", fontSize:9, fontWeight:700, letterSpacing:"0.08em", color:"#a8553a", background:"#2a1208", border:"1px solid #3a2010", padding:"2px 6px", borderRadius:6 }}>
                          SKIPPED
                        </span>
                      )}
                      {!isSkipped && swappedFrom && (
                        <span style={{ marginLeft:8, fontFamily:"'DM Mono',monospace", fontSize:10, color:"#7a7060", fontStyle:"italic" }}>
                          ↔ was: {swappedFrom}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {step.doneCue && (
              <div style={{ marginTop:10, padding:"8px 10px", background:"#0f180f", border:"1px solid #1a2e1a", borderRadius:8, display:"flex", gap:8 }}>
                <span style={{ fontSize:12, flexShrink:0 }}>✓</span>
                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#9ec29e", lineHeight:1.45, fontStyle:"italic" }}>
                  Ready when: {step.doneCue}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Per-step swap banner + inline prose rewrite.
          Why the swap list comes from recipeSwapSummary, not
          stepSwapSummary: step.uses is a CURATED subset of the
          recipe — "FOR THIS STEP" — and bundled recipes routinely
          omit ingredients the prose mentions (e.g. uses lists
          butter/salt/pepper but the instruction reads "Add the
          milk, pesto, and capers"). A step-scoped swap summary
          would miss swaps on those prose-only mentions. Filtering
          through relevantSwapsForStep keeps banner noise low —
          only swaps that actually appear in this step's prose or
          uses surface. The prose below is tokenized with the same
          filtered list: word-boundary regex, deterministic, no AI
          call. The banner is the backstop for cases regex can't
          reach (plural / possessive forms the simple word-boundary
          match misses). */}
      {(() => {
        const stepSwaps = relevantSwapsForStep(step, allSwaps);
        if (stepSwaps.length === 0) return null;
        return (
          <div style={{ marginTop:12, padding:"10px 14px", background:"#161310", border:"1px solid #2f2820", borderRadius:10, display:"flex", gap:10, alignItems:"flex-start" }}>
            <span style={{ fontSize:14, flexShrink:0, color:"#b8a878" }}>↔</span>
            <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#b8a878", lineHeight:1.5 }}>
              {stepSwaps.map((s, i) => (
                <div key={i}>
                  {s.skipped
                    ? <>Skipping <strong>{s.from}</strong> for this step.</>
                    : <>Using <strong>{s.to}</strong> instead of <strong>{s.from}</strong> for this step.</>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div style={{ marginTop:20, padding:"20px", background:"#141414", border:"1px solid #252525", borderRadius:14 }}>
        <p style={{ fontSize:16, lineHeight:1.6, color:"#ddd", fontWeight:300 }}>
          {(() => {
            // Unified tokenizer — handles both same-canonical brand
            // upgrades (plain tan rewrite, no strikethrough) and
            // different-canonical substitutes (strike + replacement).
            // Brand upgrades surface MY ingredient's branded name
            // inline in the recipe prose — "Kerrygold Butter" renders
            // wherever "butter" was, colored tan so the provenance
            // reads at a glance. Grammar caveat: word-boundary regex
            // dodges "buttered" naturally but "butter the dish"
            // becomes "Kerrygold Butter the dish" — slightly awkward,
            // worth the tradeoff to carry branded names throughout.
            const tokens = tokenizeSwappedInstruction(step.instruction, allSwaps, allBrandUpgrades, allAmountReplacements);
            if (tokens.length === 1 && tokens[0].text === step.instruction) {
              return step.instruction;
            }
            return tokens.map((t, i) => {
              if (t.text != null) return <span key={i}>{t.text}</span>;
              if (t.brand != null) {
                return <span key={i} style={{ color:"#b8a878", fontWeight:500 }}>{t.brand}</span>;
              }
              // Strike + replacement pair. `after: null` means skipped —
              // render just the strikethrough so the cook knows that
              // ingredient is out, with nothing in its place.
              return (
                <span key={i}>
                  <s style={{ opacity:0.5, color:"#8a7a5a" }}>{t.strike}</s>
                  {t.after ? <span style={{ color:"#b8a878" }}> {t.after}</span> : null}
                </span>
              );
            });
          })()}
        </p>
        {step.timer && (
          <Timer
            key={`${activeStep}-${step.id}`}
            seconds={step.timer}
            // Only honor the resume deadline on the step that matched
            // the active session when CookMode re-mounted. Moving
            // forward / back clears it so fresh starts don't read a
            // stale wall-clock from an unrelated step.
            endsAt={activeStep === initialStepIndex ? initialTimerEndsAt : null}
            onDone={() => {
              // Ring the bell. Server-side push already queued at
              // step-start (see useCookTelemetry.startStep) handles
              // the "app is closed" case; this handles "app is open
              // but user wandered off / backgrounded the tab."
              playTimerChime();
              if (typeof document !== "undefined" && document.hidden &&
                  typeof Notification !== "undefined" && Notification.permission === "granted") {
                try {
                  new Notification(`${recipe.emoji || "⏲️"} Timer's up`, {
                    body: step.title ? `Step ${activeStep + 1}: ${step.title}` : "Step timer ended",
                    tag: `cook-timer-${telemetry.session?.id || "local"}-${step.id}`,
                    icon: "/icon-192.png",
                    badge: "/icon-badge-72.png",
                  });
                } catch { /* some contexts forbid Notification constructor */ }
              }
            }}
          />
        )}
      </div>
      {step.tip && (
        <div style={{ marginTop:12, padding:"14px 16px", background:"#0f1a0f", border:"1px solid #1e3a1e", borderRadius:10, display:"flex", gap:10 }}>
          <span style={{ fontSize:14, flexShrink:0 }}>💡</span>
          <p style={{ fontSize:13, color:"#7ec87e", lineHeight:1.5, fontStyle:"italic" }}>{step.tip}</p>
        </div>
      )}
      <div style={{ display:"flex", gap:12, marginTop:24 }}>
        <button onClick={()=>setActiveStep(s=>Math.max(0,s-1))} disabled={activeStep===0} style={{ flex:1, padding:"14px", background:"#1a1a1a", border:"1px solid #2a2a2a", color: activeStep===0?"#444":"#bbb", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, cursor: activeStep===0?"not-allowed":"pointer" }}>← PREV</button>
        {activeStep < steps.length-1 ? (
          <button onClick={markDone} style={{ flex:2, padding:"14px", background: completedSteps.has(activeStep)?"#1a3a1a":"#f5c842", color: completedSteps.has(activeStep)?"#4ade80":"#111", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.3s" }}>
            {completedSteps.has(activeStep)?"✓ DONE → NEXT":"DONE → NEXT"}
          </button>
        ) : (
          <button onClick={() => {
            // Capture the session id synchronously before endCook sets
            // session → null, so CookComplete can stamp cook_log_id
            // onto it after the cook_log insert lands.
            const sid = telemetry.session?.id || null;
            finalizedRef.current = true;
            telemetry.finishStep({});
            telemetry.endCook({ status: "finished" });
            setCompletingSessionId(sid);
            setCompleting(true);
          }} className="mise-cta" style={{ flex:2, padding:"14px", background:"#22c55e", color:"#111", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, cursor:"pointer" }}>
            🍝 DONE! LOG IT →
          </button>
        )}
      </div>

      {/* styles for the cook-prep per-row swap / shop affordances —
          declared inline at module scope at the bottom so the styles
          object isn't re-allocated on every render. */}
      {completing && (
        <CookComplete
          recipe={recipe}
          userId={userId}
          family={family}
          friends={friends}
          pantry={pantry}
          setPantry={setPantry}
          // Shared cook-time session state (see useCookSession). Lets
          // CookComplete seed its selected pantry row from the user's
          // cook-prep swaps — "swap Mozzarella for Parmesan" on this
          // screen now carries through to the "What did you use?"
          // screen so the deduction hits the row they actually used.
          cookSession={cookSession}
          // Telemetry session id — CookComplete stamps cook_log_id
          // onto this row after the cook_log insert so cook_duration_stats
          // joins cleanly. Null when telemetry couldn't start (e.g.
          // missing userId).
          telemetrySessionId={completingSessionId}
          // Threaded so CookComplete can call recipeNutrition() at
          // save time to stamp cook_logs.nutrition (migration 0068).
          // CookMode already reads both for its own meta-row card; no
          // new hook calls on this path.
          ingredientInfo={ingredientInfo}
          brandNutrition={brandNutrition}
          // Fork-to-new-recipe handler. When present AND the cook had
          // active swaps/skips, CookComplete's celebrate phase shows
          // "SAVE CHANGES AS NEW RECIPE". Null → action is hidden.
          onForkRecipe={onForkRecipe}
          onFinish={() => {
            setCompleting(false);
            onDone?.();
          }}
        />
      )}
      {unitPicker && (
        <UnitPicker
          open={true}
          onClose={() => setUnitPicker(null)}
          amountString={unitPicker.amountString}
          ingredientId={unitPicker.ingredientId}
          itemName={unitPicker.itemName}
          prefKey={unitPicker.key}
          context={DISPLAY_CONTEXT.COOK}
          onPick={(newAmount) => {
            setUnitOverrides(prev => ({
              ...prev,
              [unitPicker.key]: newAmount,
            }));
          }}
        />
      )}
    </div>
  );
}

// ── cook-prep row action styles ──────────────────────────────────────
// SWAP / + SHOP pills per ingredient on the cook prep screen. Visual
// language mirrors AIRecipe's tweak phase (same blue SWAP, same
// yellow SHOP) so the user learns one vocabulary across both screens.
const cookSwapBtn = {
  padding: "5px 10px",
  background: "#0f1620", border: "1px solid #1f3040",
  color: "#7eb8d4", borderRadius: 8,
  fontFamily: "'DM Mono',monospace", fontSize: 9,
  letterSpacing: "0.06em", cursor: "pointer", whiteSpace: "nowrap",
};
const cookSwapBtnActive = { ...cookSwapBtn, background: "#1a2430", color: "#9bcae0" };
const cookShopBtn = {
  padding: "5px 10px",
  background: "#1a1608", border: "1px solid #3a2f10",
  color: "#f5c842", borderRadius: 8,
  fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700,
  letterSpacing: "0.08em", cursor: "pointer", whiteSpace: "nowrap",
};
const cookShopBtnDone = { ...cookShopBtn, background: "#0f1a0f", borderColor: "#22c55e44", color: "#4ade80", cursor: "default" };
const cookSwapSearchInput = {
  width: "100%", padding: "8px 10px",
  background: "#0a0a0a", border: "1px solid #2a2a2a",
  borderRadius: 8, color: "#f0ece4",
  fontFamily: "'DM Sans',sans-serif", fontSize: 12,
  outline: "none", boxSizing: "border-box",
};
const cookSwapOptionBtn = {
  display: "flex", alignItems: "center", gap: 10,
  padding: "8px 10px", width: "100%",
  background: "#141414", border: "1px solid #242424",
  borderRadius: 8, cursor: "pointer", textAlign: "left",
};
const cookSwapClearBtn = {
  marginTop: 4, padding: "6px 10px",
  background: "transparent", border: "1px dashed #3a3a3a",
  color: "#888", borderRadius: 8,
  fontFamily: "'DM Mono',monospace", fontSize: 10,
  letterSpacing: "0.06em", cursor: "pointer",
};

