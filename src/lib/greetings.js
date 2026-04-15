// Rotating hero greeting for the Home screen.
//
// A few tiers:
//   * STANDARD        — the common pool. One is picked at random on
//                       every Home mount. "[NAME]" is replaced with the
//                       user's first name (or "chef" if unknown).
//   * TIME_OF_DAY     — fire in a time window, coin-flip so they don't
//                       feel inevitable.
//   * RARE            — ~1/200 each. Pop-culture riffs, tiny easter eggs.
//                       Some trigger side effects (idiot sandwich badge).
//   * ULTRA_RARE      — ~1/500 each. Silly, harmless.
//
// When a greeting carries `onShow`, it's invoked with (supabase, userId)
// the first time the greeting surfaces — that's how we mint the Idiot
// Sandwich badge when the "What are you, Trevor?" line fires.
//
// Adding a new greeting is one line — drop it into the pool, done.

import { supabase } from "./supabase";

// Pools. `t` returns the formatted string given the viewer's name.
const STANDARD = [
  (n) => `What's cookin', ${n}?`,
  (n) => `Ready to plate, ${n}?`,
  (n) => `What's on the menu, ${n}?`,
  (n) => `Hungry, ${n}?`,
  (n) => `The kitchen's yours, ${n}.`,
  (n) => `Let's get mise en place, ${n}.`,
  (n) => `What are we making tonight, ${n}?`,
  (n) => `The stove's waiting, ${n}.`,
  (n) => `Time to cook, ${n}.`,
  (n) => `What's the move, ${n}?`,
  (n) => `Chef's choice, ${n}?`,
  (n) => `Apron on, ${n}?`,
  (n) => `What are we into today, ${n}?`,
  (n) => `The ingredients are ready, ${n}.`,
  (n) => `Fire up the stove, ${n}.`,
  (n) => `What's the play, ${n}?`,
  (n) => `Feeling adventurous, ${n}?`,
  (n) => `Ready to learn something new, ${n}?`,
  (n) => `Your kitchen awaits, ${n}.`,
  (n) => `Let's make something worth eating, ${n}.`,
  (n) => `Bon Appétit, ${n}.`,
];

// Beauty-and-the-Beast trio. They group thematically so when one hits,
// the vibe carries. Each still rolls independently.
const DISNEY = [
  () => `As the dining room proudly presents: your dinner.`,
  () => `Why, we only live to serve!`,
  () => `Be our guest.`,
];

// Morning ≤ 10am; late-night ≥ 23h or < 5h. These are rolled only within
// their time window.
const MORNING = [
  () => `Coffee first… then we cook.`,
];
const LATE_NIGHT = [
  () => `Shouldn't you be doomscrolling?`,
];

// Rare: ~1 in 100. Some carry an onShow side effect.
const RARE = [
  {
    // Literal Ramsay joke — name stays "Trevor" regardless of viewer.
    // Unlocking the badge regardless of who sees the greeting means the
    // pun lands the same for everyone.
    text: () => `What are you, Trevor?`,
    onShow: awardIdiotSandwich,
  },
  { text: () => `Free Shavacado.` },
];

// Ultra rare: ~1 in 500.
const ULTRA_RARE = [
  (n) => `Soak your nuts first, ${n}.`,
];

// ── picker ──────────────────────────────────────────────────────────────────
// Returns a picked greeting. Side effects (badge mints) fire at most once
// per session for a given userId, tracked in the module-scoped shownOnce
// set so re-navigating between tabs doesn't spam awards or notifications.
const shownOnce = new Set();

const random = (xs) => xs[Math.floor(Math.random() * xs.length)];
const first  = (name) => {
  const raw = (name || "").trim();
  if (!raw) return "chef";
  return raw.split(/\s+/)[0];
};

export function pickGreeting({ name, userId, now = new Date() } = {}) {
  const n = first(name);
  const hour = now.getHours();

  // Roll the tiers in descending order of specialness so an ultra-rare
  // or rare line beats a mundane one on the same mount.
  const ultra = Math.random();
  if (ultra < 1 / 500) {
    return { text: random(ULTRA_RARE)(n), tier: "ultra" };
  }

  const rareRoll = Math.random();
  if (rareRoll < 1 / 100) {
    const pick = random(RARE);
    const text = pick.text(n);
    const tier = "rare";
    if (pick.onShow && userId) {
      const key = `${userId}:${text}`;
      if (!shownOnce.has(key)) {
        shownOnce.add(key);
        // Fire-and-forget; the module-level once-guard keeps it idempotent
        // per session and DB unique constraint handles cross-session.
        pick.onShow(userId).catch(err => console.error("[greeting.onShow]", err));
      }
    }
    return { text, tier };
  }

  // Time-of-day, roughly 40% chance in window so they don't dominate.
  if (hour >= 23 || hour < 5) {
    if (Math.random() < 0.4) return { text: random(LATE_NIGHT)(n), tier: "time" };
  } else if (hour < 10) {
    if (Math.random() < 0.4) return { text: random(MORNING)(n), tier: "time" };
  }

  // Disney run — 1/40 chance to surface one of the BatB trio.
  if (Math.random() < 1 / 40) {
    return { text: random(DISNEY)(n), tier: "disney" };
  }

  // Common pool.
  return { text: random(STANDARD)(n), tier: "standard" };
}

// ── side effects ────────────────────────────────────────────────────────────
// awardIdiotSandwich: look up the badge by slug, insert a user_badges row
// (ON CONFLICT does nothing at the unique (user_id, badge_id) key), then
// fire a celebratory notification so the user sees the mint even if they
// scroll past the greeting without noticing. All RLS-compliant — the
// self-insert policy on user_badges allows this without an RPC.
async function awardIdiotSandwich(userId) {
  if (!userId) return;
  const { data: badge, error: lookupErr } = await supabase
    .from("badges")
    .select("id,name")
    .eq("slug", "idiot-sandwich")
    .maybeSingle();
  if (lookupErr || !badge) {
    if (lookupErr) console.error("[idiot-sandwich lookup]", lookupErr);
    return;
  }

  // Already held? Skip the INSERT + notification so the inbox doesn't
  // re-surface the same earn.
  const { data: existing } = await supabase
    .from("user_badges")
    .select("badge_id")
    .eq("user_id", userId)
    .eq("badge_id", badge.id)
    .maybeSingle();
  if (existing) return;

  const { error: insErr } = await supabase.from("user_badges").insert({
    user_id: userId,
    badge_id: badge.id,
    earn_reason: 'Saw the "What are you, Trevor?" greeting. Caught red-handed.',
  });
  if (insErr) {
    // Unique violation is the expected no-op path.
    if (insErr.code !== "23505") console.error("[idiot-sandwich insert]", insErr);
    return;
  }

  await supabase.from("notifications").insert({
    user_id:     userId,
    actor_id:    userId,
    msg:         'You earned the Idiot Sandwich 🥪 — a Ramsay special, tap to see the wall',
    emoji:       "🥪",
    kind:        "success",
    target_kind: "user_profile",
    target_id:   userId,
  });
}
