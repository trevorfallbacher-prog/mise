import { useEffect, useRef, useState } from "react";
import { decodeBarcodeFromImage } from "../lib/lookupBarcode";

// Barcode reader with three fallback layers:
//   1. Live BarcodeDetector (Chrome/Edge/Android, Safari 17+ proper).
//   2. Photo-capture via <input type="file" capture="environment"> →
//      Claude vision decodes the human-readable digits printed below
//      the bars. Works on iOS PWA standalone mode and any browser
//      with camera access, even when BarcodeDetector is missing.
//   3. Typed input — the user reads the digits and types them.
//
// Emits on the `onDetected(barcode)` callback once per session (the
// stream stops immediately after the first read so we don't spam the
// caller with duplicates). `onCancel` closes without firing. The
// component renders as a full-screen overlay; the caller decides
// when to mount/unmount it.

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "itf"];

export default function BarcodeScanner({ onDetected, onCancel }) {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const detectorRef = useRef(null);
  const tickRef    = useRef(null);
  const photoInputRef = useRef(null);
  const [typed, setTyped]     = useState("");
  const [state, setState]     = useState("init");  // init | scanning | native_unavailable | camera_denied | error
  const [errMsg, setErrMsg]   = useState("");
  const [decoding, setDecoding] = useState(false);
  const [decodeMsg, setDecodeMsg] = useState("");

  // Native-first boot. Extracted into a ref-stable function so the
  // "TRY CAMERA AGAIN" button in the denied state can re-run the
  // same sequence — useful for the user who came back after
  // unblocking the camera in browser settings.
  const cancelledRef = useRef(false);
  const bootCamera = async () => {
    cancelledRef.current = false;
    // Clear any prior stream before re-requesting (retry path).
    stopStream();
    setState("init");

    // Feature detect. `window.BarcodeDetector` is a bare class;
    // some browsers implement the constructor but not the
    // getSupportedFormats call, so we guard both.
    const hasNative = typeof window !== "undefined" && "BarcodeDetector" in window;
    if (!hasNative) {
      setState("native_unavailable");
      return;
    }
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = BARCODE_FORMATS.filter(f => supported.includes(f));
      if (formats.length === 0) {
        setState("native_unavailable");
        return;
      }
      detectorRef.current = new window.BarcodeDetector({ formats });
    } catch (e) {
      console.warn("[barcode] detector init failed:", e);
      setState("native_unavailable");
      return;
    }
    // Request the back camera — UPC scanning is rear-facing and
    // `facingMode: "environment"` tells mobile browsers to default
    // to it.
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
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
    setState("scanning");
    // Detection loop — poll every ~350ms. Native impls are slow
    // under heavy CPU; tighter polling melts batteries without
    // improving hit rate.
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
  };

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
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

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
      const base64 = await fileToBase64(file);
      const res = await decodeBarcodeFromImage(base64, mediaType);
      if (res?.found && res.barcode) {
        stopStream();
        onDetected?.(res.barcode);
        return;
      }
      // Human-facing reason map — the edge fn returns machine strings.
      const reason = res?.reason === "no_barcode_visible"
        ? "No barcode found in the photo. Try again with the barcode filling more of the frame."
        : res?.reason === "not_a_product"
          ? "That looks like a QR code or something else, not a product barcode."
          : res?.reason === "unreadable"
            ? "Barcode too blurry or cut off. Hold steady, fill the frame, plenty of light."
            : "Couldn't decode that photo. Try again or type the digits.";
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

  const showTyped = state === "native_unavailable" || state === "camera_denied" || state === "error";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
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
          <div style={{
            position: "absolute", bottom: 18, left: 0, right: 0,
            textAlign: "center",
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#e0d4b8",
            textShadow: "0 1px 2px rgba(0,0,0,0.8)",
          }}>
            {state === "init"     && "Starting camera…"}
            {state === "scanning" && "Point at the barcode on the package"}
          </div>
        </div>
      )}
      {showTyped && (
        <div style={{ flex: 1, padding: "28px 20px", overflowY: "auto" }}>
          <div style={{
            fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 300,
            fontStyle: "italic", color: "#f0ece4", marginBottom: 10,
          }}>
            {state === "camera_denied" ? "Camera blocked by browser" : "Scan the barcode"}
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
