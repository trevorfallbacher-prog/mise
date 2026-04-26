import { useRef } from "react";

// "Pull down at the top to dismiss" — the iOS sheet pattern.
//
// Native iOS modal sheets dismiss when the user is scrolled to the
// top of the sheet's content and continues pulling downward. We
// approximate that here without breaking the sheet's normal
// internal scroll:
//
//   1. On pointerdown, only ARM the gesture if (a) the touch is
//      not on an interactive element (input, button, slider —
//      those want their own input semantics) and (b) the sheet's
//      scrollable region is at the top (scrollTop <= 0).
//   2. On pointermove, watch for downward motion past a small
//      threshold (8 px). Once detected, hand the gesture to
//      framer's dragControls and let it drive the dismiss
//      animation. Pointer movement that stays inside the deadband
//      lets native scroll proceed normally — so a pull UP from
//      the top (to scroll the content down) still scrolls.
//   3. If scrollTop becomes > 0 mid-gesture (the user scrolled
//      up before pulling), bail out so we don't hijack a
//      legitimate scroll.
//
// Returns the three pointer handlers you spread onto the sheet's
// motion.div. Pair with framer-motion's drag="y" + manual
// dragControls + dragListener={false} on the same element.
//
//   const dragControls = useDragControls();
//   const sheetRef = useRef(null);
//   const dismissHandlers = useSheetDismissAtTop(sheetRef, dragControls);
//   <motion.div
//     ref={sheetRef}
//     drag="y"
//     dragControls={dragControls}
//     dragListener={false}
//     {...dismissHandlers}
//   />
//
// Selector list covers the things the user typically wants to
// interact with WITHOUT triggering a sheet dismiss: form inputs,
// buttons (including chip buttons), labels, sliders (range
// inputs), accessibility roles for buttons / list options /
// listboxes. Add to it if a future picker introduces a new
// interactive surface.
const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, label, " +
  "[role='button'], [role='option'], [role='listbox'], " +
  "[role='slider'], [role='spinbutton'], [contenteditable='true']";

const DOWNWARD_THRESHOLD_PX = 8;

export function useSheetDismissAtTop(sheetRef, dragControls) {
  // Per-gesture state. Refs (not state) because we don't want a
  // re-render on every touchmove sample.
  const startRef = useRef(null);   // { y, pointerId } | null
  const handedOffRef = useRef(false);

  const onPointerDown = (e) => {
    handedOffRef.current = false;
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
    if (!start || handedOffRef.current) return;
    if (e.pointerId !== start.pointerId) return;
    // Bail if the user has somehow scrolled past the top while
    // the gesture is in progress (rare, but possible with multi-
    // touch). Don't hijack their scroll.
    if (sheetRef.current && sheetRef.current.scrollTop > 0) {
      startRef.current = null;
      return;
    }
    const dy = e.clientY - start.y;
    if (dy > DOWNWARD_THRESHOLD_PX) {
      handedOffRef.current = true;
      dragControls.start(e);
    }
  };

  const onPointerUp = () => {
    startRef.current = null;
    handedOffRef.current = false;
  };

  // Cancel covers cases where the browser reclaims the pointer
  // (scroll wins, palm-rejection, etc.) — same cleanup as up.
  const onPointerCancel = onPointerUp;

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
