// ItemGrid — the animated 2-to-N column grid used for both the
// drilled-tile view and the search-hits view. Renders KitchenCard
// rows with stagger entrance + popLayout so deletions tween cleanly.

import { motion, AnimatePresence } from "framer-motion";
import { KitchenCard } from "./KitchenCard";
import { LOCATIONS } from "./helpers";

// Item grid — the animated 2-to-N column grid used for BOTH the
// drilled-tile view and the search-hits view. Factored out so the
// card-layout code isn't duplicated across the two render branches.
export function ItemGrid({ items, onOpenItem, onOpenUnitPicker, onRemoveItem, onUpdateItem, openSwipeId, setOpenSwipeId, showTileContext = false }) {
  // In search mode (showTileContext=true) each card renders a
  // small tile-context chip ("FROM DAIRY & EGGS") so users who
  // searched cross-location know where each hit lives. Resolve
  // the tile's label from LOCATIONS once per item — cheap O(N)
  // over 20 tiles so not worth memoizing.
  const tileLabelFor = (item) => {
    if (!showTileContext) return null;
    const loc = LOCATIONS.find(l => l.id === item._location);
    const tile = loc?.tiles.find(t => t.id === item._tileId);
    return tile?.label || null;
  };
  return (
    <div style={{
      display: "grid",
      // Horizontal item cards (icon left, text right) want
      // ~260px wide minimum so the name + meta row breathe
      // without truncating immediately. Auto-fit gives 1 col
      // on phones, 2 at tablet, 3 at desktop on the 960px
      // content column.
      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: 12,
      marginTop: 20,
    }}>
      <AnimatePresence mode="popLayout">
        {items.map((it, i) => (
          <motion.div
            key={it.id}
            layout
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            whileTap={{ scale: 0.97 }}
            whileHover={{ y: -2, scale: 1.01 }}
            transition={{ duration: 0.32, delay: i * 0.025, ease: [0.22, 1, 0.36, 1] }}
          >
            <KitchenCard
              item={it}
              tileLabel={tileLabelFor(it)}
              onPick={() => {
                if (onOpenItem && it._raw) onOpenItem(it._raw);
                else if (onOpenUnitPicker) onOpenUnitPicker();
              }}
              onRemove={onRemoveItem && it._raw ? () => onRemoveItem(it._raw) : null}
              onUpdate={onUpdateItem && it._raw ? (patch) => onUpdateItem(it._raw, patch) : null}
              isSwipeOpen={openSwipeId === it.id}
              onSwipeOpen={() => setOpenSwipeId && setOpenSwipeId(it.id)}
              onSwipeClose={() => {
                if (setOpenSwipeId && openSwipeId === it.id) setOpenSwipeId(null);
              }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
