import { useEffect, useRef, useState } from "react";
import { decodeBarcodeFromImage } from "../lib/lookupBarcode";
import { decodeImageFileWithZxing, createZxingLiveScanner } from "../lib/zxing";

// Barcode reader with layered fallbacks (best signal first):
//
//   LIVE SCANNING
//     1a. Native BarcodeDetector (Chrome/Edge/Android, Safari 17+ proper).
//         Fastest, zero bundle cost.
//     1b. @zxing/browser decoder on the same <video> stream when
//         BarcodeDetector isn't exposed (Firefox mobile, older Safari).
//         Lazy-loaded ~200KB dep; free, offline, no API cost.
//
//   PHOTO CAPTURE (for iOS PWA standalone where live-video is blocked)
//     2a. @zxing/browser decoding a still image from <input type="file"
//         capture="environment">. Primary path. Accurate, free, fast.
//     2b. Claude vision edge function (decode-barcode-image) as the
//         fallback when zxing can't decode — handles damaged, faded,
//         or hand-labeled barcodes where bar-pattern reads fail but
//         the human-readable digits are still legible.
//
//   LAST RESORT
//     3. Typed input — user reads the digits and types them.
//
// Emits on the `onDetected(barcode)` callback once per session (the
// stream stops immediately after the first read so we don't spam the
// caller with duplicates). `onCancel` closes without firing. The
// component renders as a full-screen overlay; the caller decides
// when to mount/unmount it.
//
// mode="rapid" keeps the stream open after each detect so Shop Mode
// can fire item after item without closing / reopening the camera.
// The caller is responsible for deciding when to unmount (e.g. when
// the user taps DONE SHOPPING). A 1500ms same-UPC suppression window
// prevents double-fires while the pair sheet is still up.

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "itf"];

