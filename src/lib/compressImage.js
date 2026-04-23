// Client-side image compression for scan uploads.
//
// Why: phone photos are 2-5 MB each. Uploading them raw to Supabase
// Storage blows through free-tier capacity (1 GB) in a couple of months
// for a heavy user. Receipts are text-heavy and high-contrast — they
// don't need original resolution to stay readable, so compressing
// aggressively is near-free visually.
//
// Also benefits the Claude vision API call: a 300 KB image uploads
// and processes faster than a 3 MB one, and still has plenty of
// resolution for receipt OCR.
//
// Approach: draw the source image into an offscreen canvas, downscale
// to MAX_DIMENSION on the longest side, export as JPEG at JPEG_QUALITY.
// Strips EXIF metadata as a side effect (canvas export doesn't carry
// it forward), which is a privacy win.

// Defaults tuned for general-purpose item-label scans (Kitchen.jsx
// flow): aggressive enough to keep storage cheap and still readable
// for OFF / brand label OCR. Receipts override these — see
// compressImage(input, { maxDimension, jpegQuality }) below.
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_JPEG_QUALITY  = 0.72;

// Compress a File/Blob or base64 data-URL. Returns a Promise resolving
// to { base64, mediaType, size }:
//
//   base64    — the compressed image as base64 WITHOUT the data-URL
//               prefix (matches handleFile's existing shape)
//   mediaType — "image/jpeg" after compression (always, even if input
//               was a PNG — JPEG is dramatically smaller for photos)
//   size      — rough byte count of the compressed payload, for logging
//
// Options:
//   maxDimension — longest side in pixels (default 1600). Bump for
//     OCR-critical paths like receipts where small thermal-print
//     digits need the resolution to survive downscaling.
//   jpegQuality  — 0..1 JPEG quality (default 0.72). Bump for OCR
//     paths; the difference between 0.72 and 0.92 is invisible on
//     normal photos but is the difference between readable and
//     pixel-mush for 6-7pt thermal text.
//
// Falls back to the original input if anything goes wrong — the vision
// API + storage still work, we just didn't get the size win.
export async function compressImage(input, opts = {}) {
  const maxDimension = opts.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const jpegQuality  = opts.jpegQuality  ?? DEFAULT_JPEG_QUALITY;
  try {
    const img = await loadImage(input);
    const { canvas, width, height } = downscaleToCanvas(img, maxDimension);
    const ctx = canvas.getContext("2d");
    // Hint the browser to use higher-quality interpolation when
    // downscaling — Safari and Chrome both default to "low" which
    // bilinears small text into mush. "high" uses a better filter
    // that preserves edge contrast on thin strokes (= UPC digits).
    if (ctx.imageSmoothingEnabled !== undefined) ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality !== undefined) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);

    // Try toBlob first (Promise-friendly); some older WebViews fall back
    // to toDataURL. Both paths end up with a JPEG we base64-encode.
    const blob = await new Promise((resolve) => {
      if (canvas.toBlob) {
        canvas.toBlob(resolve, "image/jpeg", jpegQuality);
      } else {
        resolve(null);
      }
    });
    if (blob) {
      const base64 = await blobToBase64(blob);
      return { base64, mediaType: "image/jpeg", size: blob.size };
    }
    // Fallback path.
    const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
    const base64 = dataUrl.split(",")[1] || "";
    return {
      base64,
      mediaType: "image/jpeg",
      // Approximate — base64 is ~1.33x binary size.
      size: Math.round((base64.length * 3) / 4),
    };
  } catch (err) {
    console.warn("[compressImage] failed, falling back to original:", err?.message || err);
    return fallbackPassthrough(input);
  }
}

// Load the input into an Image element. Accepts:
//   - File / Blob (from a file input)
//   - base64 string WITHOUT the data-URL prefix (callers sometimes pass
//     the already-extracted base64 from a prior FileReader read)
//   - full data URL string
function loadImage(input) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    if (typeof input === "string") {
      // Raw base64 or data-URL — normalize to a data-URL.
      img.src = input.startsWith("data:")
        ? input
        : `data:image/jpeg;base64,${input}`;
    } else if (input instanceof Blob) {
      img.src = URL.createObjectURL(input);
    } else {
      reject(new Error("compressImage: unsupported input type"));
    }
  });
}

function downscaleToCanvas(img, maxDimension) {
  const w = img.naturalWidth  || img.width;
  const h = img.naturalHeight || img.height;
  const longest = Math.max(w, h);
  const scale = longest > maxDimension ? maxDimension / longest : 1;
  const width  = Math.round(w * scale);
  const height = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width  = width;
  canvas.height = height;
  return { canvas, width, height };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result is a data-URL; strip the prefix to match existing
      // callers that expect raw base64.
      const s = String(reader.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function fallbackPassthrough(input) {
  if (typeof input === "string") {
    // Raw base64 passed in; we can't easily detect the real media type
    // without the prefix, so assume JPEG (most phone photos).
    return { base64: input, mediaType: "image/jpeg", size: Math.round((input.length * 3) / 4) };
  }
  if (input instanceof Blob) {
    const base64 = await blobToBase64(input);
    return { base64, mediaType: input.type || "image/jpeg", size: input.size };
  }
  return { base64: "", mediaType: "image/jpeg", size: 0 };
}
