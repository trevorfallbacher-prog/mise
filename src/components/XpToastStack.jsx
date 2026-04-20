import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useXpEvents } from "../lib/useXpEvents";
import XpToast from "./XpToast";

// Stack of XP toasts in the top-right. Owns the realtime
// subscription (one per AuthedApp lifetime) and exposes a mute
// control via context so CookCompleteSummary can suppress the
// stack while its beat sequence plays — beats and toasts
// competing for attention is the exact UX failure §5 warns
// against.
//
// Throttling: each toast displays for ~2s. To avoid a literal
// stack of five overlapping toasts when bulk-import scans land,
// the queue presents at most MAX_VISIBLE at once and stages
// the rest with a STAGGER_MS delay between fires.

const MAX_VISIBLE = 3;
const STAGGER_MS  = 400;

const XpToastsCtx = createContext({ mute: () => {} });
export const useXpToasts = () => useContext(XpToastsCtx);

export default function XpToastStack({ userId }) {
  const { queue, consume, mute } = useXpEvents(userId);
  const [visible, setVisible] = useState([]);
  const stagedRef = useRef(new Set());

  // Stage new queue rows into `visible` with throttling.
  useEffect(() => {
    if (queue.length === 0) return;
    const fresh = queue.filter((r) => !stagedRef.current.has(r.id));
    if (fresh.length === 0) return;
    let cancelled = false;
    let delay = 0;
    fresh.forEach((row) => {
      stagedRef.current.add(row.id);
      setTimeout(() => {
        if (cancelled) return;
        setVisible((prev) => [...prev, row].slice(-MAX_VISIBLE));
      }, delay);
      delay += STAGGER_MS;
    });
    return () => { cancelled = true; };
  }, [queue]);

  // When XpToast self-dismisses, drop it from visible and the
  // upstream queue so the same row isn't re-staged on a future
  // queue diff.
  const handleDismiss = (id) => {
    setVisible((prev) => prev.filter((r) => r.id !== id));
    consume(id);
    stagedRef.current.delete(id);
  };

  return (
    <XpToastsCtx.Provider value={{ mute }}>
      <div style={{
        position: "fixed",
        top: 60,
        right: 12,
        zIndex: 8000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}>
        {visible.map((row) => (
          <div key={row.id} style={{ pointerEvents: "auto" }}>
            <XpToast row={row} onDismiss={handleDismiss} />
          </div>
        ))}
      </div>
    </XpToastsCtx.Provider>
  );
}
