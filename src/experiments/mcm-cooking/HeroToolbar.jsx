// Hero toolbar buttons — Receipt and Cart pills pinned to the
// pantry hero's top-right corner. Both render as 60×60 circular
// glass affordances with optional badges (dollars-this-month
// for the receipt, item count for the cart).

import { motion } from "framer-motion";
import { useTheme, THEME_TRANSITION } from "./theme";
import { font } from "./tokens";

// Shopping-cart button — top-right floating affordance that
// carries the user from pantry-browse into the shopping-list
// view. Absolutely positioned in the PantryScreen content
// wrapper (which is position:relative) so it rides in the upper-
// right regardless of hero content below. 44x44 circular glass
// Receipt button — 60×60 glass pill in the hero top-right
// with the bundled receipt.svg. Optional `spendCents` shows up
// as a small burnt dollar-amount badge pinned to the upper-
// right corner.
export function ReceiptButton({ spendCents = 0, onClick }) {
  const { theme } = useTheme();
  const dollars = Math.round(spendCents / 100);
  const formatted = dollars >= 1000
    ? `$${(dollars / 1000).toFixed(1)}k`
    : `$${dollars}`;
  const label = spendCents > 0
    ? `Receipt history · ${formatted} this month`
    : "Receipt history";
  return (
    <motion.button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="mcm-focusable"
      whileHover={{ y: -2, scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{
        position: "relative",
        width: 60, height: 60,
        borderRadius: 999,
        border: `1px solid ${theme.color.glassBorder}`,
        background: theme.color.glassFillHeavy,
        backdropFilter: "blur(14px) saturate(150%)",
        WebkitBackdropFilter: "blur(14px) saturate(150%)",
        boxShadow: theme.shadow.soft,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", padding: 0,
        ...THEME_TRANSITION,
      }}
    >
      <img
        src="/icons/receipt.svg"
        alt="" aria-hidden
        style={{
          width: 38, height: 38, objectFit: "contain",
          filter: "drop-shadow(0 1px 2px rgba(30,30,30,0.12))",
        }}
      />
      {spendCents > 0 && (
        <span style={{
          position: "absolute",
          top: -6, right: -8,
          minWidth: 22, height: 22,
          padding: "0 7px",
          borderRadius: 999,
          background: theme.color.burnt,
          color: theme.color.ctaText,
          fontFamily: font.mono, fontSize: 11, fontWeight: 600,
          letterSpacing: "-0.02em",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 6px rgba(168,73,17,0.35)",
          border: `1px solid ${theme.color.glassBorder}`,
        }}>
          {formatted}
        </span>
      )}
    </motion.button>
  );
}

// Cart button — 60×60 glass pill with the bundled
// shopping_cart.svg. Burnt count badge appears when the
// shopping list has items.
export function CartButton({ count = 0, onClick }) {
  const { theme } = useTheme();
  const label = count === 0
    ? "Shopping list"
    : `Shopping list · ${count} item${count === 1 ? "" : "s"}`;
  return (
    <motion.button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="mcm-focusable"
      whileHover={{ y: -2, scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      style={{
        position: "relative",
        width: 60, height: 60,
        borderRadius: 999,
        border: `1px solid ${theme.color.glassBorder}`,
        background: theme.color.glassFillHeavy,
        backdropFilter: "blur(14px) saturate(150%)",
        WebkitBackdropFilter: "blur(14px) saturate(150%)",
        boxShadow: theme.shadow.soft,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", padding: 0,
        ...THEME_TRANSITION,
      }}
    >
      <img
        src="/icons/shopping_cart.svg"
        alt="" aria-hidden
        style={{
          width: 38, height: 38, objectFit: "contain",
          filter: "drop-shadow(0 1px 2px rgba(30,30,30,0.12))",
        }}
      />
      {count > 0 && (
        <span style={{
          position: "absolute",
          top: -4, right: -4,
          minWidth: 22, height: 22,
          padding: "0 6px",
          borderRadius: 999,
          background: theme.color.burnt,
          color: theme.color.ctaText,
          fontFamily: font.mono, fontSize: 11, fontWeight: 600,
          letterSpacing: "-0.02em",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 6px rgba(168,73,17,0.35)",
          border: `1px solid ${theme.color.glassBorder}`,
        }}>
          {count}
        </span>
      )}
    </motion.button>
  );
}
