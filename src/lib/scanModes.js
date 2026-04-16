// Scanner mode definitions.
//
// One scanner, three contexts. The user picks an icon at the top — that
// determines (a) the label/copy shown throughout the flow, (b) the
// location new items will land in (fridge / pantry / freezer), and
// (c) which Edge Function handles the vision call (scan-receipt for
// receipts, scan-shelf for everything else).
//
// Kept in its own module so Scanner.jsx (currently inline in Pantry.jsx)
// can import instead of reaching into the parent file — prepares the
// ground for the Scanner extraction without requiring it all at once.

export const SCAN_MODES = [
  {
    id: "fridge",
    icon: "🥬",
    label: "Fridge",
    location: "fridge",
    title: "What's in the fridge?",
    blurb: "Snap a shot of the open fridge — we'll catalog what we see.",
    cta: "SCAN FRIDGE →",
    badge: "FRIDGE SCAN",
  },
  {
    id: "pantry",
    icon: "🥫",
    label: "Pantry",
    location: "pantry",
    title: "What's on the shelf?",
    blurb: "Photo of a pantry shelf or open cabinet — we'll count what's there.",
    cta: "SCAN SHELF →",
    badge: "PANTRY SCAN",
  },
  {
    id: "receipt",
    icon: "🧾",
    label: "Receipt",
    // null → fall back to category-based default per item.
    location: null,
    title: "Got groceries?",
    blurb: "Photo your receipt and we'll stock your pantry automatically.",
    cta: "SCAN RECEIPT →",
    badge: "RECEIPT SCAN",
  },
];

// Color + label + ordering for the confidence tag a scanned item carries.
// Receipts get treated as "high" by default — OCR is deterministic enough
// that we don't want every receipt row screaming for review. Shelf scans
// (scan-shelf) supply their own tag per item, since opaque containers and
// frosted-over labels are exactly the kinds of things the user needs to
// double-check.
export const CONFIDENCE_STYLES = {
  high:   { label: "HIGH",  color: "#4ade80", bg: "#0f1a0f", border: "#1e3a1e", order: 2 },
  medium: { label: "MED",   color: "#f5c842", bg: "#1a1608", border: "#3a2f10", order: 1 },
  low:    { label: "LOW",   color: "#f59e0b", bg: "#1a0f00", border: "#3a2810", order: 0 },
};

export const confidenceStyle = c => CONFIDENCE_STYLES[c] || CONFIDENCE_STYLES.medium;
