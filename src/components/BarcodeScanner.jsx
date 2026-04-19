import { useEffect, useRef, useState } from "react";

// Barcode reader. Uses the native BarcodeDetector API when available
// (Chrome, Edge, Android WebView, recent Safari/iOS) and falls back
// to a typed-input surface when it isn't — the user reads the barcode
// off the package and types it in.
//
// Emits on the `onDetected(barcode)` callback once per session (the
// stream stops immediately after the first read so we don't spam the
// caller with duplicates). `onCancel` closes without firing. The
// component renders as a full-screen overlay; the caller decides
// when to mount/unmount it.
//
// Supported formats map to the EAN/UPC families that OFF indexes:
//   ean_13, ean_8, upc_a, upc_e, itf (ITF-14 for cases of goods)
// QR / pdf_417 / etc are deliberately OMITTED — the lookup edge fn
// validates digits-only 8-14 chars, and we don't want to show a
// hit on a QR code that routes somewhere irrelevant.

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "itf"];

export default function BarcodeScanner({ onDetected, onCancel }) {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const detectorRef = useRef(null);
  const tickRef    = useRef(null);
  const [typed, setTyped]     = useState("");
  const [state, setState]     = useState("init");  // init | scanning | native_unavailable | camera_denied | error
  const [errMsg, setErrMsg]   = useState("");

  // Native-first boot. If the API or the camera grant isn't there,
  // fall back to the typed-input surface without showing a camera
  // error — the user can still enter the number manually.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Feature detect. `window.BarcodeDetector` is a bare class;
      // some browsers implement the constructor but not the
      // getSupportedFormats call, so we guard both.
      const hasNative = typeof window !== "undefined" && "BarcodeDetector" in window;
      if (!hasNative) {
        setState("native_unavailable");
        return;
      }
      try {
        // Some browsers advertise BarcodeDetector but don't support
        // every format. Intersect our request list with what the
        // browser exposes.
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
      // Request the back camera if possible — UPC scanning is a
      // rear-facing-camera task and `facingMode: "environment"`
      // tells mobile browsers to default to it.
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (e) {
        console.warn("[barcode] camera grant failed:", e);
        if (!cancelled) setState("camera_denied");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch { /* autoplay blocked; user tap will resume */ }
      }
      setState("scanning");
      // Detection loop — poll every ~350ms. Native impls are slow
      // under heavy CPU; tighter polling melts batteries without
      // improving hit rate.
      const tick = async () => {
        if (cancelled) return;
        const video = videoRef.current;
        const detector = detectorRef.current;
        if (video && detector && video.readyState >= 2) {
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length > 0) {
              const raw = String(codes[0].rawValue || "").trim();
              if (/^\d{8,14}$/.test(raw)) {
                // Stop the stream before firing the callback so the
                // camera indicator drops immediately.
                stopStream();
                if (!cancelled) onDetected?.(raw);
                return;
              }
            }
          } catch (e) {
            // Detector occasionally throws on a corrupted frame;
            // swallow and retry.
          }
        }
        tickRef.current = window.setTimeout(tick, 350);
      };
      tickRef.current = window.setTimeout(tick, 350);
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            Type the barcode
          </div>
          <div style={{
            fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#888",
            lineHeight: 1.5, marginBottom: 20,
          }}>
            {state === "native_unavailable"
              ? "Your browser doesn't support camera barcode scanning. Read the digits off the package and type them here."
              : state === "camera_denied"
                ? "Camera access wasn't granted. Type the barcode in, or allow the camera and reopen the scanner."
                : "Something went wrong with the camera. Type it in."}
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

const iconBtn = {
  background: "#161616", border: "1px solid #2a2a2a",
  borderRadius: 18, width: 34, height: 34,
  color: "#aaa", fontSize: 16, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  lineHeight: 1,
};
