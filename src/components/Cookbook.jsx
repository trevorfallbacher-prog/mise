import { useEffect, useMemo, useState } from "react";
import { useCookLog, useDinerLog, useCookLogReviews } from "../lib/useCookLog";
import { findRecipe } from "../data/recipes";

// Mapping the DB's rating column onto the visual language used throughout
// the app. Kept local so Cookbook stays self-contained — if we ever want a
// different set of faces we change it here.
const RATING_META = {
  nailed: { emoji: "🤩", label: "Nailed it",   color: "#f5c842", bg: "#1a1608", border: "#3a2f10" },
  good:   { emoji: "😊", label: "Pretty good", color: "#4ade80", bg: "#0f1a0f", border: "#1e3a1e" },
  meh:    { emoji: "😐", label: "Meh",         color: "#888",    bg: "#161616", border: "#2a2a2a" },
  rough:  { emoji: "😬", label: "Rough one",   color: "#ef4444", bg: "#1a0a0a", border: "#3a1a1a" },
};
const ratingMeta = (r) => RATING_META[r] || RATING_META.meh;

// Filter chips — "All" plus favorites plus each rating bucket. Counts update
// live as logs come in. Hiding chips with zero rows would look nicer but
// removes a visual cue for "you don't have any of these yet" — so we keep
// every chip visible and gray out the empties.
const FILTERS = [
  { id: "all",       label: "All"            },
  { id: "favorites", label: "★ Favorites"    },
  { id: "nailed",    label: "🤩 Nailed"      },
  { id: "good",      label: "😊 Good"        },
  { id: "meh",       label: "😐 Meh"         },
  { id: "rough",     label: "😬 Rough"       },
];

// Short, humane "when" string. We could pull in date-fns but this is enough
// for the cookbook list — most cooks happen in the recent past.
function relativeDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = (now - d) / 1000; // seconds
  if (diff < 60)        return "just now";
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  // "Apr 12" style for anything older than a week; include year if not this year.
  const opts = d.getFullYear() === now.getFullYear()
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

