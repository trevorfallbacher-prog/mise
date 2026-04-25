// MemoryBookCapture — the "scan didn't pair, document it instead" flow.
//
// Surfaces when a UPC scan misses every resolution tier (no OFF data,
// no learned correction, no fuzzy hit). Reframes the situation as
// adding a product to the household's memory book — never as a
// failure. Two-step photo capture:
//
//   1. Front of package — required. Sent to Haiku via the
//      categorize-product-photo edge fn. Returns brand / canonical /
//      category / state / claims / package size.
//   2. Nutrition label — skippable. Sent to scan-nutrition-label
//      edge fn. Returns per-100g macros.
//
// Output: a populated draft row handed back to the caller via
// onComplete(row), which the caller (AddDraftSheet) merges into its
// existing form state. The row also carries a `learnedCorrection`
// payload so the caller can write to barcode_identity_corrections
// and never re-pay AI tokens for the same UPC.
//
// Visual register: MCM tokens (Pale Martini display, Instrument Serif
// details, DM Sans body, DM Mono kicker), parchment cream background,
// soft glass plates, burnt-orange primary CTA, no spinners (motion
// pulse on the kicker text instead).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { color, font, radius, shadow, space, ctaButton, ghostButton } from "./tokens";
import { compressImage } from "../../lib/compressImage";
import { categorizeProductPhoto } from "../../lib/categorizeProductPhoto";
import { findIngredient } from "../../data/ingredients";
import { typeIdForCanonical } from "../../data/foodTypes";
import { tagHintsToAxes } from "../../lib/tagHintsToAxes";
import { detectBrand } from "../../data/knownBrands";
import { supabase } from "../../lib/supabase";

const MAX_DIM = 1280;
const QUALITY  = 0.82;

// User-tier slug from a free-text canonical name. Mirrors the slug
// rule in bindOrCreateCanonical's nameToSlug so the user-typed
// "+ Add canonical" affordance and the AI's "newCanonicalName"
// path produce identical slugs for identical names.
function nameToUserSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

async function captureToBase64(file) {
  const { base64, mediaType } = await compressImage(file, {
    maxDimension: MAX_DIM,
    jpegQuality:  QUALITY,
  });
  return { base64, mediaType: mediaType || "image/jpeg" };
}

// Small step-indicator dots. Two beads, the active one filled in
// warmBrown, the inactive in a hairline ring. Sits above the hero so
// users see "1 of 2" / "2 of 2" without having to read it. The active
// bead also gets a tiny scale bump (0.875 → 1) on activation so the
// state change carries a proprioceptive "click into place" cue beyond
// the color swap alone. Reduced-motion users get just the color swap.
function StepBeads({ step, reduceMotion }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: space.lg }}>
      {[0, 1].map(i => {
        const active = i <= step;
        return (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: radius.pill,
              background: active ? color.warmBrown : "transparent",
              border: `1px solid ${active ? color.warmBrown : color.hairline}`,
              transform: reduceMotion ? "none" : `scale(${active ? 1 : 0.875})`,
              transition: reduceMotion
                ? "background 240ms cubic-bezier(0.22, 1, 0.36, 1)"
                : "background 240ms cubic-bezier(0.22, 1, 0.36, 1), transform 240ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        );
      })}
    </div>
  );
}

