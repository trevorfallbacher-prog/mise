// Pantry-facing formatting helpers.
//
// These started life inside Pantry.jsx but are now used by both the main
// pantry renderer and the extracted Scanner component — pulling them to
// a shared module so there's one source of truth for how dates, prices,
// and expiration countdowns render across the app.

export const DAYS_MS = 1000 * 60 * 60 * 24;

// How many days until `expiresAt`; negative if past. Null when the item
// doesn't carry an expiration date (free-text, unknown ingredient).
// Matches the legacy "is this still good THIS WEEK" framing, not
// "is this at 60% of its shelf life".
export function daysUntilExpiration(item) {
  if (!item?.expiresAt) return null;
  const exp = item.expiresAt instanceof Date ? item.expiresAt : new Date(item.expiresAt);
  if (Number.isNaN(exp.getTime())) return null;
  return Math.floor((exp.getTime() - Date.now()) / DAYS_MS);
}

// Short countdown label: "5 days" / "1 day" / "today" / "expired" / "2d ago".
export function formatDaysUntil(days) {
  if (days == null) return null;
  if (days < -1)  return `expired ${-days}d ago`;
  if (days === -1) return "expired yesterday";
  if (days === 0) return "expires today";
  if (days === 1) return "1 day left";
  if (days < 14)  return `${days} days left`;
  if (days < 60)  return `${Math.round(days / 7)} weeks left`;
  return `${Math.round(days / 30)} months left`;
}

// Palette for expiration chips, gated on days remaining:
//   expired  → deep red      (< 0)
//   urgent   → red           (0–2)
//   warn     → amber         (3–7)
//   fresh    → green         (> 7)
export function expirationColor(days) {
  if (days == null) return "#333";
  if (days < 0)     return "#991b1b";
  if (days <= 2)    return "#ef4444";
  if (days <= 7)    return "#f59e0b";
  return "#4ade80";
}

// Integer cents → "$X.XX". Returns "" when the input isn't a real number
// so callers can concatenate without guards.
export function formatPrice(cents) {
  return typeof cents === "number" && Number.isFinite(cents)
    ? `$${(cents / 100).toFixed(2)}`
    : "";
}

// Discrete-count unit ids. An `amount === 1` row in one of these
// units represents ONE physical package (a can, a box, a bottle) —
// scanning / checking off / adding 50 of them should yield 50 rows
// the render layer stacks, NOT one row with amount=50. Fractional
// units (g, tbsp, ml, cup, lb, etc.) stay on the aggregate path so
// "200 g butter" remains one row.
export const DISCRETE_COUNT_UNITS = new Set([
  "count", "can", "box", "each", "bottle", "bag", "jar",
  "pack", "package", "piece", "slice", "loaf", "wedge",
  "block", "ball", "wheel", "carton", "container", "tub",
  "fillet", "head", "leaf", "clove",
]);

// A single discrete package — the call site should NOT merge this
// into any existing row; let groupByIdentity stack it at render.
export function isDiscreteInstance(item) {
  if (!item || Number(item.amount) !== 1) return false;
  return DISCRETE_COUNT_UNITS.has(item.unit);
}

// Stable identity key for grouping pantry rows into "stacks" (multiple
// physical instances of the same logical item — e.g. 5 cans of tuna).
// The fields mirror sameIdentity() in Kitchen.jsx: custom name, state,
// and ingredientIds composition. Rows that collide on this key belong on
// the same StackedItemCard.
export function identityKey(item) {
  const name = (item?.name || "").toLowerCase().trim();
  const state = item?.state || "";
  const ids = Array.isArray(item?.ingredientIds)
    ? item.ingredientIds.filter(Boolean).slice().sort().join(",")
    : "";
  const canon = item?.canonicalId || item?.ingredientId || "";
  return [name, canon, state, ids].join("|");
}

// Aggregate amount across an identity bucket. Returns the sum of all
// `amount` fields; meaningful when instances share a unit (or a
// canonical ingredient's unit ladder, which the caller can convert
// through separately). Defaults to 0 for empty buckets.
export function stackAmount(bucket) {
  const items = Array.isArray(bucket?.items) ? bucket.items : [];
  return items.reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

// Low / critical signals for an identity stack. Discrete-count units
// compare INSTANCE COUNT (5 cans left vs a restock threshold of 3),
// which matches how a cook thinks about canned goods. Fractional
// units (grams, tbsp) fall back to the per-row lowThreshold against
// summed amount — "half a cup of flour left" still reads the same
// whether it lives in 1 or 3 rows.
export function isStackLow(bucket) {
  const items = Array.isArray(bucket?.items) ? bucket.items : [];
  if (items.length === 0) return false;
  const head = items[0];
  const threshold = Number(head.lowThreshold) || 0;
  if (DISCRETE_COUNT_UNITS.has(head.unit)) {
    return items.length <= Math.max(1, Math.ceil(threshold || 1));
  }
  return stackAmount(bucket) <= threshold;
}

export function isStackCritical(bucket) {
  const items = Array.isArray(bucket?.items) ? bucket.items : [];
  if (items.length === 0) return true;
  const head = items[0];
  const threshold = Number(head.lowThreshold) || 0;
  if (DISCRETE_COUNT_UNITS.has(head.unit)) {
    return items.length <= Math.max(1, Math.ceil(threshold * 0.5));
  }
  return stackAmount(bucket) <= threshold * 0.5;
}

// Group pantry rows into identity buckets preserving original order.
// Returns Array<{ key, items: Array<row> }>. A bucket with one row is
// still a bucket — the caller decides whether to render as a single
// ItemCard (length 1) or a StackedItemCard (length > 1).
export function groupByIdentity(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const buckets = new Map();
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const k = identityKey(item);
    const existing = buckets.get(k);
    if (existing) {
      existing.items.push(item);
    } else {
      const bucket = { key: k, items: [item] };
      buckets.set(k, bucket);
      out.push(bucket);
    }
  }
  return out;
}
