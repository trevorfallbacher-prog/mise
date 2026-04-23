// AI Recipe draft persistence.
//
// When the user has a sketch in the tweak phase and leaves the page
// (tab close, nav elsewhere, device sleep), we don't want to burn a
// fresh Claude call to recover the same draft on return. Everything
// that's salvageable lives in localStorage, keyed by user id, and
// auto-restores when AIRecipe mounts.
//
// Scope: tweak-phase only. Sketch state BEFORE the tweak screen is
// cheap to re-generate and FINAL-pass state is already persisted to
// user_recipes. The tweak phase is the one with user-touched swaps /
// removes / adds / shopping promotions that would be painful to redo.
//
// Storage shape (versioned so we can drop incompatible older drafts
// rather than surface stale state as a silent UX bug):
//   {
//     v: 1,
//     savedAt: <ISO8601>,
//     // tweak-phase state
//     sketch:          <sketch object>,
//     pantryEdits:     { swaps, removes, adds, shopping },
//     recipeFeedback:  "<string>",
//     previousTitles:  [<string>],
//     // setup-phase bindings the tweak derives from
//     mealPrompt:      "<string>",
//     mealTiming:      "any|breakfast|lunch|dinner",
//     course:          "any|main|side|...",
//     priority:        "category|pantry",
//     starIngredientIds: [<slug>],
//     cuisine:         "<string>",
//     time:            "quick|medium|long",
//     difficulty:      "<string>",
//     dishContract:    <contract object from classifier>,
//     classifiedFrom:  "<string>",
//   }

const VERSION = 1;
// After 14 days, drafts go stale — either the user moved on or the
// pantry has drifted enough that the sketch is wrong anyway. Clear
// on read rather than auto-delete at save time so we don't do I/O
// just to clean up.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function storageKey(userId) {
  return `mise:ai-recipe-draft:v${VERSION}:${userId || "anon"}`;
}

// Sets don't JSON-serialize; convert to arrays on save and back to
// Sets on restore. Same treatment for anything else that would
// round-trip wrong.
function serializePantryEdits(edits) {
  if (!edits) return null;
  return {
    swaps:    edits.swaps || {},
    removes:  Array.from(edits.removes || []),
    adds:     Array.isArray(edits.adds) ? edits.adds : [],
    shopping: Array.from(edits.shopping || []),
  };
}
function deserializePantryEdits(saved) {
  if (!saved) {
    return { swaps: {}, removes: new Set(), adds: [], shopping: new Set() };
  }
  return {
    swaps:    saved.swaps || {},
    removes:  new Set(Array.isArray(saved.removes) ? saved.removes : []),
    adds:     Array.isArray(saved.adds) ? saved.adds : [],
    shopping: new Set(Array.isArray(saved.shopping) ? saved.shopping : []),
  };
}

export function saveDraft(userId, state) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const payload = {
      v: VERSION,
      savedAt: new Date().toISOString(),
      sketch:            state.sketch ?? null,
      pantryEdits:       serializePantryEdits(state.pantryEdits),
      recipeFeedback:    state.recipeFeedback ?? "",
      previousTitles:    Array.isArray(state.previousTitles) ? state.previousTitles : [],
      mealPrompt:        state.mealPrompt ?? "",
      mealTiming:        state.mealTiming ?? "any",
      course:            state.course ?? "any",
      priority:          state.priority ?? "category",
      starIngredientIds: Array.isArray(state.starIngredientIds) ? state.starIngredientIds : [],
      cuisine:           state.cuisine ?? "any",
      time:              state.time ?? "medium",
      difficulty:        state.difficulty ?? "medium",
      dishContract:      state.dishContract ?? null,
      classifiedFrom:    state.classifiedFrom ?? "",
    };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(payload));
  } catch (_) { /* quota exhaustion / private mode — non-fatal */ }
}

export function loadDraft(userId) {
  if (typeof window === "undefined" || !window.localStorage) return null;
  let raw;
  try {
    raw = window.localStorage.getItem(storageKey(userId));
  } catch (_) { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return null; }
  if (!parsed || parsed.v !== VERSION) {
    clearDraft(userId);   // drop incompatible version silently
    return null;
  }
  const savedAt = parsed.savedAt ? new Date(parsed.savedAt).getTime() : 0;
  if (!savedAt || Date.now() - savedAt > MAX_AGE_MS) {
    clearDraft(userId);
    return null;
  }
  // A draft with no sketch has nothing salvageable — treat as empty.
  if (!parsed.sketch || typeof parsed.sketch !== "object") {
    clearDraft(userId);
    return null;
  }
  return {
    savedAt:           parsed.savedAt,
    sketch:            parsed.sketch,
    pantryEdits:       deserializePantryEdits(parsed.pantryEdits),
    recipeFeedback:    parsed.recipeFeedback ?? "",
    previousTitles:    Array.isArray(parsed.previousTitles) ? parsed.previousTitles : [],
    mealPrompt:        parsed.mealPrompt ?? "",
    mealTiming:        parsed.mealTiming ?? "any",
    course:            parsed.course ?? "any",
    priority:          parsed.priority ?? "category",
    starIngredientIds: Array.isArray(parsed.starIngredientIds) ? parsed.starIngredientIds : [],
    cuisine:           parsed.cuisine ?? "any",
    time:              parsed.time ?? "medium",
    difficulty:        parsed.difficulty ?? "medium",
    dishContract:      parsed.dishContract ?? null,
    classifiedFrom:    parsed.classifiedFrom ?? "",
  };
}

export function clearDraft(userId) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try { window.localStorage.removeItem(storageKey(userId)); } catch (_) { /* ignore */ }
}

// Human-readable "saved N minutes ago" for the resume banner.
export function draftAgeLabel(savedAt) {
  if (!savedAt) return "";
  const ms = Date.now() - new Date(savedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
