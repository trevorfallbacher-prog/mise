// cookAudio — Web Audio chimes + haptic feedback for cook timers.
//
// No asset files. Two synthesized tones via AudioContext:
//   playTimerChime()       — twin-bell "timer's up" (880 / 1175 Hz)
//   playStepCompleteChime() — softer ping (660 Hz) for step advance
//
// Chose synthesized tones over an MP3 so:
//   1. Zero bundle weight.
//   2. No CORS / service-worker-cache / mobile-autoplay-gesture wrangling
//      for a file URL.
//   3. Instant latency. new Audio().play() has a 50-120ms lag on mobile.
//
// Autoplay policy gotcha: browsers suspend the AudioContext until a
// user gesture. We lazy-create on first call, and the first gesture
// inside CookMode (hitting "Start cooking" or tapping a step) unblocks
// it. If the VERY first call comes from Timer.onDone with no prior
// gesture, the context stays suspended and we silently no-op — which
// is fine, the server push + system notification already cover the
// "app backgrounded, needs to alert the user" case.
//
// Haptic: navigator.vibrate — short pattern for step complete, long
// pattern for timer ring. Graceful no-op on iOS Safari (no vibrate).
//
// Opt-out: localStorage["mise.cookAudio.enabled"] = "false" silences
// chimes. Default on. Vibration always fires when supported because
// it's the most ergonomic signal when the phone is counter-side.

let ctx = null;

function audioEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("mise.cookAudio.enabled") !== "false";
  } catch {
    return true;
  }
}

function getContext() {
  if (typeof window === "undefined") return null;
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

// Prime the AudioContext on an explicit user gesture. Call from a
// click / touchend handler so subsequent chimes land on unsuspended
// state even when the timer fires from a background tick.
export function primeCookAudio() {
  const c = getContext();
  if (!c) return;
  if (c.state === "suspended") {
    c.resume().catch(() => { /* iOS sometimes rejects silently */ });
  }
}

function playTone({ freq, durationMs, startAt = 0, volume = 0.25, type = "sine" }) {
  const c = getContext();
  if (!c) return;
  const t0 = c.currentTime + startAt;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // Short attack + exponential decay so the chime sounds bell-like,
  // not like a buzzer. Tails under the audible floor by durationMs
  // so queued tones don't tread on each other.
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.05);
}

export function playTimerChime() {
  if (!audioEnabled()) return;
  const c = getContext();
  if (!c) return;
  if (c.state === "suspended") {
    c.resume().catch(() => {});
  }
  // Three-note rising chime: the ear reads rise-rise-peak as "hey,
  // do the thing now" more reliably than a single tone, which can
  // get mistaken for an incoming message notification.
  playTone({ freq: 880,  durationMs: 260, startAt: 0.00, volume: 0.30 });
  playTone({ freq: 1175, durationMs: 260, startAt: 0.14, volume: 0.28 });
  playTone({ freq: 1568, durationMs: 420, startAt: 0.30, volume: 0.32 });

  // Haptic: two firm pulses separated by a brief silence. Android /
  // most PWAs honor this; iOS Safari silently drops it.
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try { navigator.vibrate([220, 120, 220, 120, 420]); } catch { /* ignore */ }
  }
}

export function playStepCompleteChime() {
  if (!audioEnabled()) return;
  const c = getContext();
  if (!c) return;
  if (c.state === "suspended") {
    c.resume().catch(() => {});
  }
  playTone({ freq: 660, durationMs: 180, volume: 0.22 });
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try { navigator.vibrate(40); } catch { /* ignore */ }
  }
}

export function setCookAudioEnabled(enabled) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("mise.cookAudio.enabled", enabled ? "true" : "false");
  } catch { /* quota / privacy-mode */ }
}

export function isCookAudioEnabled() {
  return audioEnabled();
}
