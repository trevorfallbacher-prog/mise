import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { COLOR, FONT, RADIUS, Z, SPRING } from "../lib/tokens";

/**
 * ModalSheet — shared bottom-sheet modal primitive.
 *
 * Before this existed, every modal in the app (ItemCard, LinkIngredient,
 * AddItemModal, IngredientDetailSheet, ConvertStateModal, CookComplete
 * phase shells, delete-confirm, ReceiptView, etc.) hand-rolled its own
 * fixed-position backdrop + inner sheet container + close affordances.
 * That meant cross-cutting behavior (swipe-down-to-dismiss, Escape key,
 * drag handle, z-index management) was implemented inconsistently:
 * swipe-down lived only on ItemCard, Escape handling was ad-hoc,
 * z-indexes drifted across components.
 *
 * This component owns that shell. Every new modal should use it;
 * existing modals can migrate opportunistically as they're touched.
 *
 * Features (all opt-in via props with sensible defaults):
 *   - Backdrop with fade-with-drag when swipeable
 *   - Centered drag handle (can be hidden via showHandle=false)
 *   - Top-right ✕ close button (hidden with showClose=false)
 *   - Escape key to close
 *   - Click-backdrop to close
 *   - Swipe-down-to-dismiss (enabled by default; set swipeable=false to
 *     disable for modals where vertical scrolling fights the gesture,
 *     e.g. pickers with lots of content)
 *   - z-index from the token scale (default Z.card = 320)
 *   - Motion-driven enter animation: spring-slide up from bottom,
 *     backdrop fade-in, via framer-motion using the SPRING.sheet preset.
 *     The existing drag-to-dismiss is preserved; motion and drag share
 *     the `y` value so the spring controller honors live drag position.
 *
 * Props:
 *   onClose()         - called when any dismissal happens. Caller owns
 *                       the open/close state; this component never
 *                       owns it internally.
 *   children          - the sheet's body
 *   zIndex            - stacking layer. Default Z.card; pickers should
 *                       pass Z.picker, destructive confirms Z.confirm
 *   swipeable         - enable swipe-down gesture (default true)
 *   showHandle        - show the centered drag handle (default true)
 *   showClose         - show the top-right ✕ (default true)
 *   maxHeight         - CSS max-height for the inner sheet. Default 92vh
 *   closeOnBackdrop   - tap backdrop to close (default true)
 *   label             - optional kicker label shown above the children,
 *                       styled as an uppercase mono tag. Convenient for
 *                       modals that would otherwise reimplement this
 *                       same header pattern by hand.
 *   scrollRef         - optional ref to the inner scrollable container.
 *                       The swipe gesture only activates when this
 *                       container is scrolled to the top; pass your
 *                       own ref if the modal's content is itself
 *                       scrollable and you want the gesture aware of
 *                       that scroll state. Omit and a sensible default
 *                       is used (the ModalSheet's own scroll element).
 */
