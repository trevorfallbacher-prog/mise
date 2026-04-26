import { useRef } from "react";

// "Pull past the top to dismiss" — iOS sheet pattern, distance-
// thresholded, with seamless scroll → pull handoff inside a
// single touch.
//
// On a large card the user typically isn't at scrollTop=0 when
// they start a touch — they scroll up first, hit the top, then
// keep pulling. Native iOS sheets dismiss without the user
// releasing and re-touching; this hook does the same:
//
//   1. Pointerdown arms a touch context. We don't decide yet
//      whether this is a dismiss gesture; we just track the
//      pointer id.
//   2. As the user moves their finger, we read scrollTop on
//      every sample. The MOMENT it lands at <= 0 we record the
//      finger's current Y as the "overscroll start" (the point
//      from which a downward pull counts toward the dismiss
//      threshold).
//   3. While scrollTop is at the top, every subsequent
//      downward movement past DISMISS_THRESHOLD_PX from that
//      anchor fires onDismiss. If the user scrolls back into
//      content (scrollTop > 0), the anchor clears so any new
//      arrival at the top starts a fresh measurement.
//
// The grabber pill stays separate (uses framer's dragControls
// directly for its visceral drag-follows-finger feedback). This
// hook is for the "scroll past the top to flick the sheet away"
// gesture, which is intent-clear once the distance lands.
//
// Skipped: touches that originate on interactive elements
// (inputs, buttons, chips, sliders, listboxes / options /
// contenteditable). Those keep their own gesture semantics so a
// slider drag or input tap can never dismiss a sheet.
const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, label, " +
  "[role='button'], [role='option'], [role='listbox'], " +
  "[role='slider'], [role='spinbutton'], [contenteditable='true']";

const DISMISS_THRESHOLD_PX = 100;

export function useSheetDismissAtTop(sheetRef, onDismiss) {
  // Per-gesture state. Refs (not state) — pointermove fires every
  // frame, we don't want re-renders.
  const ctxRef = useRef(null);
  // shape: { pointerId, anchorY: number | null, blocked: boolean }
  // anchorY = the finger Y at the moment scrollTop most recently
  //           landed at the top; null when we're mid-content
  // blocked = true if the touch began on an interactive element

  const onPointerDown = (e) => {
    const blocked = !!(e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR));
    const atTop = !sheetRef.current || sheetRef.current.scrollTop <= 0;
    ctxRef.current = {
      pointerId: e.pointerId,
      anchorY: atTop ? e.clientY : null,
      blocked,
    };
  };

  const onPointerMove = (e) => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.blocked) return;
    if (e.pointerId !== ctx.pointerId) return;
    const atTop = !sheetRef.current || sheetRef.current.scrollTop <= 0;
    if (!atTop) {
      // User scrolled into content — clear the anchor so we don't
      // fire on stale finger displacement. A subsequent return to
      // the top will re-anchor.
      ctx.anchorY = null;
      return;
    }
    // Just landed at the top this frame — anchor here so the
    // overscroll distance is measured from the moment scroll
    // boundary was reached, not from where the touch started
    // deeper in the content.
    if (ctx.anchorY == null) {
      ctx.anchorY = e.clientY;
      return;
    }
    const dy = e.clientY - ctx.anchorY;
    if (dy >= DISMISS_THRESHOLD_PX) {
      ctxRef.current = null;
      onDismiss && onDismiss();
    }
  };

  const onPointerUp = () => { ctxRef.current = null; };
  const onPointerCancel = onPointerUp;

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
