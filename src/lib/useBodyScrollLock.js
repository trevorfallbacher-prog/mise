import { useEffect } from "react";

// Bulletproof body scroll lock for iOS Safari.
//
// `document.body.style.overflow = "hidden"` works on desktop but
// iOS ignores it for the same gesture-driven scroll mechanics that
// produce rubber-band momentum: a touch on a covering overlay
// still drags the underlying page. Every iOS app that "does this
// fine" pins the body in place via position:fixed and restores the
// scroll position on unmount.
//
// What this does, in order:
//   1. record current scrollY so we can restore it on cleanup
//   2. push html + body to overflow:hidden (kills desktop scroll)
//   3. pin body with position:fixed + top:-scrollY so the page
//      literally cannot scroll on iOS — the body is now a fixed
//      box and gestures have nothing to scroll
//   4. on unmount: restore every property to its prior value and
//      window.scrollTo(0, scrollY) so the user lands back where
//      they were before the sheet opened
//
// Stash-and-restore (vs. naive empty-string assignment) is the
// reason this composes safely with other surfaces that might be
// setting body styles for their own reasons. We never blow away a
// caller's overflow / position; we put it back.
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const prev = {
      htmlOverflow:  html.style.overflow,
      bodyOverflow:  body.style.overflow,
      bodyPosition:  body.style.position,
      bodyTop:       body.style.top,
      bodyLeft:      body.style.left,
      bodyRight:     body.style.right,
      bodyWidth:     body.style.width,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top      = `-${scrollY}px`;
    body.style.left     = "0";
    body.style.right    = "0";
    body.style.width    = "100%";
    body.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow         = prev.htmlOverflow;
      body.style.overflow         = prev.bodyOverflow;
      body.style.position         = prev.bodyPosition;
      body.style.top              = prev.bodyTop;
      body.style.left             = prev.bodyLeft;
      body.style.right            = prev.bodyRight;
      body.style.width            = prev.bodyWidth;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}
