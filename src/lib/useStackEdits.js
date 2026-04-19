// Stack-level edit primitives shared by StackedItemCard and
// StackDrilldown. An identity-stack is a group of pantry rows that
// collide on identityKey (name + canonical + state + composition).
// Adding a stack instance INSERTs a new sibling row; removing deletes
// a sibling. No merging — each physical unit is its own row.
//
// Uses the same `setPantry` setter returned by usePantry — writes fan
// out to Supabase automatically via useSyncedList's toDb. No direct
// supabase calls here.

import { DAYS_MS } from "./pantryFormat";

// Generate a new pantry row id. Crypto first, fall back for older
// JSDOM / test envs that don't expose randomUUID.
function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Pick a template row from the bucket to copy identity/routing off.
// The newest row (freshest purchased_at) is the best template — its
// price_cents + expires_at reflect the latest packaging the user's
// buying.
function pickTemplate(bucket) {
  const items = Array.isArray(bucket?.items) ? bucket.items : [];
  if (items.length === 0) return null;
  return items.slice().sort((a, b) => {
    const ta = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
    const tb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
    return tb - ta;
  })[0];
}

// INSERT a fresh sibling row that shares identity with the bucket.
// expires_at is projected forward by the delta between the template's
// purchased_at and expires_at — a new can of tuna keeps the same
// shelf-life window, just anchored to today's purchase date. Clears
// provenance (the new instance didn't come from any specific receipt
// or scan) and resets fill_level + protected.
export function addInstance(setPantry, bucket) {
  const template = pickTemplate(bucket);
  if (!template) return;

  const now = new Date();
  let newExpiresAt = null;
  if (template.expiresAt && template.purchasedAt) {
    const shelfMs = new Date(template.expiresAt).getTime() -
                    new Date(template.purchasedAt).getTime();
    if (Number.isFinite(shelfMs) && shelfMs > 0) {
      newExpiresAt = new Date(now.getTime() + shelfMs);
    }
  } else if (template.expiresAt) {
    newExpiresAt = new Date(template.expiresAt);
  }

  const {
    id: _id,
    sourceReceiptId: _sr,
    sourceScanId: _ss,
    sourceKind: _sk,
    sourceCookLogId: _scl,
    sourceRecipeSlug: _srs,
    scanRaw: _raw,
    learnedCorrectionId: _lc,
    fillLevel: _fl,
    ...carry
  } = template;

  const fresh = {
    ...carry,
    id: newId(),
    amount: template.amount || 1,
    max: Math.max(template.max || 1, template.amount || 1),
    purchasedAt: now,
    expiresAt: newExpiresAt,
    sourceKind: "manual",
    protected: false,
  };
  setPantry(prev => [...prev, fresh]);
}

// DELETE one sibling from the bucket. Policy picks WHICH sibling:
//   'lifo' — newest purchased_at first (undo the last add)
//   'fifo' — oldest expires_at first (consume before it spoils)
// Returns the deleted row id so callers can toast or undo.
export function removeInstance(setPantry, bucket, policy = "lifo") {
  const items = Array.isArray(bucket?.items) ? bucket.items : [];
  if (items.length === 0) return null;
  const sorted = items.slice().sort((a, b) => {
    if (policy === "fifo") {
      const ea = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
      const eb = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
      if (ea !== eb) return ea - eb;
      const pa = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
      const pb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
      return pa - pb;
    }
    const pa = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
    const pb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
    return pb - pa;
  });
  const victim = sorted[0];
  if (!victim) return null;
  setPantry(prev => prev.filter(p => p.id !== victim.id));
  return victim.id;
}

// Useful for StackDrilldown to show a sorted instance list. FIFO by
// default so the next-to-expire reads first.
export function sortedInstances(bucket, policy = "fifo") {
  const items = Array.isArray(bucket?.items) ? bucket.items : [];
  return items.slice().sort((a, b) => {
    if (policy === "lifo") {
      const pa = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
      const pb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
      return pb - pa;
    }
    const ea = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
    const eb = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
    if (ea !== eb) return ea - eb;
    const pa = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
    const pb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
    return pa - pb;
  });
}

// Re-export DAYS_MS consumers might want without pulling two modules.
export { DAYS_MS };
