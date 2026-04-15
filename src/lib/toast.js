import { createContext, useCallback, useContext, useState } from "react";

// Tiny toast system. The <ToastProvider> at the root of the tree holds a
// list of active toasts; any component can call useToast().push(msg) to add
// one. Toasts auto-dismiss after a few seconds.
//
// Each toast: { id, msg, emoji, kind }
//   kind ∈ 'info' (yellow) | 'success' (green) | 'warn' (amber) | 'error'

const ToastContext = createContext({ push: () => {}, toasts: [] });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((msg, { emoji = "🔔", kind = "info", ttl = 4500 } = {}) => {
    const id = crypto.randomUUID();
    setToasts(t => [...t, { id, msg, emoji, kind }]);
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, ttl);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss, toasts }}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// Stack of toasts pinned above the bottom nav (nav is 80px tall).
function ToastHost({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 96,
        left: 0, right: 0,
        maxWidth: 480, margin: "0 auto",
        padding: "0 14px",
        display: "flex", flexDirection: "column",
        gap: 8,
        zIndex: 220,
        pointerEvents: "none",
      }}
    >
      {toasts.map(t => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          style={{
            pointerEvents: "auto",
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 14px",
            background: kindBg(t.kind),
            border: `1px solid ${kindBorder(t.kind)}`,
            borderRadius: 12,
            textAlign: "left",
            cursor: "pointer",
            fontFamily: "'DM Sans',sans-serif",
            fontSize: 13,
            color: "#f0ece4",
            boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
            animation: "toastIn 0.2s ease",
          }}
        >
          <span style={{ fontSize: 20, flexShrink: 0 }}>{t.emoji}</span>
          <span style={{ flex: 1, lineHeight: 1.4 }}>{t.msg}</span>
          <style>{`@keyframes toastIn { from { transform: translateY(8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
        </button>
      ))}
    </div>
  );
}

function kindBg(kind) {
  if (kind === "success") return "#15201a";
  if (kind === "warn")    return "#201a10";
  if (kind === "error")   return "#2a1515";
  return "#1a1a1a";
}
function kindBorder(kind) {
  if (kind === "success") return "#2a3a2e";
  if (kind === "warn")    return "#3a2e1e";
  if (kind === "error")   return "#3a1e1e";
  return "#2a2a2a";
}