// The capture plate — a soft glass tile that holds either the
// "tap to capture" affordance or the rendered photo once taken.
// Same shape on both states keeps the layout from jumping when a
// photo lands.
function CapturePlate({ photoSrc, onTrigger, label, sublabel, reduceMotion }) {
  return (
    <motion.button
      type="button"
      onClick={onTrigger}
      whileTap={reduceMotion ? {} : { scale: 0.985 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
      style={{
        width: "100%",
        aspectRatio: "4 / 5",
        position: "relative",
        background: photoSrc ? color.paper : color.glassFillLite,
        border: `1px solid ${color.hairline}`,
        borderRadius: radius.lg,
        boxShadow: photoSrc ? shadow.lift : shadow.soft,
        overflow: "hidden",
        padding: 0,
        cursor: "pointer",
        transition: "box-shadow 240ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {photoSrc ? (
        <motion.img
          key={photoSrc}
          src={photoSrc}
          alt=""
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          padding: space.xl,
          textAlign: "center",
        }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: radius.pill,
            background: color.cream,
            border: `1px solid ${color.hairline}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            color: color.warmBrown,
            boxShadow: shadow.soft,
          }}>📷</div>
          <div style={{
            fontFamily: font.sans,
            fontSize: 15,
            fontWeight: 600,
            color: color.ink,
            marginTop: space.sm,
          }}>{label}</div>
          {sublabel && (
            <div style={{
              fontFamily: font.detail,
              fontStyle: "italic",
              fontSize: 13,
              color: color.inkMuted,
              maxWidth: 240,
              lineHeight: 1.4,
            }}>{sublabel}</div>
          )}
        </div>
      )}
    </motion.button>
  );
}

export default function MemoryBookCapture({
  barcodeUpc        = null,
  offCategoryHints  = null,
  onComplete,
  onCancel,
}) {
  // phases: "intro" → "front-captured" → "nutrition-captured" | "processing" → done
  // a "retry" phase fires when the AI returns unreadable / not_a_product /
  // blank — same surface as intro but with a kind nudge above the plate.
  const [phase, setPhase]     = useState("intro");
  const [retryCue, setRetryCue] = useState(null);
  const [frontPhoto, setFrontPhoto]         = useState(null);     // { base64, mediaType, previewUrl }
  const [nutritionPhoto, setNutritionPhoto] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const frontInputRef     = useRef(null);
  const nutritionInputRef = useRef(null);

  // Respect the user's vestibular settings — when reduced-motion is
  // requested, drop transform-based motion and keep only opacity
  // transitions. Sheet entrance, hero swap, plate scale-in, step
  // bead scaling all branch off this.
  const reduceMotion = useReducedMotion();

  // Esc → cancel. Same keyboard pattern AddDraftSheet uses.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Revoke any object URLs we made for previews when the component
  // unmounts so we don't leak blobs.
  useEffect(() => {
    return () => {
      frontPhoto?.previewUrl     && URL.revokeObjectURL(frontPhoto.previewUrl);
      nutritionPhoto?.previewUrl && URL.revokeObjectURL(nutritionPhoto.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFrontFile = async (file) => {
    if (!file) return;
    setError(null);
    setRetryCue(null);
    setBusy(true);
    try {
      const { base64, mediaType } = await captureToBase64(file);
      const previewUrl = URL.createObjectURL(file);
      // Revoke the prior previewUrl on retake — the unmount cleanup
      // only catches the LAST one, so without revoking here every
      // retake during a session leaks a blob.
      setFrontPhoto((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { base64, mediaType, previewUrl };
      });
      setPhase("front-captured");
    } catch (e) {
      console.error("[memory-book] front compress failed:", e);
      setError("Couldn't quite hold onto that photo. Try one more time?");
    } finally {
      setBusy(false);
    }
  };

  const handleNutritionFile = async (file) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { base64, mediaType } = await captureToBase64(file);
      const previewUrl = URL.createObjectURL(file);
      setNutritionPhoto((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { base64, mediaType, previewUrl };
      });
      setPhase("nutrition-captured");
    } catch (e) {
      console.error("[memory-book] nutrition compress failed:", e);
      setError("Couldn't quite hold onto that photo. Try one more time?");
    } finally {
      setBusy(false);
    }
  };

  // Run categorize (front) and scan-nutrition-label (back) in parallel
  // when both are present; otherwise just categorize. Build the draft
  // row from whatever lands.
  const finalize = async ({ skipNutrition }) => {
    if (!frontPhoto?.base64) return;
    setBusy(true);
    setError(null);
    try {
      const frontPromise = categorizeProductPhoto({
        image:            frontPhoto.base64,
        mediaType:        frontPhoto.mediaType,
        barcodeUpc,
        offCategoryHints: Array.isArray(offCategoryHints) ? offCategoryHints : null,
      });
      const nutritionPromise = (skipNutrition || !nutritionPhoto?.base64)
        ? Promise.resolve(null)
        : supabase.functions.invoke("scan-nutrition-label", {
            body: {
              image:     nutritionPhoto.base64,
              mediaType: nutritionPhoto.mediaType,
            },
          }).then(r => r?.data || null).catch(e => {
            console.warn("[memory-book] nutrition scan failed:", e);
            return null;
          });

      setPhase("processing");
      const [front, nutrition] = await Promise.all([frontPromise, nutritionPromise]);

      // Front-photo result is the load-bearing one. If it failed,
      // route back to the front-capture surface with a kind retry
      // cue — never a "scan failed" terminal.
      if (!front?.found) {
        const reason = front?.reason || "unreadable";
        const cue = reason === "not_a_product"
          ? "That looks like something other than a product. Try a shot of the package?"
          : reason === "blank"
            ? "The frame came back empty. Mind taking another?"
            : "Hmm, that one didn't read clearly. Try another angle?";
        setRetryCue(cue);
        setFrontPhoto((prev) => {
          if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return null;
        });
        setPhase("intro");
        setBusy(false);
        return;
      }

      // Canonical resolution — the edge fn has already done the heavy
      // lifting: Haiku picks from the constrained CANONICALS list,
      // a phantom-id check rejects invalid picks, and the flavor-prefix
      // stripper catches obvious cheats ("Buffalo Beef Stick" →
      // beef_stick + claims:["Buffalo"]). All we do here is route the
      // resolved canonical into form state.
      //
      //   front.canonicalId       — non-null when AI picked from the list
      //                             OR the stripper recovered a list hit.
      //                             Use directly.
      //   front.newCanonicalName  — non-null when nothing in the list
      //                             fit. Synthesize a user-tier slug
      //                             ("Caramel Dip" → "caramel_dip") so
      //                             the form lands paired instead of
      //                             empty — matches the typeahead's
      //                             "+ Add canonical" affordance.
      //   front.bindConfidence    — "exact" | "stripped" | "guessed".
      //                             Threaded into the draft row so the
      //                             form's canonical chip can dial
      //                             its visual register.
      let canonicalId    = front.canonicalId || null;
      let canonicalName  = null;
      let bindConfidence = front.bindConfidence || "guessed";

      if (canonicalId) {
        const ing = findIngredient(canonicalId);
        canonicalName = ing?.name || canonicalId;
      } else if (front.newCanonicalName) {
        const slug = nameToUserSlug(front.newCanonicalName);
        canonicalId   = slug || null;
        canonicalName = front.newCanonicalName;
      }

      // Brand — Haiku's reading is the primary source, then the
      // existing detectBrand vocabulary as a fallback when Haiku
      // returned null but a known brand is hiding in productName.
      let brand = front.brand || null;
      if (!brand && front.productName) {
        const brandHit = detectBrand(front.productName);
        if (brandHit?.display) brand = brandHit.display;
      }

      // Tile / typeId derivation — same cascade Kitchen.jsx uses for
      // OFF results: canonical → tagHints → fallback.
      const hintAxes = tagHintsToAxes(offCategoryHints || []);
      const typeId = canonicalId
        ? (typeIdForCanonical(canonicalId) || hintAxes.typeId || null)
        : (hintAxes.typeId || null);
      const category = front.category || hintAxes.category || "pantry";

      const ingredient = canonicalId ? findIngredient(canonicalId) : null;
      const draftRow = {
        // Identity
        canonicalId,
        canonicalName,
        // canonicalDecision is now derived from bindConfidence —
        // the edge fn's three-tier resolver replaces the old
        // bindOrCreateCanonical decision string.
        canonicalDecision: bindConfidence === "exact"
          ? "bind"
          : bindConfidence === "stripped"
            ? "suggest"
            : "create",
        canonicalScore:    null,    // edge fn doesn't surface a numeric score
        // bindConfidence: "exact" | "stripped" | "guessed" — drives
        // the canonical chip's visual register on the form so a
        // confident bind reads solid and a guessed bind invites a
        // tap to confirm without screaming "we failed."
        bindConfidence,
        // Display
        name:       front.productName || canonicalName || "",
        brand:      brand || null,
        emoji:      ingredient?.emoji || "✨",
        category,
        // Axes
        state:      front.state || null,
        claims:     Array.isArray(front.claims) ? front.claims : [],
        typeId,
        tileId:     hintAxes.tileId || null,
        // Package — front-photo wins (it reads off the printed weight
        // on the package face), but the nutrition-label scanner's
        // net_weight is a clean fallback when the front shot didn't
        // carry the size or Haiku missed it. Both edge fns return the
        // same { amount, unit } shape so the merge is straight.
        packageAmount:
          front.packageSize?.amount
          ?? nutrition?.net_weight?.amount
          ?? null,
        packageUnit:
          front.packageSize?.unit
          || nutrition?.net_weight?.unit
          || null,
        // Provenance — both photos travel with the row so the
        // caller can stash them in the household's memory book if
        // it wants to surface them later.
        memoryBookFrontPhoto:     frontPhoto.previewUrl,
        memoryBookNutritionPhoto: nutritionPhoto?.previewUrl || null,
        // Nutrition — when scan-nutrition-label landed, attach.
        nutrition: nutrition?.nutrition || null,
        // Source metadata
        scanSource: "memory_book",
        barcodeUpc,
        confidence: front.confidence,
        learnedCorrection: {
          barcodeUpc,
          canonicalId,
          typeId,
          tileId:        hintAxes.tileId || null,
          location:      null,
          emoji:         ingredient?.emoji || null,
          ingredientIds: canonicalId ? [canonicalId] : [],
          categoryHints: Array.isArray(offCategoryHints) ? offCategoryHints : null,
        },
      };

      onComplete?.(draftRow);
    } catch (e) {
      console.error("[memory-book] finalize threw:", e);
      setError("Something hiccuped on our end. Mind trying once more?");
      setPhase(frontPhoto ? "front-captured" : "intro");
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = phase === "intro" ? 0 : 1;
  const showFrontPlate     = phase !== "processing";
  const showNutritionPlate = phase === "front-captured" || phase === "nutrition-captured";

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: color.cream,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <input
        ref={frontInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleFrontFile(e.target.files?.[0])}
        style={{ display: "none" }}
      />
      <input
        ref={nutritionInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleNutritionFile(e.target.files?.[0])}
        style={{ display: "none" }}
      />

      <motion.div
        // Use the explicit `transform` string instead of framer's `y`
        // shorthand so this animation hands off to CSS and stays
        // smooth even when the main thread is busy (camera permission
        // dialog dismissing, image compression worker spinning up).
        initial={reduceMotion
          ? { opacity: 0 }
          : { transform: "translateY(24px)", opacity: 0 }}
        animate={reduceMotion
          ? { opacity: 1 }
          : { transform: "translateY(0px)", opacity: 1 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: "100%",
          maxWidth: 480,
          margin: "0 auto",
          padding: `${space.xl}px ${space.xl}px ${space.huge}px`,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* Top bar — back arrow + step kicker. Kicker uses DM Mono
            uppercase from tokens.kicker; back is a plain glyph in
            the muted ink so it doesn't shout. */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: space.md,
          marginBottom: space.xl,
        }}>
          <motion.button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            whileTap={reduceMotion ? {} : { scale: 0.94 }}
            transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.pill,
              border: `1px solid ${color.hairline}`,
              background: color.glassFillLite,
              // Match the glass contract every other surface in MCM
              // honors (see pillChip in tokens.js) — without the
              // backdrop blur this pill reads as flat against the
              // photo plates behind it.
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              color: color.ink,
              fontSize: 18,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ←
          </motion.button>
          <div style={{
            fontFamily: font.mono,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: color.warmBrown,
            flex: 1,
          }}>
            Memory Book · Step {stepIndex + 1} of 2
          </div>
        </div>

        <StepBeads step={stepIndex} reduceMotion={reduceMotion} />

        {/* Hero copy — Pale Martini display headline. Two voices:
            display for the invitation, Instrument Serif italic for
            the explanatory line. Step-aware so the same surface
            reads "let's add this" on intro and "one more for the
            label" after the front photo lands. */}
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            // Tightened from 240ms → 180ms each so the ~480ms
            // wait-then-enter total drops into "responsive" territory
            // for the user's primary signal that the step changed.
            // Subtle blur during crossfade bridges the visual gap
            // between exiting and entering text — without it the eye
            // sees two distinct text blocks overlap in place; with it
            // the swap reads as a single voice flowing forward.
            initial={reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: 6, filter: "blur(2px)" }}
            animate={reduceMotion
              ? { opacity: 1 }
              : { opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: -6, filter: "blur(2px)" }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{ marginBottom: space.xl }}
          >
            {phase === "intro" && (
              <>
                <h1 style={{
                  fontFamily: font.display,
                  fontSize: 36,
                  fontWeight: 400,
                  lineHeight: 1.05,
                  letterSpacing: "-0.01em",
                  color: color.ink,
                  margin: 0,
                }}>
                  {retryCue ? "One more try." : "A new piece for the collection."}
                </h1>
                <p style={{
                  fontFamily: font.detail,
                  fontStyle: "italic",
                  fontSize: 16,
                  lineHeight: 1.45,
                  color: color.inkMuted,
                  margin: `${space.md}px 0 0`,
                  maxWidth: 380,
                }}>
                  {retryCue
                    || "Snap the front of the package — we'll read what's on it and tuck it into your memory book so it pairs the moment you scan it again."}
                </p>
              </>
            )}
            {phase === "front-captured" && (
              <>
                <h1 style={{
                  fontFamily: font.display,
                  fontSize: 32,
                  fontWeight: 400,
                  lineHeight: 1.08,
                  letterSpacing: "-0.01em",
                  color: color.ink,
                  margin: 0,
                }}>
                  Got the front. One more?
                </h1>
                <p style={{
                  fontFamily: font.detail,
                  fontStyle: "italic",
                  fontSize: 16,
                  lineHeight: 1.45,
                  color: color.inkMuted,
                  margin: `${space.md}px 0 0`,
                  maxWidth: 380,
                }}>
                  Add the nutrition label so we can fill in the macros — or save this one as is and you'll add the panel later.
                </p>
              </>
            )}
            {phase === "nutrition-captured" && (
              <>
                <h1 style={{
                  fontFamily: font.display,
                  fontSize: 32,
                  fontWeight: 400,
                  lineHeight: 1.08,
                  letterSpacing: "-0.01em",
                  color: color.ink,
                  margin: 0,
                }}>
                  That's the keepsake.
                </h1>
                <p style={{
                  fontFamily: font.detail,
                  fontStyle: "italic",
                  fontSize: 16,
                  lineHeight: 1.45,
                  color: color.inkMuted,
                  margin: `${space.md}px 0 0`,
                  maxWidth: 380,
                }}>
                  Tucking it into your collection now.
                </p>
              </>
            )}
            {phase === "processing" && (
              <>
                <h1 style={{
                  fontFamily: font.display,
                  fontSize: 32,
                  fontWeight: 400,
                  lineHeight: 1.08,
                  letterSpacing: "-0.01em",
                  color: color.ink,
                  margin: 0,
                }}>
                  Reading the label
                </h1>
                <motion.p
                  // 0.55 floor (vs old 0.4) reads as "alive, breathing"
                  // rather than "nearly off." 1.8s cadence sits at
                  // natural inhale-exhale rhythm vs the old 1.6s which
                  // ran a hair fast against the body's unconscious
                  // wait-tempo sync.
                  animate={reduceMotion ? { opacity: 1 } : { opacity: [0.55, 1, 0.55] }}
                  transition={reduceMotion
                    ? { duration: 0 }
                    : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  style={{
                    fontFamily: font.detail,
                    fontStyle: "italic",
                    fontSize: 16,
                    lineHeight: 1.45,
                    color: color.inkMuted,
                    margin: `${space.md}px 0 0`,
                    maxWidth: 380,
                  }}>
                  Pulling the brand, name, and panel detail off your photos.
                </motion.p>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Plates row. Front always renders (intro shows the empty
            tap-area; later phases show the captured photo). The
            nutrition plate fades in after step 1 lands. The plates
            stack vertically rather than side-by-side because the
            sheet is mobile-first and a 4:5 aspect plate is too tall
            to comfortably pair horizontally at 480px. */}
        {showFrontPlate && (
          <div style={{ marginBottom: space.lg }}>
            <CapturePlate
              photoSrc={frontPhoto?.previewUrl || null}
              onTrigger={() => frontInputRef.current?.click()}
              label={frontPhoto ? "Tap to retake" : "Front of the package"}
              sublabel={frontPhoto
                ? null
                : "We'll read the brand, name, and any claims printed on the front."
              }
              reduceMotion={reduceMotion}
            />
          </div>
        )}

        {showNutritionPlate && (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.06 }}
            style={{ marginBottom: space.lg }}
          >
            <CapturePlate
              photoSrc={nutritionPhoto?.previewUrl || null}
              onTrigger={() => nutritionInputRef.current?.click()}
              label={nutritionPhoto ? "Tap to retake" : "Nutrition label"}
              sublabel={nutritionPhoto
                ? null
                : "Optional — adds the per-serving panel to the row."
              }
              reduceMotion={reduceMotion}
            />
          </motion.div>
        )}

        {error && (
          <div style={{
            marginTop: space.md,
            fontFamily: font.detail,
            fontStyle: "italic",
            fontSize: 14,
            color: color.burnt,
          }}>
            {error}
          </div>
        )}

        {/* CTAs. Pinned at the bottom of the column via marginTop:auto
            on this wrapper so the layout's anchor is unambiguous (the
            old flex-1 spacer above + space.xl marginTop here was
            mixed-anchoring; this is single-source). Primary button
            uses the existing ctaButton token (burnt-orange gradient);
            secondary is ghostButton from tokens. Phase-aware so the
            same area renders the right next-action without shuffling
            layout. Every button is a motion.button with whileTap
            scale(0.97) so a press never feels swallowed — the burnt
            CTA in particular sits at the most committed moment of
            the flow, so press feedback there matters most. */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: space.md,
          marginTop: "auto",
          paddingTop: space.xl,
        }}>
          {phase === "intro" && (
            <motion.button
              type="button"
              onClick={() => frontInputRef.current?.click()}
              disabled={busy}
              whileTap={reduceMotion || busy ? {} : { scale: 0.97 }}
              transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              style={{
                ...ctaButton,
                opacity: busy ? 0.6 : 1,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Compressing…" : "Take a photo"}
            </motion.button>
          )}

          {phase === "front-captured" && (
            <>
              <motion.button
                type="button"
                onClick={() => nutritionInputRef.current?.click()}
                disabled={busy}
                whileTap={reduceMotion || busy ? {} : { scale: 0.97 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  ...ctaButton,
                  opacity: busy ? 0.6 : 1,
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                Add the nutrition label
              </motion.button>
              <motion.button
                type="button"
                onClick={() => finalize({ skipNutrition: true })}
                disabled={busy}
                whileTap={reduceMotion || busy ? {} : { scale: 0.97 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  ...ghostButton,
                  opacity: busy ? 0.6 : 1,
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                Save with just the front
              </motion.button>
            </>
          )}

          {phase === "nutrition-captured" && (
            <motion.button
              type="button"
              onClick={() => finalize({ skipNutrition: false })}
              disabled={busy}
              whileTap={reduceMotion || busy ? {} : { scale: 0.97 }}
              transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              style={{
                ...ctaButton,
                opacity: busy ? 0.6 : 1,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              Add to my collection
            </motion.button>
          )}
          {/* No CTA in processing — the pulsing copy is the only signal needed. */}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