// ── Review composer (diners only) ───────────────────────────────────────────
// Inline editor a diner sees on a cook they attended. Upserts into
// cook_log_reviews so editing just bumps the existing row. The chef
// doesn't see this composer (they see other diners' reviews below).
function ReviewComposer({ myReview, upsertMyReview, deleteMyReview }) {
  const [rating, setRating] = useState(myReview?.rating || null);
  const [notes,  setNotes]  = useState(myReview?.notes  || "");
  const [busy,   setBusy]   = useState(false);
  const [savedTick, setSavedTick] = useState(0); // bump to show "saved ✓" briefly

  // When the remote review updates (e.g. realtime reflection of our own
  // upsert, or an edit on another device), sync local state so the form
  // doesn't lie about what's actually saved. Keying the effect on the
  // review id + timestamp means we re-hydrate only on a real change —
  // typing into the textarea won't re-hydrate itself.
  const reviewId = myReview?.id;
  const reviewUpdatedAt = myReview?.updatedAt;
  // myReview is stable as long as reviewId + reviewUpdatedAt don't change;
  // depending on those two scalars keeps the effect from re-firing on
  // every parent render while still syncing on real edits. The project's
  // eslint config doesn't load react-hooks/exhaustive-deps, so we don't
  // need a disable pragma here — just keep the deps array honest-ish.
  useEffect(() => {
    if (myReview) {
      setRating(myReview.rating);
      setNotes(myReview.notes);
    }
  }, [reviewId, reviewUpdatedAt, myReview]);

  const canSave = !!rating && !busy;
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    await upsertMyReview({ rating, notes });
    setBusy(false);
    setSavedTick(Date.now());
    setTimeout(() => setSavedTick(0), 2200);
  };

  return (
    <div style={{ padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.12em", marginBottom:12 }}>
        {myReview ? "YOUR REVIEW" : "LEAVE A REVIEW"}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
        {["rough","meh","good","nailed"].map(r => {
          const m = ratingMeta(r);
          const active = rating === r;
          return (
            <button
              key={r}
              onClick={() => setRating(r)}
              title={m.label}
              style={{
                flex:1, minWidth:62, padding:"10px 4px",
                background: active ? m.bg : "#0f0f0f",
                border: `1px solid ${active ? m.color : "#2a2a2a"}`,
                borderRadius:12, cursor:"pointer",
                display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                transition:"all 0.15s",
              }}
            >
              <span style={{ fontSize:24 }}>{m.emoji}</span>
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color: active ? m.color : "#666", letterSpacing:"0.08em" }}>
                {m.label.toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Any notes? Texture, seasoning, what you'd change…"
        rows={3}
        style={{ width:"100%", padding:"10px 12px", background:"#0f0f0f", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#ccc", outline:"none", resize:"vertical", boxSizing:"border-box", marginBottom:10 }}
      />
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <button
          onClick={save}
          disabled={!canSave}
          style={{ flex:1, padding:"12px", background: canSave ? "#f5c842" : "#1a1a1a", color: canSave ? "#111" : "#555", border:"none", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600, letterSpacing:"0.08em", cursor: canSave ? "pointer" : "not-allowed" }}
        >
          {busy ? "SAVING…" : myReview ? "UPDATE REVIEW" : "POST REVIEW →"}
        </button>
        {myReview && (
          <button
            onClick={() => deleteMyReview()}
            title="Remove my review"
            style={{ padding:"12px 14px", background:"transparent", color:"#555", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em" }}
          >
            REMOVE
          </button>
        )}
      </div>
      {savedTick > 0 && (
        <div style={{ marginTop:10, fontFamily:"'DM Mono',monospace", fontSize:10, color:"#4ade80", letterSpacing:"0.08em" }}>
          ✓ SAVED — the chef just got pinged
        </div>
      )}
    </div>
  );
}

// ── Review list (read-only) ─────────────────────────────────────────────────
// Shown to the chef (all diner reviews) and to other diners (everyone
// else's reviews). The current viewer's own review is suppressed here
// because the composer above already represents it.
function ReviewList({ reviews, excludeReviewerId, nameFor }) {
  const shown = reviews.filter(r => r.reviewerId !== excludeReviewerId);
  if (shown.length === 0) return null;
  return (
    <div style={{ padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.12em", marginBottom:12 }}>
        {shown.length === 1 ? "1 REVIEW" : `${shown.length} REVIEWS`}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {shown.map(r => {
          const m = ratingMeta(r.rating);
          return (
            <div key={r.id} style={{ padding:"12px", background:"#0f0f0f", border:`1px solid ${m.border}`, borderRadius:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: r.notes ? 8 : 0 }}>
                <span style={{ fontSize:24, flexShrink:0 }}>{m.emoji}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#f0ece4" }}>
                    {nameFor ? nameFor(r.reviewerId) : "Someone"}
                  </div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:m.color, letterSpacing:"0.1em" }}>
                    {m.label.toUpperCase()} · {relativeDate(r.createdAt)}
                  </div>
                </div>
              </div>
              {r.notes && (
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#bbb", lineHeight:1.6, margin:0, whiteSpace:"pre-wrap" }}>
                  "{r.notes}"
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail screen ────────────────────────────────────────────────────────────
// Tapping a cookbook card pushes here. Shows the full memory of the cook —
// rating, notes, diners, XP — plus a "Cook it again" CTA that eventually
// will route back into CookMode pre-loaded.
//
// Chef vs diner view:
//   * Chef (viewer is log.userId): can delete, toggle favorite, see all
//     diner reviews. No composer (they already own the "rating" on the log).
//   * Diner (viewer is in log.diners): sees a composer to add/edit their
//     own review + everyone else's reviews.
function CookLogDetail({ log, viewerId, onBack, onToggleFavorite, onDelete, nameFor }) {
  const meta = ratingMeta(log.rating);
  const recipe = findRecipe(log.recipeSlug);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isChef = viewerId === log.userId;
  const { reviews, myReview, upsertMyReview, deleteMyReview } = useCookLogReviews(log.id, viewerId);
  return (
    <div style={{ minHeight:"100vh", paddingBottom:100 }}>
      <div style={{ padding:"20px 20px 0", display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#555", fontSize:20, cursor:"pointer" }}>←</button>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em", flex:1 }}>
          {isChef ? "YOUR COOKBOOK" : "MEALS YOU ATE"}
        </div>
        {/* Favorite only makes sense on rows you own — your own
            cookbook is the one you curate. Diners can still "save a
            recipe" into their own cookbook later (chunk 4). */}
        {isChef && (
          <button
            onClick={() => onToggleFavorite(log.id)}
            title={log.isFavorite ? "Unfavorite" : "Favorite"}
            style={{ background:"none", border:"none", color: log.isFavorite ? "#f5c842" : "#444", fontSize:20, cursor:"pointer" }}
          >
            {log.isFavorite ? "★" : "☆"}
          </button>
        )}
      </div>

      <div style={{ padding:"24px 20px 0", textAlign:"center" }}>
        <div style={{ fontSize:64, marginBottom:12 }}>{log.recipeEmoji}</div>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:300, fontStyle:"italic", color:"#f0ece4", letterSpacing:"-0.02em", marginBottom:6 }}>{log.recipeTitle}</h1>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#555", letterSpacing:"0.1em" }}>
          {(log.recipeCuisine || "").toUpperCase()}
          {log.recipeCategory ? ` · ${log.recipeCategory.toUpperCase()}` : ""}
          {` · ${relativeDate(log.cookedAt)}`}
        </div>
        {!isChef && (
          <div style={{ marginTop:8, fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#888" }}>
            Cooked by <span style={{ color:"#f0ece4" }}>{nameFor ? nameFor(log.userId) : "a friend"}</span>
          </div>
        )}
      </div>

      {/* Rating headline card */}
      <div style={{ margin:"22px 20px 0", padding:"18px 20px", background:meta.bg, border:`1px solid ${meta.border}`, borderRadius:16, display:"flex", alignItems:"center", gap:14 }}>
        <span style={{ fontSize:40 }}>{meta.emoji}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, color:meta.color, fontStyle:"italic" }}>{meta.label}</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", marginTop:2, letterSpacing:"0.1em" }}>+{log.xpEarned} XP · {log.diners.length > 0 ? `${log.diners.length} ${log.diners.length === 1 ? "DINER" : "DINERS"}` : "SOLO"}</div>
        </div>
      </div>

      {/* Notes */}
      <div style={{ margin:"12px 20px 0", padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.12em", marginBottom:10 }}>NOTES</div>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color: log.notes ? "#ccc" : "#555", fontStyle: log.notes ? "normal" : "italic", lineHeight:1.7, whiteSpace:"pre-wrap", margin:0 }}>
          {log.notes || "No notes on this one."}
        </p>
      </div>

      {/* Diners */}
      {log.diners.length > 0 && (
        <div style={{ margin:"12px 20px 0", padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.12em", marginBottom:10 }}>
            {isChef ? "ATE WITH YOU" : "ALSO AT THE TABLE"}
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {log.diners.map(id => (
              <span key={id} style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 12px", background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:20, fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#ccc" }}>
                👥 {nameFor ? nameFor(id) : "Someone"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Composer — diners get to leave their own review. Upserts so
          editing just updates the existing row; the chef gets pinged
          via the notify_chef_of_review trigger on save. */}
      {!isChef && (
        <div style={{ margin:"12px 20px 0" }}>
          <ReviewComposer
            myReview={myReview}
            upsertMyReview={upsertMyReview}
            deleteMyReview={deleteMyReview}
          />
        </div>
      )}

      {/* Review list — chef sees all diner reviews; diners see the
          others'. ReviewList hides the viewer's own review when
          excludeReviewerId matches (otherwise it'd duplicate the
          composer above). */}
      {reviews.length > (isChef ? 0 : 1) && (
        <div style={{ margin:"12px 20px 0" }}>
          <ReviewList
            reviews={reviews}
            excludeReviewerId={isChef ? null : viewerId}
            nameFor={nameFor}
          />
        </div>
      )}

      {/* Actions */}
      <div style={{ margin:"20px 20px 0", display:"flex", flexDirection:"column", gap:10 }}>
        {recipe && (
          <button onClick={onBack} style={{ width:"100%", padding:"14px", background:"#f5c842", color:"#111", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, cursor:"pointer", letterSpacing:"0.08em" }}>
            {isChef ? "COOK IT AGAIN →" : "OPEN RECIPE →"}
          </button>
        )}
        {/* Only the chef can delete their own log. Diners removing their
            review is handled inside the composer. */}
        {isChef && !confirmDelete && (
          <button onClick={() => setConfirmDelete(true)} style={{ width:"100%", padding:"12px", background:"transparent", color:"#555", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em" }}>
            REMOVE FROM COOKBOOK
          </button>
        )}
        {isChef && confirmDelete && (
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => setConfirmDelete(false)} style={{ flex:1, padding:"12px", background:"#1a1a1a", color:"#888", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em" }}>
              CANCEL
            </button>
            <button onClick={() => { onDelete(log.id); onBack(); }} style={{ flex:2, padding:"12px", background:"#ef4444", color:"#fff", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", fontWeight:600 }}>
              DELETE PERMANENTLY
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main list ────────────────────────────────────────────────────────────────
//
// `deepLink`/`onConsumeDeepLink` — set by App.jsx when a notification tap
// routes to a specific cook_log. Cookbook opens that log's detail (and
// auto-switches to the right scope) the first time it sees the id, then
// calls onConsumeDeepLink so the prop doesn't re-fire on every render.
export default function Cookbook({ userId, familyKey, nameFor, deepLink, onConsumeDeepLink }) {
  // `scope` picks which stream drives the list. "cooked" = my own cooks,
  // "eaten" = cooks where I'm in the diners array. Default to cooked so
  // a new user's empty state matches their intuition.
  const [scope,  setScope]  = useState("cooked"); // "cooked" | "eaten"
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState(null);

  const cookedHook = useCookLog(userId, familyKey);
  const eatenHook  = useDinerLog(userId, familyKey);

  // Consume an inbound deep-link. We wait until the relevant stream has
  // loaded so the detail screen can actually resolve the row — otherwise
  // we'd flash an empty detail. If the id genuinely isn't found (e.g. the
  // chef deleted the log), we still consume the link so we don't get stuck
  // retrying forever, and just fall back to the list.
  useEffect(() => {
    if (!deepLink || deepLink.kind !== "cook_log") return;
    const inCooked = cookedHook.logs.some(l => l.id === deepLink.id);
    const inEaten  = eatenHook.logs.some(l => l.id === deepLink.id);
    const stillLoading = cookedHook.loading || eatenHook.loading;
    if (!inCooked && !inEaten && stillLoading) return; // give the streams a beat
    if (inCooked)       setScope("cooked");
    else if (inEaten)   setScope("eaten");
    setDetailId(deepLink.id);
    onConsumeDeepLink?.();
  }, [deepLink, cookedHook.logs, cookedHook.loading, eatenHook.logs, eatenHook.loading, onConsumeDeepLink]);

  const logs    = scope === "cooked" ? cookedHook.logs    : eatenHook.logs;
  const loading = scope === "cooked" ? cookedHook.loading : eatenHook.loading;
  const { toggleFavorite, remove } = cookedHook; // only used on chef-owned rows

  // Precompute counts per filter for the active scope.
  const counts = useMemo(() => {
    const c = { all: logs.length, favorites: 0, nailed: 0, good: 0, meh: 0, rough: 0 };
    for (const l of logs) {
      if (l.isFavorite) c.favorites++;
      c[l.rating] = (c[l.rating] || 0) + 1;
    }
    return c;
  }, [logs]);

  // On the "eaten" scope, favorites doesn't belong to the viewer — hide
  // that filter chip to avoid confusion. The chef owns the ★ on their
  // own row. (Chunk 4 will add a separate "save to my cookbook" concept
  // for diners.)
  const visibleFilters = useMemo(
    () => scope === "eaten" ? FILTERS.filter(f => f.id !== "favorites") : FILTERS,
    [scope],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter(l => {
      if (q && !l.recipeTitle.toLowerCase().includes(q) && !(l.notes || "").toLowerCase().includes(q)) return false;
      if (filter === "all")       return true;
      if (filter === "favorites") return l.isFavorite;
      return l.rating === filter;
    });
  }, [logs, filter, search]);

  // Detail mode — find the log across both streams so "back" works
  // seamlessly if the scope changes while the detail is open.
  const detailLog = useMemo(
    () => cookedHook.logs.concat(eatenHook.logs).find(l => l.id === detailId) || null,
    [cookedHook.logs, eatenHook.logs, detailId],
  );
  if (detailLog) {
    return (
      <CookLogDetail
        log={detailLog}
        viewerId={userId}
        onBack={() => setDetailId(null)}
        onToggleFavorite={toggleFavorite}
        onDelete={remove}
        nameFor={nameFor}
      />
    );
  }

  return (
    <div style={{ minHeight:"100vh", paddingBottom:100 }}>
      <div style={{ padding:"24px 20px 0" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em", marginBottom:6 }}>YOUR</div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
          <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:38, fontWeight:300, fontStyle:"italic", color:"#f0ece4", letterSpacing:"-0.03em" }}>Cookbook</h1>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:18, color:"#f5c842" }}>{logs.length}</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555" }}>
              {scope === "cooked" ? "COOKED" : "EATEN"}
            </div>
          </div>
        </div>
      </div>

      {/* Scope toggle — COOKED = meals I made, EATEN = meals I attended.
          EATEN's count comes from the separate useDinerLog stream so the
          dot appears the instant a friend logs us in as a diner. */}
      <div style={{ display:"flex", margin:"16px 20px 0", padding:4, background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:12, gap:4 }}>
        {[
          { id: "cooked", label: "COOKED", icon: "🧑‍🍳", count: cookedHook.logs.length },
          { id: "eaten",  label: "EATEN",  icon: "🍽️",  count: eatenHook.logs.length  },
        ].map(s => {
          const active = scope === s.id;
          return (
            <button
              key={s.id}
              onClick={() => { setScope(s.id); setFilter("all"); setSearch(""); }}
              style={{
                flex:1, padding:"10px", background: active ? "#1e1e1e" : "transparent",
                border:"none", borderRadius:8,
                fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:600,
                color: active ? "#f5c842" : "#666", cursor:"pointer",
                letterSpacing:"0.08em", transition:"all 0.2s",
                display:"flex", alignItems:"center", justifyContent:"center", gap:6,
              }}
            >
              <span>{s.icon}</span>
              <span>{s.label}</span>
              {s.count > 0 && (
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: active ? "#f5c84288" : "#555" }}>
                  {s.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!loading && logs.length === 0 ? (
        // Empty state — wording depends on scope.
        <div style={{ margin:"20px 20px 0", padding:"40px 24px", textAlign:"center", background:"#0f0f0f", border:"1px dashed #222", borderRadius:18 }}>
          <div style={{ fontSize:56, marginBottom:14, opacity:0.6 }}>
            {scope === "cooked" ? "📖" : "🍽️"}
          </div>
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontStyle:"italic", color:"#aaa", marginBottom:8 }}>
            {scope === "cooked" ? "Your cookbook's empty" : "No meals eaten with others yet"}
          </div>
          <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", lineHeight:1.6 }}>
            {scope === "cooked"
              ? "Every meal you finish in Cook Mode lands here — with your rating, notes, and who ate with you."
              : "When a family or friend cooks and adds you as a diner, it shows up here and you can leave a review."}
          </div>
        </div>
      ) : (
        <>
          <div style={{ margin:"20px 20px 0", position:"relative" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search your cookbook…"
              style={{ width:"100%", background:"#161616", border:"1px solid #2a2a2a", borderRadius:12, padding:"12px 16px 12px 40px", color:"#f0ece4", fontFamily:"'DM Sans',sans-serif", fontSize:14, outline:"none", boxSizing:"border-box" }}
            />
            <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:16, opacity:0.4 }}>🔍</span>
          </div>

          <div style={{ display:"flex", gap:8, padding:"14px 20px 0", overflowX:"auto", scrollbarWidth:"none" }}>
            {visibleFilters.map(f => {
              const active = filter === f.id;
              const count = counts[f.id] ?? 0;
              const empty = count === 0;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  style={{
                    flexShrink:0,
                    background: active ? "#f5c842" : "#161616",
                    border: `1px solid ${active ? "#f5c842" : "#2a2a2a"}`,
                    borderRadius:20, padding:"7px 14px", whiteSpace:"nowrap",
                    fontFamily:"'DM Sans',sans-serif", fontSize:12,
                    color: active ? "#111" : empty ? "#444" : "#aaa",
                    cursor:"pointer", transition:"all 0.2s",
                    display:"inline-flex", alignItems:"center", gap:6,
                  }}
                >
                  <span>{f.label}</span>
                  <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color: active ? "#111a" : "#666" }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:10, padding:"14px 20px 0" }}>
            {filtered.length === 0 && (
              <div style={{ padding:"30px 20px", color:"#555", fontFamily:"'DM Sans',sans-serif", fontSize:13, textAlign:"center", fontStyle:"italic" }}>
                {search.trim() ? `Nothing matches "${search}".` : "No cooks in this bucket yet."}
              </div>
            )}
            {filtered.map(log => {
              const meta = ratingMeta(log.rating);
              return (
                <button
                  key={log.id}
                  onClick={() => setDetailId(log.id)}
                  style={{ width:"100%", textAlign:"left", background:"#141414", border:`1px solid ${log.isFavorite ? "#f5c84244" : "#222"}`, borderRadius:16, padding:"16px", cursor:"pointer", position:"relative" }}
                >
                  <div style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
                    <div style={{ fontSize:36, flexShrink:0 }}>{log.recipeEmoji}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4, flexWrap:"wrap" }}>
                        <span style={{ fontFamily:"'Fraunces',serif", fontSize:17, color:"#f0ece4", fontWeight:400 }}>{log.recipeTitle}</span>
                        <span style={{ fontSize:16 }} title={meta.label}>{meta.emoji}</span>
                        {scope === "cooked" && log.isFavorite && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.08em" }}>★ FAVORITE</span>
                        )}
                        {scope === "eaten" && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#888", letterSpacing:"0.08em" }}>
                            BY {(nameFor ? nameFor(log.userId) : "SOMEONE").toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666" }}>{relativeDate(log.cookedAt)}</span>
                        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#444" }}>·</span>
                        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666" }}>+{log.xpEarned} XP</span>
                        {log.diners.length > 0 && (
                          <>
                            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#444" }}>·</span>
                            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666" }}>
                              👥 {log.diners.length}
                            </span>
                          </>
                        )}
                      </div>
                      {log.notes && (
                        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#888", fontStyle:"italic", lineHeight:1.5, marginTop:8, marginBottom:0, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                          "{log.notes}"
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
