import { useRef } from "react";

// "Pull past the top to dismiss" — the iOS sheet pattern, distance-
// thresholded.
//
// While the sheet's scroll content is at the top (scrollTop <= 0)
// and the user pulls their finger downward, we measure the
// displacement. Once it crosses DISMISS_THRESHOLD_PX, fire
// onDismiss. iOS Safari's native rubber-band gives the visual
// feedback during the pull (the content visibly stretches when
// you over-scroll past the top); we just watch for the threshold
// and call back.
//
// Why distance-only and not a framer-drag handoff: a drag handoff
// makes the sheet visibly follow the finger AND requires the user
// to release for the dismiss to fire. That feels right when the
// user grabs the pill deliberately, but it's overkill for the
// "scroll past the top" gesture — the user's intent is clear once
// they've over-pulled enough, and waiting for release adds latency.
//
// Skipped intentionally: touches that originate on inputs, buttons,
// chips, sliders, listbox / option roles, or contenteditable. Those
// get their own gesture semantics; we don't want a slider drag or
// input tap to start dismissing.
const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, label, " +
  "[role='button'], [role='option'], [role='listbox'], " +
  "[role='slider'], [role='spinbutton'], [contenteditable='true']";

const DISMISS_THRESHOLD_PX = 100;

export function useSheetDismissAtTop(sheetRef, onDismiss) {
  // Per-gesture state. Refs (not state) because we don't want a
  // re-render on every pointermove sample.
  const startRef = useRef(null);   // { y, pointerId } | null

  const onPointerDown = (e) => {
    startRef.current = null;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) {
      // Interactive target — let it own the gesture.
      return;
    }
    if (sheetRef.current && sheetRef.current.scrollTop > 0) {
      // Not at top — don't arm; user is mid-scroll.
      return;
    }
    startRef.current = { y: e.clientY, pointerId: e.pointerId };
  };

  const onPointerMove = (e) => {
    const start = startRef.current;
    if (!start) return;
    if (e.pointerId !== start.pointerId) return;
    // Bail if the user has somehow scrolled past the top mid-
    // gesture (rare, but possible with multi-touch). Don't
    // hijack their scroll.
    if (sheetRef.current && sheetRef.current.scrollTop > 0) {
      startRef.current = null;
      return;
    }
    const dy = e.clientY - start.y;
    if (dy >= DISMISS_THRESHOLD_PX) {
      // Cross the line → dismiss. Clear startRef so subsequent
      // moves on the same gesture don't refire.
      startRef.current = null;
      onDismiss && onDismiss();
    }
  };

  const onPointerUp = () => {
    startRef.current = null;
  };

  // Cancel covers cases where the browser reclaims the pointer
  // (scroll wins, palm-rejection, etc.) — same cleanup as up.
  const onPointerCancel = onPointerUp;

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
