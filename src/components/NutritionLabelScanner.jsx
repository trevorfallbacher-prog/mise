import { useEffect, useRef, useState } from "react";
import ModalSheet from "./ModalSheet";
import { Z } from "../lib/tokens";
import { compressImage } from "../lib/compressImage";
import { supabase } from "../lib/supabase";

/**
 * NutritionLabelScanner — a photo-to-nutrition flow powered by the
 * `scan-nutrition-label` edge function (Sonnet vision).
 *
 * Lifecycle (phases):
 *
 *   idle       — hero CTA: "📸 TAKE PHOTO" + "📁 UPLOAD". Hidden file
 *                input with `capture="environment"` opens the phone
 *                camera on mobile.
 *   compressing — client-side compression to 2000px / 0.95 JPEG
 *                quality (OCR-grade; label text is 6-7pt and needs
 *                the resolution). Short-lived (~100ms).
 *   scanning   — shows a preview of the photo behind an animated
 *                scanline + "Reading the label…" status. Sonnet
 *                vision takes 3-6s for a full label.
 *   result     — (parent takes over) — hands the extracted block to
 *                NutritionOverrideSheet pre-filled; this component
 *                closes itself.
 *   error      — surfaces the reason + "TRY AGAIN" + "TYPE IT IN".
 *                Never strands the user.
 *
 * Props:
 *   item                 — pantry row ({ name, ingredientId, brand, ... })
 *   onClose()            — dismiss the scanner
 *   onComplete(payload)  — called with the normalized scan payload when
 *                          Sonnet returns a usable block:
 *     {
 *       nutritionBlock:  <validated block in our schema>,
 *       packageInfo:     { serving_g, servings_per_container, net_weight } | null,
 *       scanId:          <client-generated UUID for brand_nutrition.source_id>,
 *       photoPreviewUrl: <object URL for the thumbnail>,
 *       confidence:      "high" | "medium" | "low",
 *       notes:           string | null,
 *     }
 *   onManualFallback()   — optional — user chose "type it in instead"
 *                          after an error. Parent should open the
 *                          NutritionOverrideSheet in manual mode.
 */
const GOLD   = "#f5c842";
const GOLD_D = "#3a2f10";
const INK    = "#f0ece4";

