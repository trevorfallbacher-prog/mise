// Shared cook-time session state across CookMode + CookComplete.
//
// The problem this solves: CookMode and CookComplete each kept their
// own "user override" state (CookMode's pantrySwaps / swappedToShopping,
// CookComplete's usedItems + extraRemovals). User-visible consequence:
// swap Mozzarella → Parmesan on the cook-prep screen, then hit DONE →
// the "What did you use?" screen shows Mozzarella again and deducts
// from the wrong row. Three parallel representations of the same
// "what has the user changed this cook?" question, none of them
// talking to each other.
//
// This hook centralizes ONE shape both screens read and write:
//
//   session = {
//     overrides: {
//       [recipeIngIdx]: {
//         pantryItemId?        — the pantry row the user bound to this slot
//         promotedToShopping?  — user tapped + SHOP on this row
//         skipped?             — user tapped ✕ / dropped this row
//         usedAmount?          — final commit amount (CookComplete only)
//         usedUnit?
//       }
//     },
//     extras: [
//       { id, name, amount, unit, pantryItemId, ingredientId, source }
//     ]   — user-added ingredients not in recipe.ingredients
//   }
//
// Design principle (documented at recipePairing.js:163): recipes store
// INTENT ("butter"), not POINTERS ("row id 42ba…"). The session is
// cook-time STATE that layers ON TOP of the persisted recipe — if the
// user cooks this recipe again in April, the session resets and
// pairing re-derives against April's pantry. This hook is session-
// scoped on purpose; nothing here writes to user_recipes.
//
// AIRecipe doesn't use this hook — its tweak-phase edits DO persist
// (via buildLockedIngredients → final recipe's pantryItemId stamping),
// so its local state is the right model for that phase. CookMode +
// CookComplete are the post-persist screens where overrides are
// ephemeral; they're what this hook is for.

import { useCallback, useState } from "react";

export function useCookSession() {
  const [session, setSession] = useState({
    overrides: {},
    extras: [],
  });

  // Merge a patch into the override for a given recipe ingredient
  // index. Partial writes — e.g. { pantryItemId: "row-42" } keeps any
  // existing { usedAmount } on the same idx.
  const setOverride = useCallback((idx, patch) => {
    setSession(prev => ({
      ...prev,
      overrides: {
        ...prev.overrides,
        [idx]: { ...(prev.overrides[idx] || {}), ...patch },
      },
    }));
  }, []);

  // Remove specific fields OR the entire override for an idx.
  //   clearOverride(3)                    — wipe overrides[3] entirely
  //   clearOverride(3, ["pantryItemId"])  — unset just that field
  const clearOverride = useCallback((idx, fields) => {
    setSession(prev => {
      if (!fields) {
        const next = { ...prev.overrides };
        delete next[idx];
        return { ...prev, overrides: next };
      }
      const cur = prev.overrides[idx];
      if (!cur) return prev;
      const nextCur = { ...cur };
      for (const f of fields) delete nextCur[f];
      return {
        ...prev,
        overrides: Object.keys(nextCur).length === 0
          ? (() => { const { [idx]: _, ...rest } = prev.overrides; return rest; })()
          : { ...prev.overrides, [idx]: nextCur },
      };
    });
  }, []);

  const addExtra = useCallback((row) => {
    setSession(prev => ({ ...prev, extras: [...prev.extras, row] }));
  }, []);

  const removeExtra = useCallback((id) => {
    setSession(prev => ({ ...prev, extras: prev.extras.filter(e => e.id !== id) }));
  }, []);

  // Reset on recipe change. Callers pass the current recipe.id; when
  // it changes we wipe the session so the next cook starts clean.
  // Use in a useEffect: resetIfNewRecipe(recipe?.id) from the caller.
  const resetSession = useCallback(() => {
    setSession({ overrides: {}, extras: [] });
  }, []);

  return { session, setOverride, clearOverride, addExtra, removeExtra, resetSession };
}

// Read helpers — callers can use these OR drill into session.overrides
// directly. These exist so unrelated components (describePairing hooks,
// pair resolvers) can check state without pulling the full hook.

export function getOverridePantryItemId(session, idx) {
  return session?.overrides?.[idx]?.pantryItemId || null;
}

export function isPromotedToShopping(session, idx) {
  return !!session?.overrides?.[idx]?.promotedToShopping;
}

export function isSkipped(session, idx) {
  return !!session?.overrides?.[idx]?.skipped;
}

export function getOverrideAmount(session, idx) {
  const o = session?.overrides?.[idx];
  if (!o) return null;
  return {
    amount: o.usedAmount ?? null,
    unit:   o.usedUnit   ?? null,
  };
}