export default function BarcodeScanner({ onDetected, onCancel, mode = "single" }) {
  const rapidMode = mode === "rapid";
  const lastRapidRef = useRef({ upc: "", at: 0 });
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const detectorRef = useRef(null);
  const tickRef    = useRef(null);
  const photoInputRef = useRef(null);
  const [typed, setTyped]     = useState("");
  const [state, setState]     = useState("init");  // init | scanning | native_unavailable | camera_denied | error | verify_photo
  const [errMsg, setErrMsg]   = useState("");
  const [decoding, setDecoding] = useState(false);
  const [decodeMsg, setDecodeMsg] = useState("");
  // Zoom + torch capabilities — populated after getUserMedia lands
  // and we've probed the video track. Null = unsupported on this
  // device/browser, don't render the control.
  const [zoomCaps,      setZoomCaps]      = useState(null);   // { min, max, step } | null
  const [zoomValue,     setZoomValue]     = useState(1);      // current zoom level
  const [torchSupported,setTorchSupported]= useState(false);
  const [torchOn,       setTorchOn]       = useState(false);
  const videoTrackRef = useRef(null);                          // MediaStreamTrack for applyConstraints
  // Struggling-nudge state. After N seconds of active scanning with
  // no hit, surface a prominent "try photo instead" suggestion on
  // the live view. Pro barcode apps do this (Walmart, Instacart) —
  // saves the user when their phone can't focus close enough for a
  // small UPC.
  const [strugglingNudge, setStrugglingNudge] = useState(false);
  const struggleTimerRef = useRef(null);

  // Live-scanner boot. Request the camera first, then pick the best
  // detector we can: native BarcodeDetector (free, fastest) if
  // available, else @zxing/browser (lazy-loaded, algorithmic bar-
  // pattern decoding). Both share the same onDetected callback and
  // the same camera stream — only one is active at a time.
  const cancelledRef   = useRef(false);
  const zxingStopRef   = useRef(null);   // { stop: () => void } | null
  const bootCamera = async () => {
    cancelledRef.current = false;
    // Clear any prior stream / detector before re-requesting (retry path).
    stopStream();
    setState("init");

    // Camera access first — needed by EITHER detector. If this
    // fails with a denial, fall through to the photo-capture path
    // without wasting a zxing load.
    //
    // Resolution hint: request 1920x1080 (ideal) instead of the
    // browser default (~640x480). Zxing decodes bar patterns by
    // counting pixels per module (bar) — a small UPC at 640p may
    // have 1-2px per bar, which is below the decode threshold;
    // at 1080p it has 3-5px per bar, which decodes reliably.
    // focusMode "continuous" asks supporting cameras to keep
    // refocusing as the user moves closer / farther, critical for
    // small barcodes that need to be close to fill the frame.
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width:      { ideal: 1920 },
          height:     { ideal: 1080 },
          focusMode:  { ideal: "continuous" },
          frameRate:  { ideal: 30 },
        },
        audio: false,
      });
    } catch (e) {
      console.warn("[barcode] camera grant failed:", e);
      if (!cancelledRef.current) setState("camera_denied");
      return;
    }
    if (cancelledRef.current) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      try { await videoRef.current.play(); } catch { /* autoplay blocked; user tap resumes */ }
    }
    // Probe track capabilities for zoom + torch. Not every browser
    // exposes these (Safari does, Chrome on Android does, Firefox
    // doesn't). Silently skip when absent — the core scanning path
    // doesn't need them, they just help for edge cases.
    try {
      const track = stream.getVideoTracks?.()[0];
      if (track && typeof track.getCapabilities === "function") {
        const caps = track.getCapabilities();
        if (caps?.zoom && typeof caps.zoom.min === "number") {
          setZoomCaps({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
          setZoomValue(caps.zoom.min);
          videoTrackRef.current = track;
        }
        if (caps?.torch) {
          setTorchSupported(true);
          videoTrackRef.current = track;
        }
      }
    } catch (e) {
      // getCapabilities is flaky on some browsers; not fatal.
      console.warn("[barcode] track caps probe failed:", e);
    }
    setState("scanning");
    // Kick off the struggling-nudge timer. If no decode fires within
    // 8s, surface the "try photo instead" hint. Cleared on successful
    // decode, cancel, or scanner teardown.
    if (struggleTimerRef.current) window.clearTimeout(struggleTimerRef.current);
    setStrugglingNudge(false);
    struggleTimerRef.current = window.setTimeout(() => {
      if (!cancelledRef.current) setStrugglingNudge(true);
    }, 8000);

    // Prefer native BarcodeDetector — zero dependency cost, fastest.
    const hasNative = typeof window !== "undefined" && "BarcodeDetector" in window;
    if (hasNative) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = BARCODE_FORMATS.filter(f => supported.includes(f));
        if (formats.length > 0) {
          detectorRef.current = new window.BarcodeDetector({ formats });
          startNativePolling();
          return;
        }
      } catch (e) {
        console.warn("[barcode] native detector init failed, falling back to zxing:", e);
      }
    }

    // Fall back to zxing's live video decoder. Lazy-imports
    // @zxing/browser on first call; cached on module scope after.
    try {
      const scanner = await createZxingLiveScanner(
        videoRef.current,
        (digits) => {
          if (cancelledRef.current) return;
          if (rapidMode) {
            // Keep the stream alive — just bubble the digits up. The
            // zxing wrapper already suppresses same-UPC dupes within
            // 1500ms when opts.continuous is set.
            onDetected?.(digits);
            return;
          }
          stopStream();
          onDetected?.(digits);
        },
        (err) => { console.warn("[barcode] zxing live error:", err); },
        { continuous: rapidMode },
      );
      zxingStopRef.current = scanner;
    } catch (err) {
      // Both paths failed. Release the camera and drop to the
      // photo-capture UI — still useful even without live scanning.
      console.warn("[barcode] zxing fallback failed:", err);
      stopStream();
      if (!cancelledRef.current) setState("native_unavailable");
    }
  };

  // Native BarcodeDetector polling loop. Zxing manages its own loop
  // internally (see createZxingLiveScanner), so this only runs in
  // the native-path branch.
  function startNativePolling() {
    const tick = async () => {
      if (cancelledRef.current) return;
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (video && detector && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          if (codes && codes.length > 0) {
            const raw = String(codes[0].rawValue || "").trim();
            if (/^\d{8,14}$/.test(raw)) {
              if (rapidMode) {
                // Suppress same-UPC re-fires within 1500ms so the pair
                // sheet has time to appear and re-arm before the next
                // scan, even if the same barcode is still in-frame.
                const now = Date.now();
                const isDupe = raw === lastRapidRef.current.upc
                  && (now - lastRapidRef.current.at) < 1500;
                if (!isDupe) {
                  lastRapidRef.current = { upc: raw, at: now };
                  if (!cancelledRef.current) onDetected?.(raw);
                }
                // Keep scanning — don't stopStream in rapid mode.
                tickRef.current = window.setTimeout(tick, 350);
                return;
              }
              stopStream();
              if (!cancelledRef.current) onDetected?.(raw);
              return;
            }
          }
        } catch {
          // Detector occasionally throws on a corrupted frame;
          // swallow and retry.
        }
      }
      tickRef.current = window.setTimeout(tick, 350);
    };
    tickRef.current = window.setTimeout(tick, 350);
  }

  // Called by the "TRY CAMERA AGAIN" button in the denied state.
  // Re-invokes getUserMedia so a user who just unblocked the camera
  // in browser settings can land right back in the scanning UI
  // without reopening the whole modal.
  const retryCamera = () => {
    bootCamera();
  };

  useEffect(() => {
    bootCamera();
    return () => {
      cancelledRef.current = true;
      stopStream();
    };
  }, []);

  function stopStream() {
    if (tickRef.current) {
      window.clearTimeout(tickRef.current);
      tickRef.current = null;
    }
    // Zxing live scanner runs its own loop — stop it explicitly so
    // a pending decodeOnceFromVideoElement promise doesn't fire
    // onDetected after we've closed.
    if (zxingStopRef.current) {
      try { zxingStopRef.current.stop?.(); } catch { /* noop */ }
      zxingStopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    videoTrackRef.current = null;
    setZoomCaps(null);
    setZoomValue(1);
    setTorchSupported(false);
    setTorchOn(false);
    if (struggleTimerRef.current) {
      window.clearTimeout(struggleTimerRef.current);
      struggleTimerRef.current = null;
    }
    setStrugglingNudge(false);
  }

  // Apply a zoom level to the live video track. Most modern mobile
  // browsers support digital zoom via MediaStreamTrack constraints;
  // we probed the capabilities after getUserMedia and stored them
  // in zoomCaps. Zxing decodes the zoomed frames automatically — no
  // recalibration needed, the video stream's pixel data just shifts.
  const applyZoom = async (next) => {
    const track = videoTrackRef.current;
    if (!track || !zoomCaps) return;
    const clamped = Math.max(zoomCaps.min, Math.min(zoomCaps.max, Number(next)));
    setZoomValue(clamped);
    try {
      await track.applyConstraints({ advanced: [{ zoom: clamped }] });
    } catch (e) {
      console.warn("[barcode] zoom apply failed:", e);
    }
  };

  // Flashlight toggle for dim-lit barcodes. Same MediaStreamTrack
  // constraint path as zoom, different capability.
  const toggleTorch = async () => {
    const track = videoTrackRef.current;
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (e) {
      console.warn("[barcode] torch apply failed:", e);
    }
  };

  function handleManualSubmit(e) {
    e?.preventDefault?.();
    const clean = typed.trim();
    if (!/^\d{8,14}$/.test(clean)) {
      setErrMsg("Barcode must be 8–14 digits.");
      return;
    }
    stopStream();
    onDetected?.(clean);
  }

  // Photo-capture fallback. Native camera via <input type="file"
  // capture="environment"> — same mechanism the meal-photo upload
  // uses, which works in every iOS browser including PWA standalone
  // mode (where BarcodeDetector + getUserMedia can both be blocked).
  // File → base64 → decode-barcode-image edge fn (Claude vision reads
  // the digits) → onDetected with the returned barcode.
  async function handlePhotoCapture(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    // Reset the input so selecting the same file twice re-fires onChange.
    if (photoInputRef.current) photoInputRef.current.value = "";
    const mediaType = file.type && /^image\/(jpeg|png|webp)$/.test(file.type)
      ? file.type
      : "image/jpeg";
    setDecoding(true);
    setDecodeMsg("Reading the barcode…");
    try {
      // 1. Try @zxing/browser first — decodes the bar pattern
      //    algorithmically, no API cost, usually more accurate than
      //    vision-based digit OCR. Lazy-loaded on first use.
      const zxingRes = await decodeImageFileWithZxing(file);
      if (zxingRes?.found && zxingRes.barcode) {
        // Populate the typed field with the decoded digits and ask
        // the user to confirm before we hit OFF. Even zxing can
        // misread a damaged label; a quick eyeball check against
        // the printed digits under the bars is cheap. Kill the live
        // stream + flip to the verify view so the user actually sees
        // the digits (if they came here from live scanning, they'd
        // otherwise still be staring at the camera feed).
        stopStream();
        setTyped(zxingRes.barcode);
        setDecodeMsg(
          `Read: ${formatBarcodeDigits(zxingRes.barcode)}\n\n` +
          `Check it matches the digits printed under the barcode on your package. ` +
          `Fix any wrong digits, then tap LOOK UP.`,
        );
        setState("verify_photo");
        return;
      }

      // 2. Zxing couldn't resolve the bar pattern (damaged label,
      //    glare, extreme angle) — fall back to the Claude vision
      //    edge function, which reads the human-readable digits
      //    printed next to the bars. Slower + has an API cost, but
      //    handles cases zxing can't.
      const base64 = await fileToBase64(file);
      const res = await decodeBarcodeFromImage(base64, mediaType);
      if (res?.found && res.barcode) {
        stopStream();
        setTyped(res.barcode);
        setDecodeMsg(
          `Read: ${formatBarcodeDigits(res.barcode)}\n\n` +
          `Check it matches the digits printed under the barcode on your package. ` +
          `Fix any wrong digits, then tap LOOK UP.`,
        );
        setState("verify_photo");
        return;
      }
      // Human-facing reason map. Two buckets — model-readable misses
      // (photo was fine, barcode just wasn't) vs infrastructure
      // failures (edge fn down, API key missing, etc.). The second
      // bucket needs deploy/config action, not a retake.
      const reason = res?.reason === "no_barcode_visible"
        ? "No barcode found in the photo. Retake with the barcode filling more of the frame."
        : res?.reason === "not_a_product"
          ? "That looks like a QR code or something else, not a product barcode."
          : res?.reason === "unreadable"
            ? "Barcode too blurry or cut off. Hold steady, fill the frame, plenty of light."
            : res?.reason === "edge_fn_not_deployed"
              ? "decode-barcode-image edge function isn't deployed. Run: supabase functions deploy decode-barcode-image"
              : res?.reason === "decode_failed"
                ? `Edge function error${res?.status ? ` (${res.status})` : ""}. Check that ANTHROPIC_API_KEY is set: supabase secrets set ANTHROPIC_API_KEY=sk-ant-…${res?.detail ? `\n\nDetail: ${String(res.detail).slice(0, 200)}` : ""}`
                : res?.reason === "empty_response"
                  ? "Decode function returned an empty response. Try redeploying."
                  : `Couldn't decode that photo. ${res?.reason ? `(reason: ${res.reason})` : ""} Try again or type the digits.`;
      setDecodeMsg(reason);
    } catch (err) {
      console.error("[barcode] photo decode failed:", err);
      setDecodeMsg("Photo decode failed. Try again or type the digits.");
    } finally {
      setDecoding(false);
    }
  }

  // Trigger the hidden file input. Separated from the button's inline
  // onClick for clarity and so the same helper can fire from multiple
  // surfaces (native_unavailable state, camera_denied state, etc.).
  function openPhotoCapture() {
    if (photoInputRef.current) photoInputRef.current.click();
  }

  const showTyped = state === "native_unavailable" || state === "camera_denied" || state === "error" || state === "verify_photo";

  return (
    <div style={{
      // Full-screen overlay — must win over every possible parent
      // modal (AddItemModal = 160, ItemCard = 320, LinkIngredient = 340).
      // Confirm layer (350) is the next tier up; stay just below so
      // destructive confirmations can still overlay the scanner.
      position: "fixed", inset: 0, zIndex: 348,
      background: "#000",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        padding: "24px 20px 12px",
        display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid #1e1e1e",
        background: "#0b0b0b",
      }}>
        <button onClick={() => { stopStream(); onCancel?.(); }} style={iconBtn}>←</button>
        <div style={{
          flex: 1, fontFamily: "'DM Mono',monospace", fontSize: 10,
          color: "#c7a8d4", letterSpacing: "0.12em",
        }}>
          SCAN BARCODE
        </div>
        <button onClick={() => { stopStream(); onCancel?.(); }} style={iconBtn}>✕</button>
      </div>
      {!showTyped && (
        <div style={{ position: "relative", flex: 1, overflow: "hidden", background: "#000" }}>
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          {/* Reticle — centered strip where the user lines up the UPC.
              Native detector scans the whole frame, but a visible
              guide improves scan speed because users hold the code
              flatter and at a sensible distance. */}
          <div style={{
            position: "absolute", inset: 0,
            pointerEvents: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: "78%", height: 100,
              border: "2px solid #c7a8d4",
              borderRadius: 10,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
            }} />
          </div>

          {/* Top-right control column — torch + photo-instead.
              Always available during live scanning so users can
              proactively escape the live path without waiting for
              the struggle nudge. */}
          <div style={{
            position: "absolute", top: 14, right: 14,
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {torchSupported && (
              <button
                type="button"
                onClick={toggleTorch}
                style={{
                  width: 44, height: 44, borderRadius: 22,
                  background: torchOn ? "#f5c842" : "rgba(0,0,0,0.6)",
                  color: torchOn ? "#111" : "#f5c842",
                  border: "1px solid rgba(255,255,255,0.2)",
                  fontSize: 18, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                title={torchOn ? "Torch on" : "Torch off"}
              >
                {torchOn ? "💡" : "🔦"}
              </button>
            )}
            <button
              type="button"
              onClick={openPhotoCapture}
              style={{
                width: 44, height: 44, borderRadius: 22,
                background: "rgba(0,0,0,0.6)",
                color: "#c7a8d4",
                border: "1px solid rgba(255,255,255,0.2)",
                fontSize: 18, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              title="Take a photo instead"
            >
              📸
            </button>
          </div>

          {/* Zoom slider — lives at the bottom edge of the video.
              Only rendered when the device's camera supports digital
              zoom via MediaStreamTrack constraints (most modern
              mobile, some desktop webcams). Pulling zoom up lets the
              user fill the reticle with a small barcode without
              moving physically closer (which often puts the code
              under the phone's minimum focal distance). */}
          {zoomCaps && (
            <div style={{
              position: "absolute", bottom: 78, left: 20, right: 20,
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px",
              background: "rgba(0,0,0,0.55)",
              borderRadius: 20,
            }}>
              <span style={{ color: "#c7a8d4", fontSize: 14 }}>🔍</span>
              <input
                type="range"
                min={zoomCaps.min}
                max={zoomCaps.max}
                step={zoomCaps.step}
                value={zoomValue}
                onChange={(e) => applyZoom(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#c7a8d4" }}
              />
              <span style={{
                fontFamily: "'DM Mono',monospace", fontSize: 10,
                color: "#e0d4b8", minWidth: 36, textAlign: "right",
              }}>
                {zoomValue.toFixed(1)}×
              </span>
            </div>
          )}

          {/* Struggling-nudge banner. Fires 8s into active scanning
              without a hit. Pro barcode apps do this (Walmart,
              Instacart) — small barcodes often can't be decoded live
              because the phone's minimum focal distance is longer
              than the distance needed to fill the frame. A still
              photo with dedicated autofocus usually works. */}
          {strugglingNudge && state === "scanning" && (
            <button
              type="button"
              onClick={openPhotoCapture}
              style={{
                position: "absolute", top: 18, left: 18, right: 76,
                padding: "10px 12px",
                background: "rgba(199,168,212,0.95)",
                color: "#111",
                border: "none", borderRadius: 12,
                fontFamily: "'DM Sans',sans-serif", fontSize: 12,
                fontWeight: 600, lineHeight: 1.35,
                textAlign: "left", cursor: "pointer",
                boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
              }}
            >
              Small barcode? Try a photo instead — usually works when live scanning struggles. Tap here →
            </button>
          )}

          <div style={{
            position: "absolute", bottom: 18, left: 0, right: 0,
            textAlign: "center",
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#e0d4b8",
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
          }}>
            {state === "init"     && "Starting camera…"}
            {state === "scanning" && !strugglingNudge && "Point at the barcode on the package"}
          </div>
          {/* Hidden photo input — the torch/photo buttons and the
              struggling nudge all trigger this via openPhotoCapture(). */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoCapture}
            style={{ display: "none" }}
          />
        </div>
      )}
      {showTyped && (
        <div style={{ flex: 1, padding: "28px 20px", overflowY: "auto" }}>
          <div style={{
            fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 300,
            fontStyle: "italic", color: "#f0ece4", marginBottom: 10,
          }}>
            {state === "camera_denied" ? "Camera blocked by browser"
              : state === "verify_photo" ? "Verify the barcode"
              : "Scan the barcode"}
          </div>
          {/* Photo-capture CTA — works on every mobile browser that
              allows the native camera via <input type="file" capture>.
              The same mechanism the app's meal-photo upload uses, so
              iOS PWA standalones that can't do live BarcodeDetector
              still get a working path. On decode miss, inline message
              tells the user why and lets them retry. */}
          <button
            type="button"
            onClick={openPhotoCapture}
            disabled={decoding}
            style={{
              width: "100%", padding: "14px",
              background: decoding
                ? "#2a2a2a"
                : "linear-gradient(135deg, #c7a8d4 0%, #a389b8 100%)",
              color: decoding ? "#666" : "#111",
              border: "none", borderRadius: 12,
              fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
              letterSpacing: "0.1em",
              cursor: decoding ? "wait" : "pointer",
              marginBottom: 12,
            }}
          >
            {decoding ? "READING…" : "📸 TAKE PHOTO OF BARCODE"}
          </button>
          {decodeMsg && !decoding && (
            <div style={{
              marginBottom: 14, padding: "10px 12px",
              background: "#1a1510", border: "1px solid #3a2820",
              borderRadius: 10,
              fontFamily: "'DM Sans',sans-serif", fontSize: 12,
              color: "#e0b090", lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}>
              {decodeMsg}
            </div>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoCapture}
            style={{ display: "none" }}
          />
          {state === "camera_denied" ? (
            // Denied-state UX. The browser saves "block" per origin
            // and there's no JS API to force-forget it — users have
            // to reset it manually in site settings. Explain that
            // clearly + offer a retry (useful if they've since
            // unblocked) + a typed fallback so the scanner's still
            // useful without the camera.
            <>
              <div style={{
                fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888",
                lineHeight: 1.55, marginBottom: 14,
              }}>
                Your browser saved "Block" for the camera on this site — we can't
                override that from the app. To unblock:
              </div>
              <div style={{
                padding: "12px 14px", marginBottom: 14,
                background: "#141414", border: "1px solid #242424",
                borderRadius: 10,
                fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#c7b8a8",
                lineHeight: 1.6,
              }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ color: "#c7a8d4", fontWeight: 600 }}>Chrome / Edge / Arc:</span>{" "}
                  click the 🔒 or ⓘ icon left of the URL → Site settings → Camera → Allow. Reload.
                </div>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ color: "#c7a8d4", fontWeight: 600 }}>Safari (macOS):</span>{" "}
                  Safari → Settings → Websites → Camera → find this site → Allow. Reload.
                </div>
                <div>
                  <span style={{ color: "#c7a8d4", fontWeight: 600 }}>Firefox:</span>{" "}
                  🔒 icon left of URL → Connection secure → More information → Permissions → Camera → clear "Use default" or set Allow.
                </div>
              </div>
              <button
                type="button"
                onClick={retryCamera}
                style={{
                  width: "100%", padding: "11px",
                  background: "transparent", border: "1px solid #3a3a3a",
                  color: "#c7a8d4", borderRadius: 10,
                  fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 600,
                  letterSpacing: "0.1em", cursor: "pointer",
                  marginBottom: 18,
                }}
              >
                ↻ TRY CAMERA AGAIN
              </button>
            </>
          ) : (
            <div style={{
              fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888",
              lineHeight: 1.5, marginBottom: 16,
            }}>
              {state === "native_unavailable"
                ? "Your browser can't do live barcode scanning. Snap a photo instead — we'll read the digits off it. Or type them yourself."
                : "Something went wrong with the live scanner. Take a photo instead, or type the digits."}
            </div>
          )}
          <div style={{
            fontFamily: "'DM Mono',monospace", fontSize: 9,
            color: "#666", letterSpacing: "0.1em",
            marginBottom: 10,
          }}>
            OR TYPE THE BARCODE
          </div>
          <form onSubmit={handleManualSubmit}>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              pattern="\d*"
              value={typed}
              onChange={(e) => { setTyped(e.target.value.replace(/\D/g, "")); setErrMsg(""); }}
              placeholder="e.g. 3017620422003"
              maxLength={14}
              style={{
                width: "100%", padding: "14px 16px",
                background: "#1a1a1a", border: "1px solid #2a2a2a",
                borderRadius: 10, color: "#f0ece4", boxSizing: "border-box",
                fontFamily: "'DM Mono',monospace", fontSize: 18,
                letterSpacing: "0.08em", outline: "none",
              }}
            />
            {errMsg && (
              <div style={{
                marginTop: 8,
                fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: "#e07a3a",
              }}>
                {errMsg}
              </div>
            )}
            <button
              type="submit"
              disabled={!typed}
              style={{
                marginTop: 16, width: "100%", padding: "14px",
                background: typed ? "linear-gradient(135deg, #c7a8d4 0%, #a389b8 100%)" : "#2a2a2a",
                color: typed ? "#111" : "#666",
                border: "none", borderRadius: 12,
                fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
                letterSpacing: "0.1em",
                cursor: typed ? "pointer" : "not-allowed",
              }}
            >
              LOOK UP
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// Format a raw digit string into the grouped display under a real
// barcode ("0 12345 67890 5" for UPC-A) so the user can line it up
// against the package digit-for-digit. Fall back to the raw string
// when the length doesn't match a known structure.
function formatBarcodeDigits(raw) {
  if (!raw || typeof raw !== "string") return raw || "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 12) return `${d[0]} ${d.slice(1, 6)} ${d.slice(6, 11)} ${d[11]}`;   // UPC-A
  if (d.length === 13) return `${d[0]} ${d.slice(1, 7)} ${d.slice(7)}`;                 // EAN-13
  if (d.length === 8)  return `${d.slice(0, 4)} ${d.slice(4)}`;                         // EAN-8 / UPC-E
  if (d.length === 14) return `${d[0]} ${d.slice(1, 4)} ${d.slice(4, 9)} ${d.slice(9)}`; // ITF-14
  return d;
}

// Read a File as a base64 string (no data: prefix), matching the edge
// function's expected payload. FileReader's dataURL result is
// "data:<mime>;base64,<payload>"; we strip through the first comma.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

const iconBtn = {
  background: "#161616", border: "1px solid #2a2a2a",
  borderRadius: 18, width: 34, height: 34,
  color: "#aaa", fontSize: 16, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  lineHeight: 1,
};