export default function NutritionLabelScanner({
  item,
  onClose,
  onComplete,
  onManualFallback,
}) {
  const [phase, setPhase] = useState("idle"); // idle | compressing | scanning | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const [statusLine, setStatusLine] = useState("Reading the label…");
  const fileRef = useRef(null);
  const galleryRef = useRef(null);
  const createdUrlsRef = useRef([]);

  // Revoke any object URLs we minted when the sheet unmounts so
  // we don't leak blobs across scans.
  useEffect(() => {
    return () => {
      for (const url of createdUrlsRef.current) {
        try { URL.revokeObjectURL(url); } catch { /* noop */ }
      }
    };
  }, []);

  // Progressive status line during the Sonnet call. Pure cosmetic,
  // but keeping the user entertained during a 3-6s vision call is
  // worth a few lines of timers. Cleared when phase leaves "scanning".
  useEffect(() => {
    if (phase !== "scanning") return;
    const ticks = [
      [0,    "Reading the label…"],
      [1200, "Matching Calories, Fat, Carbs, Protein…"],
      [2600, "Picking up Vitamin D, Iron, Potassium…"],
      [4400, "Cross-checking added sugars…"],
      [6200, "Almost there — rounding the numbers…"],
    ];
    const timers = ticks.map(([ms, text]) =>
      setTimeout(() => setStatusLine(text), ms),
    );
    return () => { timers.forEach(clearTimeout); };
  }, [phase]);

  const handleFile = async (file) => {
    if (!file) return;
    setErrorMsg(null);
    setPhase("compressing");

    // Object URL for preview — cheap, revoked on unmount.
    let previewUrl = null;
    try {
      previewUrl = URL.createObjectURL(file);
      createdUrlsRef.current.push(previewUrl);
      setPhotoPreviewUrl(previewUrl);
    } catch { /* noop */ }

    // OCR-grade compression — bumps the receipt-scan defaults because
    // label text is tiny (6-7pt printed). 2000px + 0.95 quality keeps
    // every digit legible; compressImage strips EXIF as a free privacy
    // win.
    let imageData;
    try {
      imageData = await compressImage(file, {
        maxDimension: 2000,
        jpegQuality: 0.95,
      });
    } catch (err) {
      setErrorMsg("Couldn't open that photo — try again or pick a different one.");
      setPhase("error");
      return;
    }

    setPhase("scanning");
    setStatusLine("Reading the label…");

    let resp;
    try {
      resp = await supabase.functions.invoke("scan-nutrition-label", {
        body: {
          image:          imageData.base64,
          mediaType:      imageData.mediaType,
          hintCanonicalId: item?.ingredientId || null,
          hintBrand:      item?.brand || null,
        },
      });
    } catch (err) {
      setErrorMsg("Couldn't reach the label scanner. Check your connection and try again.");
      setPhase("error");
      return;
    }

    if (resp.error) {
      setErrorMsg(resp.error?.message || "The scanner couldn't process that photo.");
      setPhase("error");
      return;
    }

    const data = resp.data;
    if (!data || data.ok === false) {
      setErrorMsg(
        data?.reason
          ? capitalize(data.reason) + "."
          : "Couldn't read this label — try again with better light, or type it in.",
      );
      setPhase("error");
      return;
    }

    // Normalize into the NutritionOverrideSheet's initialValues shape.
    // Pass both FDA-named fields (total_fat_g, total_sugar_g) and our
    // legacy alias fields (fat_g, sugar_g) — validateNutrition mirrors
    // them but seeding both ensures the form renders populated even if
    // the validator hasn't run yet.
    const n = data.nutrition || {};
    const block = {
      per: data.per || "serving",
    };
    if (data.per === "serving" && data.serving_g != null) {
      block.serving_g = data.serving_g;
    }
    const copy = (src, dst) => { if (n[src] != null) block[dst] = n[src]; };
    copy("kcal",             "kcal");
    copy("total_fat_g",      "total_fat_g");
    copy("total_fat_g",      "fat_g");            // alias
    copy("saturated_fat_g",  "saturated_fat_g");
    copy("trans_fat_g",      "trans_fat_g");
    copy("cholesterol_mg",   "cholesterol_mg");
    copy("sodium_mg",        "sodium_mg");
    copy("carb_g",           "carb_g");
    copy("fiber_g",          "fiber_g");
    copy("total_sugar_g",    "total_sugar_g");
    copy("total_sugar_g",    "sugar_g");          // alias
    copy("added_sugar_g",    "added_sugar_g");
    copy("protein_g",        "protein_g");
    copy("vitamin_d_mcg",    "vitamin_d_mcg");
    copy("calcium_mg",       "calcium_mg");
    copy("iron_mg",          "iron_mg");
    copy("potassium_mg",     "potassium_mg");

    const packageInfo = (data.serving_g || data.servings_per_container || data.net_weight)
      ? {
          serving_g:              data.serving_g ?? null,
          servings_per_container: data.servings_per_container ?? null,
          net_weight:             data.net_weight ?? null,
        }
      : null;

    const scanId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `scan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    onComplete?.({
      nutritionBlock:  block,
      packageInfo,
      scanId,
      photoPreviewUrl: previewUrl,
      confidence:      data.confidence || "medium",
      notes:           data.notes || null,
    });
  };

  const triggerCamera  = () => fileRef.current?.click();
  const triggerGallery = () => galleryRef.current?.click();
  const tryAgain = () => {
    setErrorMsg(null);
    setPhotoPreviewUrl(null);
    setPhase("idle");
  };

  return (
    <ModalSheet
      onClose={onClose}
      zIndex={Z.picker}
      label="SCAN NUTRITION LABEL"
      swipeable={phase !== "scanning"}
    >
      <style>{SCANNER_KEYFRAMES}</style>

      {/* Hidden inputs — one with capture="environment" for the rear
          camera, one without for gallery pick. Mobile fires the camera
          directly; desktop falls through to the file picker. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleFile(e.target.files?.[0])}
        style={{ display: "none" }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        onChange={(e) => handleFile(e.target.files?.[0])}
        style={{ display: "none" }}
      />

      <div style={{ padding: "4px 22px 22px" }}>
        {phase === "idle" && (
          <IdleHero
            item={item}
            onCamera={triggerCamera}
            onGallery={triggerGallery}
            onManualFallback={onManualFallback}
          />
        )}

        {(phase === "compressing" || phase === "scanning") && (
          <ScanningHero
            photoPreviewUrl={photoPreviewUrl}
            statusLine={phase === "compressing" ? "Preparing photo…" : statusLine}
          />
        )}

        {phase === "error" && (
          <ErrorCard
            message={errorMsg}
            onRetry={tryAgain}
            onManualFallback={onManualFallback}
          />
        )}
      </div>
    </ModalSheet>
  );
}

function IdleHero({ item, onCamera, onGallery, onManualFallback }) {
  return (
    <>
      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 10,
        color: GOLD, letterSpacing: "0.14em", fontWeight: 700,
        marginBottom: 8, animation: "scanFadeUp 320ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}>
        ✨ POWERED BY SONNET VISION
      </div>
      <h2 style={{
        fontFamily: "'Fraunces',serif", fontSize: 30,
        fontStyle: "italic", color: INK,
        fontWeight: 400, lineHeight: 1.15,
        margin: "0 0 10px",
        animation: "scanFadeUp 360ms 40ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
      }}>
        Snap the <span style={{ color: GOLD }}>Nutrition Facts</span>
        {item?.name ? <> for {item.name}</> : null}.
      </h2>
      <p style={{
        fontFamily: "'DM Sans',sans-serif", fontSize: 13,
        color: "#a8a39b", lineHeight: 1.5, margin: "0 0 22px",
        animation: "scanFadeUp 360ms 80ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
      }}>
        We read every line — Calories, macros, micronutrients, serving
        size, servings per container — and fill the rest of the app in
        one tap. No more typing labels by hand.
      </p>

      {/* Hero illustration — stylized nutrition label with a gold
          scanline sweep. Pure CSS, no asset deps. */}
      <NutritionLabelIllustration />

      <div style={{
        display: "flex", flexDirection: "column", gap: 10,
        marginTop: 22,
        animation: "scanFadeUp 400ms 180ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
      }}>
        <button
          type="button"
          onClick={onCamera}
          style={{
            width: "100%", padding: "16px 18px",
            background: `linear-gradient(135deg, ${GOLD} 0%, #f0b838 100%)`,
            border: "none", borderRadius: 14,
            fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 700,
            color: "#111",
            letterSpacing: "0.1em",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            boxShadow: `0 12px 30px -12px ${GOLD}88, inset 0 1px 0 rgba(255,255,255,0.3)`,
            transition: "transform 0.12s ease",
          }}
          onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.98)"; }}
          onMouseUp={(e)   => { e.currentTarget.style.transform = "scale(1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          <span style={{ fontSize: 18 }}>📸</span>
          TAKE PHOTO
        </button>
        <button
          type="button"
          onClick={onGallery}
          style={{
            width: "100%", padding: "13px 16px",
            background: "#141414", border: "1px solid #2a2a2a",
            borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
            color: "#c8c4bd", letterSpacing: "0.1em",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "all 0.14s ease",
          }}
        >
          <span style={{ fontSize: 13 }}>📁</span>
          UPLOAD FROM GALLERY
        </button>
        {onManualFallback && (
          <button
            type="button"
            onClick={onManualFallback}
            style={{
              width: "100%", padding: "10px",
              background: "transparent", border: "none",
              color: "#666",
              fontFamily: "'DM Sans',sans-serif", fontSize: 12,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
              textDecorationColor: "#333",
            }}
          >
            or type it in manually
          </button>
        )}
      </div>

      <div style={{
        marginTop: 18, padding: "10px 12px",
        background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 10,
        display: "flex", alignItems: "flex-start", gap: 10,
      }}>
        <span style={{ fontSize: 14, marginTop: 1 }}>💡</span>
        <div style={{
          fontFamily: "'DM Sans',sans-serif", fontSize: 11,
          color: "#888", lineHeight: 1.55,
        }}>
          Hold the phone steady, fill the frame with the Nutrition
          Facts panel, and keep it flat. Glare is OK — we handle it.
        </div>
      </div>
    </>
  );
}

