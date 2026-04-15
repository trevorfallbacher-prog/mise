import { useEffect, useMemo, useRef, useState } from "react";
import { useCookLog, useDinerLog, useCookLogReviews, useMyFavorites, useCookSavers, useCookPhotos } from "../lib/useCookLog";
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
//
// Even when a reviewer left the notes field blank we still render the row
// — the face + rating label is the whole point. Without this, a thumbs-
// only review looks like nothing happened, which was the bug where "the
// chef can't read the review or rating".
function ReviewList({ reviews, excludeReviewerId, nameFor, title }) {
  const shown = reviews.filter(r => r.reviewerId !== excludeReviewerId);
  if (shown.length === 0) return null;
  return (
    <div style={{ padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
      <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.12em", marginBottom:12 }}>
        {title || (shown.length === 1 ? "1 REVIEW" : `${shown.length} REVIEWS`)}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {shown.map(r => {
          const m = ratingMeta(r.rating);
          return (
            <div key={r.id} style={{ padding:"12px 14px", background:"#0f0f0f", border:`1px solid ${m.border}`, borderRadius:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom: 8 }}>
                <span style={{ fontSize:30, flexShrink:0 }}>{m.emoji}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#f0ece4", fontWeight:500 }}>
                    {nameFor ? nameFor(r.reviewerId) : "Someone"}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}>
                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:m.color, letterSpacing:"0.1em", background:m.bg, border:`1px solid ${m.border}`, padding:"1px 8px", borderRadius:4 }}>
                      {m.label.toUpperCase()}
                    </span>
                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555" }}>{relativeDate(r.createdAt)}</span>
                  </div>
                </div>
              </div>
              {r.notes ? (
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#ccc", lineHeight:1.65, margin:0, whiteSpace:"pre-wrap" }}>
                  "{r.notes}"
                </p>
              ) : (
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#555", fontStyle:"italic", margin:0 }}>
                  — no written notes —
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Photo gallery ────────────────────────────────────────────────────────────
// Thumbs in a 3-up grid + a final "+" tile that opens the file picker.
// Tap a thumb to zoom. On mobile the input's `capture="environment"`
// hint surfaces the camera directly; on desktop it's a plain file
// picker. We don't force-compress client-side — Supabase storage is
// cheap and the quality loss would be noticeable on shots the user
// actually wants to keep.
function PhotoGallery({ cookLogId, viewerId, nameFor }) {
  const { photos, loading, upload, remove } = useCookPhotos(cookLogId, viewerId);
  const [lightbox, setLightbox] = useState(null); // the photo being zoomed
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    // Always clear the input value so the same file can be picked twice
    // in a row (e.g. after a failed upload).
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    await upload(file);
    setBusy(false);
  };

  return (
    <div style={{ padding:"16px", background:"#161616", border:"1px solid #2a2a2a", borderRadius:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.12em" }}>
          PHOTOS{photos.length > 0 ? ` · ${photos.length}` : ""}
        </div>
        {busy && (
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#888", letterSpacing:"0.08em" }}>
            UPLOADING…
          </div>
        )}
      </div>

      {/* The hidden file input. `accept` limits to images; `capture` asks
          mobile for the rear camera when available but falls back to
          the file picker on desktop. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPick}
        style={{ display:"none" }}
      />

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8 }}>
        {photos.map(p => {
          const isMine = p.uploaderId === viewerId;
          return (
            <div
              key={p.id}
              style={{ position:"relative", aspectRatio:"1 / 1", borderRadius:10, overflow:"hidden", background:"#0f0f0f", border:"1px solid #222" }}
            >
              <img
                src={p.url}
                alt="meal"
                onClick={() => setLightbox(p)}
                style={{ width:"100%", height:"100%", objectFit:"cover", cursor:"zoom-in" }}
              />
              {/* Only the uploader sees the × — RLS would block the
                  delete anyway, but surfacing it prevents a confused
                  tap that looks like it did nothing. */}
              {isMine && (
                <button
                  onClick={() => remove(p.id)}
                  aria-label="Remove photo"
                  style={{
                    position:"absolute", top:4, right:4,
                    width:22, height:22, borderRadius:11,
                    background:"rgba(0,0,0,0.65)", border:"1px solid rgba(255,255,255,0.15)",
                    color:"#fff", fontFamily:"'DM Mono',monospace", fontSize:13,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    cursor:"pointer", padding:0,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {/* + tile — always present, lets any cohort member add a photo. */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          style={{
            aspectRatio:"1 / 1", borderRadius:10,
            background:"#0f0f0f", border:"1px dashed #3a2f10",
            color:"#f5c842", fontFamily:"'DM Mono',monospace", fontSize:11,
            letterSpacing:"0.08em", cursor: busy ? "progress" : "pointer",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4,
          }}
        >
          <span style={{ fontSize:22, lineHeight:1 }}>＋</span>
          <span>ADD</span>
        </button>
      </div>

      {!loading && photos.length === 0 && (
        <p style={{ marginTop:10, fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#666", fontStyle:"italic", margin:"10px 0 0" }}>
          No photos yet — tap + to add one.
        </p>
      )}

      {/* Lightbox — simple fullscreen overlay. Tap anywhere to close.
          Shows uploader attribution so you remember whose shot you're
          looking at (useful when a few people photographed the same
          meal from different angles). */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,0.92)",
            zIndex:200, display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", padding:20, cursor:"zoom-out",
          }}
        >
          <img
            src={lightbox.url}
            alt="meal"
            style={{ maxWidth:"100%", maxHeight:"80vh", borderRadius:10, boxShadow:"0 8px 32px rgba(0,0,0,0.6)" }}
          />
          <div style={{ marginTop:14, fontFamily:"'DM Mono',monospace", fontSize:10, color:"#888", letterSpacing:"0.12em" }}>
            BY {(nameFor ? nameFor(lightbox.uploaderId) : "SOMEONE").toUpperCase()} · {relativeDate(lightbox.createdAt).toUpperCase()}
          </div>
        </div>
      )}
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
function CookLogDetail({ log, viewerId, onBack, onToggleFavorite, onDelete, onLeave, nameFor }) {
  const meta = ratingMeta(log.rating);
  const recipe = findRecipe(log.recipeSlug);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isChef = viewerId === log.userId;
  const { reviews, myReview, upsertMyReview, deleteMyReview } = useCookLogReviews(log.id, viewerId);
  // "Who else has saved this?" — chef-side social proof. Excludes the
  // viewer so the chef doesn't see their own star padding the count.
  const { saverIds } = useCookSavers(log.id, viewerId);
  return (
    <div style={{ minHeight:"100vh", paddingBottom:100 }}>
      <div style={{ padding:"20px 20px 0", display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#555", fontSize:20, cursor:"pointer" }}>←</button>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#555", letterSpacing:"0.12em", flex:1 }}>
          {isChef ? "YOUR COOKBOOK" : "MEALS YOU ATE"}
        </div>
        {/* Viewer-scoped favorites (migration 0016) — the star is a
            personal bookmark that works on any cook the viewer can see,
            including meals cooked by a family member. */}
        <button
          onClick={() => onToggleFavorite(log.id)}
          title={log.isFavorite ? "Remove from favorites" : "Save to favorites"}
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
        {!isChef && (
          <div style={{ marginTop:8, fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#888" }}>
            Cooked by <span style={{ color:"#f0ece4" }}>{nameFor ? nameFor(log.userId) : "a friend"}</span>
          </div>
        )}
      </div>

      {/* Rating headline card — whose rating this is depends on whether
          the viewer is the chef (they see their OWN self-rating) or a
          diner (they see the chef's self-rating, labeled as such). */}
      <div style={{ margin:"22px 20px 0", padding:"18px 20px", background:meta.bg, border:`1px solid ${meta.border}`, borderRadius:16, display:"flex", alignItems:"center", gap:14 }}>
        <span style={{ fontSize:40 }}>{meta.emoji}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, color:meta.color, fontStyle:"italic" }}>{meta.label}</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666", marginTop:2, letterSpacing:"0.1em" }}>
            {isChef ? "YOUR RATING" : `CHEF'S OWN RATING`} · +{log.xpEarned} XP · {log.diners.length > 0 ? `${log.diners.length} ${log.diners.length === 1 ? "DINER" : "DINERS"}` : "SOLO"}
          </div>
        </div>
      </div>

      {/* Social proof — chef sees who from the cohort has ★-saved this
          cook. Surfaced as a small pill strip right under the headline
          so it reads as ambient "your family liked this" without hogging
          vertical space. Hidden when it's just the chef's own star. */}
      {isChef && saverIds.length > 0 && (
        <div style={{ margin:"12px 20px 0", padding:"10px 14px", background:"#161208", border:"1px solid #3a2f10", borderRadius:12, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:14 }}>⭐</span>
          <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#f5c842" }}>
            Saved by{" "}
            {saverIds.slice(0, 3).map((id, i) => (
              <span key={id} style={{ fontWeight:500 }}>
                {nameFor ? nameFor(id) : "Someone"}
                {i < Math.min(saverIds.length, 3) - 1 ? ", " : ""}
              </span>
            ))}
            {saverIds.length > 3 && (
              <span>{" "}+ {saverIds.length - 3} more</span>
            )}
          </span>
        </div>
      )}

      {/* Photos — anyone in the cohort can upload, everyone sees the
          whole gallery. Landed above the review thread because a
          picture is the fastest way to re-enter the memory, and sits
          above even diner-attributed reviews so it reads shared rather
          than review-adjacent. */}
      <div style={{ margin:"12px 20px 0" }}>
        <PhotoGallery cookLogId={log.id} viewerId={viewerId} nameFor={nameFor} />
      </div>

      {/* Chef view: the diners' reviews are the whole reason for opening
          this screen — surface them HIGH so a tap from a notification
          lands right on the review thread. Empty state is explicit so
          the chef knows the diners haven't weighed in yet rather than
          wondering if the UI broke. */}
      {isChef && (
        <div style={{ margin:"12px 20px 0" }}>
          {reviews.length > 0 ? (
            <ReviewList reviews={reviews} excludeReviewerId={null} nameFor={nameFor} title="WHAT YOUR DINERS THOUGHT" />
          ) : log.diners.length > 0 ? (
            <div style={{ padding:"16px", background:"#161616", border:"1px dashed #2a2a2a", borderRadius:14 }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.12em", marginBottom:8 }}>WHAT YOUR DINERS THOUGHT</div>
              <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#888", margin:0, lineHeight:1.6 }}>
                No reviews yet — they just got a notification with a tappable link.
              </p>
            </div>
          ) : null}
        </div>
      )}

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

      {/* Diner view: show OTHER diners' reviews below the composer, so
          the current reviewer can see what the rest of the table thought
          without their own review duplicating (that's in the composer). */}
      {!isChef && reviews.length > 1 && (
        <div style={{ margin:"12px 20px 0" }}>
          <ReviewList
            reviews={reviews}
            excludeReviewerId={viewerId}
            nameFor={nameFor}
            title="ALSO AT THE TABLE"
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
        {/* Both chef and diner can clear a meal from their cookbook.
            Chef deletes the underlying row (vaporizing everyone's
            references); diner just removes themselves from diners[]
            via leave_cook_log RPC — the cook stays on the chef's
            cookbook and other diners' as normal.*/}
        {!confirmDelete && (
          <button onClick={() => setConfirmDelete(true)} style={{ width:"100%", padding:"12px", background:"transparent", color:"#555", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em" }}>
            {isChef ? "REMOVE FROM COOKBOOK" : "REMOVE FROM MY LIST"}
          </button>
        )}
        {confirmDelete && (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:"#bbb", textAlign:"center", padding:"4px 8px", lineHeight:1.5 }}>
              {isChef
                ? "Delete this meal permanently? Your diners' reviews on it will go with it."
                : "Remove yourself from this meal? Your review and favorite on it will be cleared — the chef's cookbook is unaffected."}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setConfirmDelete(false)} style={{ flex:1, padding:"12px", background:"#1a1a1a", color:"#888", border:"1px solid #2a2a2a", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em" }}>
                CANCEL
              </button>
              <button
                onClick={() => {
                  if (isChef) onDelete(log.id);
                  else onLeave?.(log.id);
                  onBack();
                }}
                style={{ flex:2, padding:"12px", background:"#ef4444", color:"#fff", border:"none", borderRadius:12, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", fontWeight:600 }}
              >
                {isChef ? "DELETE PERMANENTLY" : "YES, REMOVE"}
              </button>
            </div>
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
  // Viewer-scoped favorites (migration 0016). The star is now a personal
  // bookmark that works on any cook the viewer can see — their own OR
  // someone else's — so both scopes treat it identically.
  const favorites  = useMyFavorites(userId, familyKey);
  const toggleFavorite = favorites.toggle;

  // Enrich each log with an isFavorite flag derived from the viewer's
  // own favorites set. Done via memo so list re-renders are stable.
  const cookedLogs = useMemo(
    () => cookedHook.logs.map(l => ({ ...l, isFavorite: favorites.favoriteIds.has(l.id) })),
    [cookedHook.logs, favorites.favoriteIds],
  );
  const eatenLogs = useMemo(
    () => eatenHook.logs.map(l => ({ ...l, isFavorite: favorites.favoriteIds.has(l.id) })),
    [eatenHook.logs, favorites.favoriteIds],
  );

  // Consume an inbound deep-link. We wait until the relevant stream has
  // loaded so the detail screen can actually resolve the row — otherwise
  // we'd flash an empty detail. If the id genuinely isn't found (e.g. the
  // chef deleted the log), we still consume the link so we don't get stuck
  // retrying forever, and just fall back to the list.
  useEffect(() => {
    if (!deepLink || deepLink.kind !== "cook_log") return;
    const inCooked = cookedLogs.some(l => l.id === deepLink.id);
    const inEaten  = eatenLogs.some(l => l.id === deepLink.id);
    const stillLoading = cookedHook.loading || eatenHook.loading;
    if (!inCooked && !inEaten && stillLoading) return; // give the streams a beat
    if (inCooked)       setScope("cooked");
    else if (inEaten)   setScope("eaten");
    setDetailId(deepLink.id);
    onConsumeDeepLink?.();
  }, [deepLink, cookedLogs, eatenLogs, cookedHook.loading, eatenHook.loading, onConsumeDeepLink]);

  const logs    = scope === "cooked" ? cookedLogs    : eatenLogs;
  const loading = scope === "cooked" ? cookedHook.loading : eatenHook.loading;
  // Chef-owned delete still lives on the cooked hook; diner-side "leave
  // this meal" lives on the diner hook and talks to the RPC.
  const { remove } = cookedHook;
  const { leaveCookLog } = eatenHook;

  // Which card (if any) is in its inline confirm state. null = none.
  // Kept as an id rather than a boolean so only one card at a time can
  // show the confirm strip.
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  // On the COOKED scope, a log's rating IS the chef's own rating — that's
  // what the chef sees and filters by. On the EATEN scope the relevant
  // rating is the DINER's (the viewer's) own review of that meal; if they
  // haven't reviewed yet, we bucket it as "pending". Shared helper so
  // cards, filter chips, and counts all agree on the same signal.
  const effectiveRating = (l) =>
    scope === "cooked"
      ? l.rating
      : (l.myReview?.rating || "pending");

  // Precompute counts per filter for the active scope.
  const counts = useMemo(() => {
    const c = { all: logs.length, favorites: 0, pending: 0, nailed: 0, good: 0, meh: 0, rough: 0 };
    for (const l of logs) {
      if (l.isFavorite) c.favorites++;
      const r = effectiveRating(l);
      c[r] = (c[r] || 0) + 1;
    }
    return c;
  }, [logs, scope]);

  // Favorites are viewer-scoped now, so ★ works on both scopes. EATEN
  // picks up a "To review" bucket for unreviewed diner cooks — the
  // chef auto-rates on save, so Pending would always be zero on COOKED
  // and we hide it there.
  const visibleFilters = useMemo(() => {
    if (scope === "eaten") {
      return [
        { id: "all",       label: "All"           },
        { id: "favorites", label: "★ Favorites"   },
        { id: "pending",   label: "🕒 To review"  },
        { id: "nailed",    label: "🤩 Nailed"     },
        { id: "good",      label: "😊 Good"       },
        { id: "meh",       label: "😐 Meh"        },
        { id: "rough",     label: "😬 Rough"      },
      ];
    }
    return FILTERS;
  }, [scope]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter(l => {
      if (q && !l.recipeTitle.toLowerCase().includes(q) && !(l.notes || "").toLowerCase().includes(q)) return false;
      if (filter === "all")       return true;
      if (filter === "favorites") return l.isFavorite;
      return effectiveRating(l) === filter;
    });
  }, [logs, filter, search, scope]);

  // Detail mode — find the log across both streams so "back" works
  // seamlessly if the scope changes while the detail is open. Uses the
  // enriched versions so isFavorite reflects the viewer's own bookmark.
  const detailLog = useMemo(
    () => cookedLogs.concat(eatenLogs).find(l => l.id === detailId) || null,
    [cookedLogs, eatenLogs, detailId],
  );
  if (detailLog) {
    return (
      <CookLogDetail
        log={detailLog}
        viewerId={userId}
        onBack={() => setDetailId(null)}
        onToggleFavorite={toggleFavorite}
        onDelete={remove}
        onLeave={leaveCookLog}
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
              // On EATEN scope the viewer cares about THEIR OWN review
              // rating, not the chef's self-rating. When they haven't
              // reviewed yet we show a neutral "pending" pill and no
              // face so the card looks unmistakably unrated.
              const isCooked = scope === "cooked";
              const isReviewed = !!log.myReview;
              const faceRating = isCooked
                ? log.rating
                : (isReviewed ? log.myReview.rating : null);
              const faceMeta = faceRating ? ratingMeta(faceRating) : null;
              // Notes shown on the card follow the same "whose view is
              // this?" logic — chef's notes on COOKED, diner's own notes
              // on EATEN. Chef's notes on someone else's cook aren't
              // ours to expose on a list card (that lives in the detail
              // review list).
              const cardNotes = isCooked
                ? log.notes
                : (isReviewed ? log.myReview.notes : "");
              const isConfirming = pendingDeleteId === log.id;
              // Inline confirm strip — card morphs in place when the user
              // taps the ×. Chef deletes the underlying row; diner
              // leaves via RPC. The wording is scope-aware so nobody
              // accidentally blows up the chef's cookbook.
              if (isConfirming) {
                return (
                  <div
                    key={log.id}
                    style={{ width:"100%", background:"#1a0f0f", border:"1px solid #3a1a1a", borderRadius:16, padding:"16px" }}
                  >
                    <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:12 }}>
                      <span style={{ fontSize:24, flexShrink:0 }}>{log.recipeEmoji}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:"'Fraunces',serif", fontSize:16, color:"#f0ece4", marginBottom:4 }}>
                          {isCooked ? "Delete this meal?" : "Remove from your list?"}
                        </div>
                        <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#888", lineHeight:1.5 }}>
                          {isCooked
                            ? `${log.recipeTitle} — deletes permanently, including every diner's review on it.`
                            : `${log.recipeTitle} — clears your review and favorite for this meal. The chef's cookbook isn't affected.`}
                        </div>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        style={{ flex:1, padding:"10px", background:"#1a1a1a", color:"#888", border:"1px solid #2a2a2a", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em" }}
                      >
                        CANCEL
                      </button>
                      <button
                        onClick={() => {
                          if (isCooked) remove(log.id);
                          else          leaveCookLog?.(log.id);
                          setPendingDeleteId(null);
                        }}
                        style={{ flex:1, padding:"10px", background:"#ef4444", color:"#fff", border:"none", borderRadius:10, fontFamily:"'DM Mono',monospace", fontSize:11, cursor:"pointer", letterSpacing:"0.08em", fontWeight:600 }}
                      >
                        {isCooked ? "DELETE" : "REMOVE"}
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <button
                  key={log.id}
                  onClick={() => setDetailId(log.id)}
                  style={{ width:"100%", textAlign:"left", background:"#141414", border:`1px solid ${log.isFavorite ? "#f5c84244" : !isCooked && !isReviewed ? "#f5c84233" : "#222"}`, borderRadius:16, padding:"16px", cursor:"pointer", position:"relative" }}
                >
                  {/* Inline × — tap to morph the card into the confirm
                      strip above. stopPropagation so we don't also open
                      the detail screen under the prompt. */}
                  <span
                    role="button"
                    aria-label="Remove this meal"
                    onClick={(e) => { e.stopPropagation(); setPendingDeleteId(log.id); }}
                    style={{
                      position:"absolute", top:10, right:12,
                      width:24, height:24,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontFamily:"'DM Mono',monospace", fontSize:16, color:"#444",
                      cursor:"pointer", borderRadius:6,
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "#1a0a0a"; }}
                    onMouseOut={(e) => { e.currentTarget.style.color = "#444"; e.currentTarget.style.background = "transparent"; }}
                  >
                    ×
                  </span>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:14, paddingRight:20 }}>
                    <div style={{ fontSize:36, flexShrink:0 }}>{log.recipeEmoji}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4, flexWrap:"wrap" }}>
                        <span style={{ fontFamily:"'Fraunces',serif", fontSize:17, color:"#f0ece4", fontWeight:400 }}>{log.recipeTitle}</span>
                        {faceMeta && <span style={{ fontSize:16 }} title={faceMeta.label}>{faceMeta.emoji}</span>}
                        {log.isFavorite && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", letterSpacing:"0.08em" }}>★ FAVORITE</span>
                        )}
                        {!isCooked && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#888", letterSpacing:"0.08em" }}>
                            BY {(nameFor ? nameFor(log.userId) : "SOMEONE").toUpperCase()}
                          </span>
                        )}
                        {!isCooked && !isReviewed && (
                          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, color:"#f5c842", background:"#1a1608", border:"1px solid #3a2f10", borderRadius:4, padding:"1px 6px", letterSpacing:"0.08em" }}>
                            🕒 TAP TO REVIEW
                          </span>
                        )}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666" }}>{relativeDate(log.cookedAt)}</span>
                        {isCooked && (
                          <>
                            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#444" }}>·</span>
                            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666" }}>+{log.xpEarned} XP</span>
                          </>
                        )}
                        {log.diners.length > 0 && (
                          <>
                            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#444" }}>·</span>
                            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#666" }}>
                              👥 {log.diners.length}
                            </span>
                          </>
                        )}
                        {!isCooked && isReviewed && faceMeta && (
                          <>
                            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#444" }}>·</span>
                            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:faceMeta.color, letterSpacing:"0.1em" }}>
                              YOU · {faceMeta.label.toUpperCase()}
                            </span>
                          </>
                        )}
                      </div>
                      {cardNotes && (
                        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#888", fontStyle:"italic", lineHeight:1.5, marginTop:8, marginBottom:0, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                          "{cardNotes}"
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
