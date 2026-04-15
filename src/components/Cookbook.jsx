import { useMemo, useState } from "react";
import { useCookLog } from "../lib/useCookLog";
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

// ── Detail screen ────────────────────────────────────────────────────────────
// Tapping a cookbook card pushes here. Shows the full memory of the cook —
// rating, notes, diners, XP — plus a "Cook it again" CTA that eventually
// will route back into CookMode pre-loaded. For chunk 2 the CTA just closes
// the detail; hooking it up is a one-liner once the parent knows how to
// deep-link into Cook.
function CookLogDetail({ log, onBack, onToggleFavorite, onDelete, nameFor }) {
  const meta = ratingMeta(log.rating);
  const recipe = findRecipe(log.recipeSlug);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div style={{ minHeight:"100vh", paddingBottom:100 }}>
      <div style={{ padding:"20px 20px 0", display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#555", fontSize:20, cursor:"pointer" }}>←</button>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em", flex:1 }}>YOUR COOKBOOK</div>
        <button
          onClick={() => onToggleFavorite(log.id)}
          title={log.isFavorite ? "Unfavorite" : "Favorite"}
          style={{ background:"none", border:"none", color: log.isFavorite ? "#f5c842" : "#444", fontSize:20, cursor:"pointer" }}
        >
          {log.isFavorite ? "★" : "☆"}
        </button>
      </div>

      <div style={{ padding:"24px 20px 0", textAlign:"center" }}>
        <div style={{ fontSize:64, marginBottom:12 }}>{log.recipeEmoji}</div>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:300, fontStyle:"italic", color:"#f0ece4", letterSpacing:"-0.02em", marginBottom:6 }}>{log.recipeTitle}</h1>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:"#555", letterSpacing:"0.1em" }}>
          {(log.recipeCuisine || "").toUpperCase()}
          {log.recipeCategory ? ` · ${log.recipeCategory.toUpperCase()}` : ""}
          {` · ${relativeDate(log.cookedAt)}`}
        </div>
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
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555", letterSpacing:"0.12em", marginBottom:10 }}>ATE WITH YOU</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {log.diners.map(id => (
              <span key={id} style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 12px", background:"#1e1e1e", border:"1px solid #2a2a2a", borderRadius:20, fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#ccc" }}>
                👥 {nameFor ? nameFor(id) : "Someone"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ margin:"20px 20px 0", display:"flex", flexDirection:"column", gap:10 }}>
        {recipe && (
          <button onClick={onBack} style={{ width:"100%", padding:"14px", background:"#f5c842", color:"#111", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:600, cursor:"pointer", letterSpacing:"0.08em" }}>
            COOK IT AGAIN →
          </button>
        )}
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} style={{ width:"100%", padding:"12px", background:"transparent", color:"#555", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em" }}>
            REMOVE FROM COOKBOOK
          </button>
        ) : (
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
export default function Cookbook({ userId, familyKey, nameFor }) {
  const { logs, loading, toggleFavorite, remove } = useCookLog(userId, familyKey);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState(null);

  // Precompute counts per filter so we can show them (and subtly grey out
  // the ones with zero matches). All logs are the user's own.
  const counts = useMemo(() => {
    const c = { all: logs.length, favorites: 0, nailed: 0, good: 0, meh: 0, rough: 0 };
    for (const l of logs) {
      if (l.isFavorite) c.favorites++;
      c[l.rating] = (c[l.rating] || 0) + 1;
    }
    return c;
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter(l => {
      if (q && !l.recipeTitle.toLowerCase().includes(q) && !(l.notes || "").toLowerCase().includes(q)) return false;
      if (filter === "all")       return true;
      if (filter === "favorites") return l.isFavorite;
      return l.rating === filter;
    });
  }, [logs, filter, search]);

  // Detail mode — find the log and push into the detail screen.
  const detailLog = useMemo(() => logs.find(l => l.id === detailId) || null, [logs, detailId]);
  if (detailLog) {
    return (
      <CookLogDetail
        log={detailLog}
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
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#555" }}>COOKED</div>
          </div>
        </div>
      </div>

      {!loading && logs.length === 0 ? (
        // Empty state — user hasn't logged anything yet. Keep it warm, not
        // nagging. The screenshot on the Cook tab will do the onboarding.
        <div style={{ margin:"40px 20px 0", padding:"40px 24px", textAlign:"center", background:"#0f0f0f", border:"1px dashed #222", borderRadius:18 }}>
          <div style={{ fontSize:56, marginBottom:14, opacity:0.6 }}>📖</div>
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontStyle:"italic", color:"#aaa", marginBottom:8 }}>
            Your cookbook's empty
          </div>
          <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#666", lineHeight:1.6 }}>
            Every meal you finish in Cook Mode lands here — with your rating,
            notes, and who ate with you.
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
            {FILTERS.map(f => {
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
                        {log.isFavorite && <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.08em" }}>★ FAVORITE</span>}
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