function ScanningHero({ photoPreviewUrl, statusLine }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "8px 0",
      animation: "scanFadeUp 260ms cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 10,
        color: GOLD, letterSpacing: "0.14em", fontWeight: 700,
        marginBottom: 10,
      }}>
        📸 SCANNING
      </div>

      {/* Photo preview + animated scanline. The scanline sweeps
          vertically over the label to visually represent the model
          reading each row in turn. */}
      <div style={{
        position: "relative",
        width: "100%", maxWidth: 320,
        borderRadius: 16, overflow: "hidden",
        border: `1px solid ${GOLD}44`,
        background: "#080808",
        boxShadow: `0 20px 60px -20px ${GOLD}55, 0 0 0 1px ${GOLD}22`,
        marginBottom: 18,
      }}>
        {photoPreviewUrl ? (
          <img
            src={photoPreviewUrl}
            alt="Your label"
            style={{
              width: "100%",
              maxHeight: 360,
              objectFit: "cover",
              display: "block",
              filter: "saturate(0.92) contrast(1.02)",
            }}
          />
        ) : (
          <div style={{ width: "100%", aspectRatio: "3/4", background: "#0c0c0c" }} />
        )}

        {/* Scanline sweep */}
        <div style={{
          position: "absolute", left: 0, right: 0,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
          boxShadow: `0 0 18px ${GOLD}, 0 0 32px ${GOLD}99`,
          animation: "scanSweep 1800ms cubic-bezier(0.65, 0, 0.35, 1) infinite",
          pointerEvents: "none",
        }} />

        {/* Subtle grid overlay for the "being analyzed" feel */}
        <div style={{
          position: "absolute", inset: 0,
          background: `
            linear-gradient(0deg,   transparent 50%, ${GOLD}06 50%),
            linear-gradient(90deg,  transparent 50%, ${GOLD}06 50%)
          `,
          backgroundSize: "24px 24px",
          mixBlendMode: "screen",
          pointerEvents: "none",
        }} />

        {/* Corner crop marks */}
        <CornerMark pos="tl" />
        <CornerMark pos="tr" />
        <CornerMark pos="bl" />
        <CornerMark pos="br" />
      </div>

      {/* Status line — rotates through progressive hints */}
      <div style={{
        fontFamily: "'Fraunces',serif", fontSize: 16,
        fontStyle: "italic", color: INK,
        textAlign: "center", lineHeight: 1.35,
        minHeight: 44,
        transition: "opacity 0.3s ease",
      }}>
        {statusLine}
      </div>

      {/* Three-dot pulse */}
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: 3,
            background: GOLD,
            animation: `scanDot 1200ms ${i * 180}ms ease-in-out infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

function CornerMark({ pos }) {
  const isTop    = pos.startsWith("t");
  const isLeft   = pos.endsWith("l");
  return (
    <div style={{
      position: "absolute",
      [isTop ? "top" : "bottom"]:  10,
      [isLeft ? "left" : "right"]: 10,
      width: 18, height: 18,
      borderTop:    isTop  ? `2px solid ${GOLD}` : "none",
      borderBottom: !isTop ? `2px solid ${GOLD}` : "none",
      borderLeft:   isLeft ? `2px solid ${GOLD}` : "none",
      borderRight:  !isLeft ? `2px solid ${GOLD}` : "none",
      borderTopLeftRadius:     isTop && isLeft ? 4 : 0,
      borderTopRightRadius:    isTop && !isLeft ? 4 : 0,
      borderBottomLeftRadius:  !isTop && isLeft ? 4 : 0,
      borderBottomRightRadius: !isTop && !isLeft ? 4 : 0,
      opacity: 0.85,
      pointerEvents: "none",
    }} />
  );
}

function NutritionLabelIllustration() {
  return (
    <div style={{
      position: "relative",
      margin: "0 auto",
      width: 190, height: 230,
      background: "#f7f3e9",
      border: "3px solid #1a1a1a",
      borderRadius: 10,
      padding: "10px 12px",
      color: "#111",
      fontFamily: "'Arial Black','Helvetica Neue',sans-serif",
      boxShadow: `0 30px 60px -30px rgba(0,0,0,0.8), 0 0 0 1px ${GOLD}22`,
      overflow: "hidden",
      animation: "scanTilt 4800ms ease-in-out infinite",
    }}>
      {/* Label header */}
      <div style={{ fontSize: 13, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.02em" }}>
        Nutrition Facts
      </div>
      <div style={{ borderBottom: "6px solid #111", margin: "4px 0 3px" }} />
      <div style={{ fontSize: 7, fontWeight: 600 }}>8 servings per container</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, fontWeight: 800 }}>
        <span>Serving size</span>
        <span>2/3 cup (55g)</span>
      </div>
      <div style={{ borderBottom: "8px solid #111", margin: "3px 0" }} />
      <div style={{ fontSize: 5, fontWeight: 700 }}>Amount per serving</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 10, fontWeight: 900 }}>Calories</span>
        <span style={{ fontSize: 18, fontWeight: 900, lineHeight: 1 }}>230</span>
      </div>
      <div style={{ borderBottom: "2px solid #111", margin: "3px 0" }} />

      {[
        ["Total Fat",      "8g"],
        ["Saturated Fat",  "1g"],
        ["Cholesterol",    "0mg"],
        ["Sodium",         "160mg"],
        ["Total Carb.",    "37g"],
        ["Dietary Fiber",  "4g"],
        ["Total Sugars",   "12g"],
        ["Protein",        "3g"],
      ].map(([k, v]) => (
        <div key={k} style={{
          display: "flex", justifyContent: "space-between",
          fontSize: 7, fontWeight: 700,
          borderBottom: "1px solid #111",
          padding: "1px 0",
        }}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}

      {/* Scanline sweep across the label */}
      <div style={{
        position: "absolute", left: 0, right: 0,
        height: 3,
        background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
        boxShadow: `0 0 12px ${GOLD}, 0 0 24px ${GOLD}99`,
        animation: "scanSweep 2400ms cubic-bezier(0.65, 0, 0.35, 1) infinite",
        pointerEvents: "none",
      }} />

      {/* Corner crops */}
      <CornerMark pos="tl" />
      <CornerMark pos="tr" />
      <CornerMark pos="bl" />
      <CornerMark pos="br" />
    </div>
  );
}

function ErrorCard({ message, onRetry, onManualFallback }) {
  return (
    <div style={{
      padding: "4px 0",
      animation: "scanFadeUp 280ms cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      <div style={{
        fontFamily: "'DM Mono',monospace", fontSize: 10,
        color: "#f87171", letterSpacing: "0.14em", fontWeight: 700,
        marginBottom: 8,
      }}>
        ⚠ COULDN'T READ IT
      </div>
      <h2 style={{
        fontFamily: "'Fraunces',serif", fontSize: 22,
        fontStyle: "italic", color: INK, fontWeight: 400,
        lineHeight: 1.2, margin: "0 0 10px",
      }}>
        The scanner got stuck.
      </h2>
      <div style={{
        padding: "12px 14px",
        background: "#1a0f0f", border: "1px solid #3a1a1a",
        borderRadius: 10,
        fontFamily: "'DM Sans',sans-serif", fontSize: 13,
        color: "#f0ece4", lineHeight: 1.5,
        marginBottom: 16,
      }}>
        {message || "Something went wrong — try a clearer photo, or type it in."}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          type="button"
          onClick={onRetry}
          style={{
            width: "100%", padding: "14px 16px",
            background: GOLD, border: "none", borderRadius: 12,
            fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
            color: "#111", letterSpacing: "0.1em",
            cursor: "pointer",
            boxShadow: `0 8px 24px -10px ${GOLD}aa`,
          }}
        >
          📸 TRY ANOTHER PHOTO
        </button>
        {onManualFallback && (
          <button
            type="button"
            onClick={onManualFallback}
            style={{
              width: "100%", padding: "12px 16px",
              background: "#141414", border: "1px solid #2a2a2a",
              borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
              color: "#c8c4bd", letterSpacing: "0.1em",
              cursor: "pointer",
            }}
          >
            ✎ TYPE IT IN INSTEAD
          </button>
        )}
      </div>
    </div>
  );
}

function capitalize(s) {
  if (!s || typeof s !== "string") return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Keyframes — scoped via an injected <style> so we don't pollute
// a global stylesheet.
const SCANNER_KEYFRAMES = `
@keyframes scanSweep {
  0%   { top: 0%;   opacity: 0; }
  10%  {            opacity: 1; }
  90%  {            opacity: 1; }
  100% { top: 100%; opacity: 0; }
}
@keyframes scanDot {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
  40%           { opacity: 1;    transform: scale(1.1); }
}
@keyframes scanFadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes scanTilt {
  0%, 100% { transform: rotate(-1.5deg); }
  50%      { transform: rotate(1.5deg); }
}
`;
