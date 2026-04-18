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
