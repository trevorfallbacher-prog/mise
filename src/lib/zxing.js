// Client-side barcode decoding via @zxing/browser.
//
// Open-source port of Google's ZXing decoder. Unlike the Claude vision
// edge function (which reads the PRINTED digits off the photo via OCR),
// zxing decodes the actual bar pattern algorithmically — faster, free,
// offline, and more accurate. Used as the PRIMARY path for both still-
// image decoding and live-video scanning, with the vision edge fn kept
// as a last-resort fallback for edge cases zxing can't handle.
//
// Two-layer lazy loading:
//   * The full `@zxing/browser` module (~200KB uncompressed, ~70KB gzip)
//     is imported dynamically the first time a decode is requested, so
//     users who never open the scanner don't pay the bundle cost.
//   * Cached on the module scope after first load so subsequent calls
//     are instant.

let readerPromise = null;
function loadReader() {
  if (!readerPromise) {
    readerPromise = import("@zxing/browser")
      .then((mod) => mod)
      .catch((err) => {
        console.error("[zxing] lazy import failed:", err);
        readerPromise = null;   // allow retry on next call
        throw err;
      });
  }
  return readerPromise;
}

// Decode a File (from <input type="file">) into a barcode. Returns
//   { found: true, barcode, format } on success
//   { found: false, reason }       on miss / error
// Resulting barcode is pure digits matching what OFF / lookup-barcode
// expects. Rejects non-digit formats (QR, data matrix) so a URL or
// payload code can't masquerade as a UPC.
export async function decodeImageFileWithZxing(file) {
  if (!file) return { found: false, reason: "no_file" };
  let browser;
  try {
    browser = await loadReader();
  } catch {
    return { found: false, reason: "zxing_load_failed" };
  }
  const { BrowserMultiFormatReader } = browser;
  const reader = new BrowserMultiFormatReader();
  // Build an HTMLImageElement to feed zxing. Using an object URL
  // avoids a full base64 round-trip — decode works directly off the
  // decoded pixel buffer the browser builds.
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    let result;
    try {
      result = await reader.decodeFromImageElement(img);
    } catch (err) {
      // NotFoundException is the expected "no barcode found" path;
      // surface it as a clean miss rather than an error.
      return { found: false, reason: "no_barcode_visible" };
    }
    const text = (result?.getText?.() || "").trim();
    if (!/^\d{8,14}$/.test(text)) {
      return { found: false, reason: "not_a_product" };
    }
    const format = result.getBarcodeFormat?.() ?? null;
    return { found: true, barcode: text, format };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

// Live-video decoder for browsers without BarcodeDetector (Firefox
// mobile, older Safari). Given a <video> element that already has
// an active MediaStream, continuously decode frames and fire
// onDetected once a valid barcode is read. Returns a { stop }
// handle so the caller can tear down when the scanner closes or
// after a successful read.
//
// Why not use @zxing/browser's decodeFromVideoDevice? That helper
// requests its own getUserMedia stream, which conflicts with the
// BarcodeScanner component's already-running stream. Easier to
// decode off the existing video element.
export async function createZxingLiveScanner(videoElement, onDetected, onError, opts = {}) {
  // opts.continuous — when true, keep scanning after each detect
  //                   instead of stopping. Shop Mode uses this so the
  //                   user can fire off item after item without a
  //                   close/reopen of the camera between each. A
  //                   1500ms suppression window prevents the same UPC
  //                   from re-firing while the pair sheet is up.
  // opts.isPaused — () => boolean. When it returns true, the decoder
  //                   skips decoding on this tick but keeps the loop
  //                   alive so resume is instant. Stream stays up.
  const continuous = !!opts.continuous;
  const isPaused = typeof opts.isPaused === "function" ? opts.isPaused : () => false;
  // Suppression windows for continuous mode — match the values used
  // by the native BarcodeDetector path in BarcodeScanner.jsx so both
  // live decoders behave identically across devices.
  const SAME_UPC_SUPPRESSION_MS = 10000;
  const GLOBAL_COOLDOWN_MS      = 10000;
  let browser;
  try {
    browser = await loadReader();
  } catch (err) {
    onError?.(err);
    return { stop: () => {} };
  }
  const { BrowserMultiFormatReader } = browser;
  const reader = new BrowserMultiFormatReader();
  let stopped = false;
  let lastText = "";
  let lastAt   = 0;
  let lastAnyAt = 0;
  const tick = async () => {
    if (stopped) return;
    if (isPaused()) {
      // Caller has the scanner blocked (e.g. red-scan name prompt).
      // Skip the decode but keep the loop ticking so resume is
      // instant when isPaused() flips back to false.
      setTimeout(tick, 250);
      return;
    }
    if (!videoElement || videoElement.readyState < 2) {
      // Video not yet painting frames — retry next tick.
      setTimeout(tick, 250);
      return;
    }
    try {
      const result = await reader.decodeOnceFromVideoElement(videoElement);
      if (stopped) return;
      const text = (result?.getText?.() || "").trim();
      if (/^\d{8,14}$/.test(text)) {
        const now = Date.now();
        const sameUpcRecent = continuous && text === lastText
          && (now - lastAt) < SAME_UPC_SUPPRESSION_MS;
        const cooldownActive = continuous
          && (now - lastAnyAt) < GLOBAL_COOLDOWN_MS;
        if (!sameUpcRecent && !cooldownActive) {
          lastText = text;
          lastAt   = now;
          lastAnyAt = now;
          onDetected?.(text);
        }
        if (!continuous) {
          stopped = true;
          return;
        }
        // Continuous: keep looking after a short gap so the focus /
        // frame can settle on the next item before the decoder fires.
        setTimeout(tick, 400);
        return;
      }
      // Non-digit format (QR pointing to a URL, etc) — ignore and
      // keep looking. Slight backoff so we don't hammer CPU when
      // the camera's looking at a QR sticker.
      setTimeout(tick, 400);
    } catch (err) {
      // NotFoundException on a frame is normal (barcode not in
      // view). Reschedule. Other errors propagate.
      const name = err?.name || "";
      if (name === "NotFoundException" || name === "NotFoundException2") {
        setTimeout(tick, 250);
        return;
      }
      if (stopped) return;
      onError?.(err);
    }
  };
  tick();
  return {
    stop: () => {
      stopped = true;
      // BrowserMultiFormatReader doesn't always expose a clean
      // teardown method; calling reset() where available unhooks
      // any internal listeners.
      try { reader?.reset?.(); } catch { /* noop */ }
    },
  };
}