export default function ModalSheet({
  onClose,
  children,
  zIndex = Z.card,
  swipeable = true,
  showHandle = true,
  showClose = true,
  maxHeight = "92vh",
  closeOnBackdrop = true,
  label,
  scrollRef: scrollRefFromProps,
}) {
  // Escape-to-close. Every modal wants this; putting it here means
  // consumers never forget to wire it and it never diverges.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Mobile keyboard awareness — when an input inside the sheet is
  // focused, iOS Safari / Android Chrome push the viewport up to
  // make room for the keyboard, but `vh` units still reference the
  // FULL screen. Result: a `maxHeight: 92vh` sheet overflows the
  // visible viewport and the keyboard covers the input the user is
  // typing into. The `visualViewport` API reports the actually-visible
  // inner height; subscribing to its resize event and clamping the
  // sheet to that height keeps the input above the keyboard at all
  // times. Fallback for browsers without visualViewport: `dvh` units
  // do the same thing at the CSS layer.
  const [visibleH, setVisibleH] = useState(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" && window.visualViewport;
    if (!vv) return;
    const update = () => setVisibleH(Math.round(vv.height));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);


  // Swipe-down state. Dragged downward past DISMISS_THRESHOLD fires
  // onClose with an animated slide-out; anything less snaps back.
  //
  //   dragY        - current vertical offset the sheet is translated by
  //   dragStartRef - ref holding touch-start Y + whether scroll was at
  //                  the top when drag began. Gesture only activates
  //                  at scrollTop=0 so scrolling long content never
  //                  accidentally triggers dismiss.
  const DISMISS_THRESHOLD = 100;
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef(null);
  const internalScrollRef = useRef(null);
  const scrollRef = scrollRefFromProps || internalScrollRef;

  // stopPropagation on every touch handler — nested ModalSheets
  // (e.g. TypePicker opened from inside AddItemModal) otherwise
  // let touches bubble to the parent sheet's handlers, so a
  // swipe-down on the inner picker drags the outer AddItemModal
  // too and both dismiss at once.
  const onTouchStart = (e) => {
    if (!swipeable) return;
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop > 0) return;  // let the user scroll up first
    dragStartRef.current = { y: e.touches[0].clientY };
    setDragging(true);
  };
  const onTouchMove = (e) => {
    if (!swipeable) return;
    e.stopPropagation();
    if (!dragStartRef.current) return;
    const diff = e.touches[0].clientY - dragStartRef.current.y;
    if (diff <= 0) { setDragY(0); return; }  // upward drags don't count
    setDragY(diff);
  };
  const onTouchEnd = (e) => {
    if (!swipeable) return;
    e?.stopPropagation?.();
    if (!dragStartRef.current) return;
    const finalY = dragY;
    dragStartRef.current = null;
    setDragging(false);
    if (finalY >= DISMISS_THRESHOLD) {
      // Slide off-screen then dismiss. The setTimeout matches the
      // transition duration so the onClose lands right as the sheet
      // is visually gone.
      setDragY(window.innerHeight);
      setTimeout(() => onClose?.(), 180);
    } else {
      setDragY(0);
    }
  };

  // Backdrop opacity drops with drag distance so dismiss feels
  // physical. While the user is actively dragging, we disable the
  // spring so the backdrop tracks the finger 1:1.
  const backdropOpacity = Math.max(0, 1 - dragY / 400);

  // Resolve the effective maxHeight. If the caller passed a vh-based
  // string (default "92vh"), translate the percentage against the
  // visualViewport's height when we have it so the sheet shrinks as
  // the keyboard opens. Any non-vh value (px, dvh, etc.) passes
  // through untouched.
  const resolvedMaxHeight = (() => {
    if (!visibleH) return maxHeight;
    const m = /^([\d.]+)vh$/.exec(String(maxHeight).trim());
    if (!m) return maxHeight;
    const pct = parseFloat(m[1]) / 100;
    return `${Math.round(visibleH * pct)}px`;
  })();

  // Focus-aware scroll-into-view. When any input / textarea inside
  // the sheet gains focus, give the mobile keyboard 280ms to animate
  // in, then center the focused element inside the visible sheet
  // area. On iOS this is the difference between seeing what you're
  // typing and seeing the keyboard over the input.
  const assignSheetRef = (node) => {
    if (typeof scrollRef === "function") scrollRef(node);
    else if (scrollRef) scrollRef.current = node;
    if (node && !node.__miseFocusListenerInstalled) {
      node.__miseFocusListenerInstalled = true;
      node.addEventListener("focusin", (e) => {
        const t = e.target;
        if (!t) return;
        const tag = t.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;
        setTimeout(() => {
          try { t.scrollIntoView({ block: "center", behavior: "smooth" }); }
          catch { t.scrollIntoView(); }
        }, 280);
      });
    }
  };

  return (
    <motion.div
      onClick={closeOnBackdrop ? onClose : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: backdropOpacity }}
      transition={dragging ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.87)",
        zIndex,
        display: "flex", alignItems: "flex-end",
        maxWidth: 480, margin: "0 auto",
      }}
    >
      <motion.div
        ref={assignSheetRef}
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        initial={{ y: "100%" }}
        animate={{ y: dragY }}
        transition={dragging ? { duration: 0 } : SPRING.sheet}
        style={{
          width: "100%", background: COLOR.ground,
          borderRadius: `${RADIUS.sheet}px ${RADIUS.sheet}px 0 0`,
          padding: "18px 22px 36px",
          maxHeight: resolvedMaxHeight,
          overflowY: "auto",
          position: "relative",
          // iOS overscroll-bounce chains to the whole page otherwise,
          // which fights the gesture. Contain it here.
          overscrollBehaviorY: "contain",
          willChange: "transform",
        }}
      >
        {showHandle && (
          <div style={{
            width: 44, height: 4, background: COLOR.border,
            borderRadius: 2, margin: "0 auto 14px", flexShrink: 0,
          }} />
        )}
        {showClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: "absolute", top: 12, right: 14,
              width: 32, height: 32,
              background: COLOR.deep, border: `1px solid ${COLOR.border}`,
              color: "#aaa", borderRadius: 16,
              fontFamily: FONT.mono, fontSize: 14,
              cursor: "pointer", zIndex: 1,
            }}
          >
            ✕
          </button>
        )}
        {label && (
          <div style={{
            fontFamily: FONT.mono, fontSize: 10,
            color: COLOR.gold, letterSpacing: "0.12em",
            paddingTop: 4, marginBottom: 6,
          }}>
            {label}
          </div>
        )}
        {children}
      </motion.div>
    </motion.div>
  );
}
