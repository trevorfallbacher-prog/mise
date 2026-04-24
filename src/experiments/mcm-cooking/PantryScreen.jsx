// Pantry screen — the entry point for the MCM cooking-app experiment.
// Warm parchment backdrop, glass search + filter bar, 2-column grid
// of glass item cards. Each card shows: emoji icon, name (serif),
// quantity (mono), location pill, teal status dot.

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  WarmBackdrop, GlassPanel, PrimaryButton,
  StatusDot, Kicker, SerifHeader, FadeIn, Starburst,
  GlassPill, TintedPill, BottomDock,
  ItemIcon, statusTintOverlay,
} from "./primitives";
import { resolveIcon } from "./icons";
import { color, font } from "./tokens";

// iconKey resolves via `resolveIcon(key)` → { asset, emoji }. Once
// branded SVGs land in public/mcm-icons, only icons.js changes.
const ITEMS = [
  { id: 1, iconKey: "butter",     name: "Kerrygold Butter",    qty: "1 stick",    location: "Dairy & Eggs",    cat: "dairy",   status: "ok",      days: 12 },
  { id: 2, iconKey: "eggs",       name: "Pasture Eggs",         qty: "8 large",    location: "Dairy & Eggs",    cat: "dairy",   status: "ok",      days: 18 },
  { id: 3, iconKey: "milk",       name: "Whole Milk",           qty: "½ gallon",   location: "Dairy & Eggs",    cat: "dairy",   status: "warn",    days: 3 },
  { id: 4, iconKey: "cheese",     name: "Gruyère",              qty: "6 oz",       location: "Dairy & Eggs",    cat: "dairy",   status: "ok",      days: 22 },
  { id: 5, iconKey: "lemon",      name: "Meyer Lemons",         qty: "4 whole",    location: "Produce",         cat: "produce", status: "ok",      days: 9 },
  { id: 6, iconKey: "garlic",     name: "Garlic",               qty: "1 head",     location: "Produce",         cat: "produce", status: "ok",      days: 30 },
  { id: 7, iconKey: "kale",       name: "Tuscan Kale",          qty: "1 bunch",    location: "Produce",         cat: "produce", status: "warn",    days: 2 },
  { id: 8, iconKey: "tomato_can", name: "San Marzano",          qty: "28 oz can",  location: "Pantry",          cat: "pantry",  status: "ok",      days: 180 },
  { id: 9, iconKey: "bread",      name: "Sourdough Loaf",       qty: "1 loaf",     location: "Pantry",          cat: "pantry",  status: "ok",      days: 5 },
  { id:10, iconKey: "olive_oil",  name: "Olive Oil",            qty: "500 ml",     location: "Pantry",          cat: "pantry",  status: "ok",      days: 120 },
  { id:11, iconKey: "salmon",     name: "Wild Salmon",          qty: "0.75 lb",    location: "Meat & Seafood",  cat: "meat",    status: "warn",    days: 1 },
  { id:12, iconKey: "chicken",    name: "Chicken Thighs",       qty: "1.5 lb",     location: "Meat & Seafood",  cat: "meat",    status: "ok",      days: 3 },
];

const FILTERS = [
  { id: "all",     label: "All"      },
  { id: "dairy",   label: "Dairy"    },
  { id: "produce", label: "Produce"  },
  { id: "meat",    label: "Meat"     },
  { id: "pantry",  label: "Pantry"   },
];

export default function PantryScreen({ onStartCooking, onOpenUnitPicker }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => ITEMS.filter((it) => {
    if (filter !== "all" && it.cat !== filter) return false;
    if (query && !it.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [filter, query]);

  const goodCount = ITEMS.filter((i) => i.status === "ok").length;

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      <WarmBackdrop variant="pantry" />

      <div style={{
        position: "relative",
        maxWidth: 480,
        margin: "0 auto",
        padding: "28px 20px 120px",
      }}>
        {/* --- Hero ----------------------------------------------------- */}
        <FadeIn>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Kicker>Tuesday · 4:12 PM</Kicker>
            <TintedPill
              tone="teal"
              mono
              size="sm"
              style={{ textTransform: "uppercase", letterSpacing: "0.10em" }}
            >
              <StatusDot tone="ok" size={6} /> {goodCount} on hand
            </TintedPill>
          </div>

          <SerifHeader size={52} style={{ marginTop: 6 }}>
            The Pantry
          </SerifHeader>
          <p style={{
            marginTop: 16, fontFamily: font.sans, fontSize: 15,
            color: color.inkMuted, lineHeight: 1.55, maxWidth: 340,
          }}>
            Twelve good things on the shelf. Enough for dinner, breakfast,
            and a quiet afternoon snack.
          </p>
        </FadeIn>

        {/* --- Search + filters ---------------------------------------- */}
        <FadeIn delay={0.06}>
          <GlassPanel
            tone="input"
            variant="input"
            padding={14}
            style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}
          >
            <SearchGlyph />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the pantry…"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: font.sans,
                fontSize: 15,
                color: color.ink,
              }}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                style={{
                  border: "none", background: "transparent", cursor: "pointer",
                  color: color.inkMuted, fontFamily: font.mono, fontSize: 12,
                }}
              >
                CLEAR
              </button>
            )}
          </GlassPanel>

          <div style={{
            display: "flex", gap: 8, marginTop: 14,
            overflowX: "auto", paddingBottom: 4,
          }}>
            {FILTERS.map((f) => (
              <GlassPill
                key={f.id}
                active={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </GlassPill>
            ))}
          </div>
        </FadeIn>

        {/* --- Grid ----------------------------------------------------- */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginTop: 20,
        }}>
          <AnimatePresence mode="popLayout">
            {visible.map((it, i) => (
              <motion.div
                key={it.id}
                layout
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.32, delay: i * 0.025, ease: [0.22, 1, 0.36, 1] }}
              >
                <PantryCard item={it} onPick={onOpenUnitPicker} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {visible.length === 0 && (
          <FadeIn>
            <div style={{
              marginTop: 40, textAlign: "center",
              fontFamily: font.serif, fontStyle: "italic",
              fontSize: 20, color: color.inkMuted,
            }}>
              Nothing matches that search.
            </div>
          </FadeIn>
        )}

        {/* --- Cook CTA ------------------------------------------------- */}
        <FadeIn delay={0.12}>
          <GlassPanel
            tone="warm"
            padding={18}
            style={{
              marginTop: 28,
              display: "flex", alignItems: "center", gap: 14,
              position: "relative", overflow: "hidden",
            }}
          >
            <Starburst
              size={140}
              color="rgba(217,107,43,0.14)"
              style={{ position: "absolute", top: -40, right: -40 }}
            />
            <ItemIcon
              icon={resolveIcon("pasta_dish")}
              size={56}
              tone="warm"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Kicker tone={color.burnt}>Ready when you are</Kicker>
              <div style={{
                fontFamily: font.serif, fontStyle: "italic", fontWeight: 300,
                fontSize: 20, color: color.ink, marginTop: 2, letterSpacing: "-0.01em",
              }}>
                Lemon-butter pasta
              </div>
              <div style={{
                fontFamily: font.sans, fontSize: 12, color: color.inkMuted, marginTop: 2,
              }}>
                6 of 7 ingredients on hand · 18 min
              </div>
            </div>
            <PrimaryButton onClick={onStartCooking} style={{ padding: "12px 18px", fontSize: 14 }}>
              Cook
            </PrimaryButton>
          </GlassPanel>
        </FadeIn>
      </div>

      <BottomDock
        tabs={NAV_TABS}
        activeId="pantry"
        onSelect={(id) => { if (id === "cook") onStartCooking && onStartCooking(); }}
      />
    </div>
  );
}

const NAV_TABS = [
  { id: "pantry", label: "Pantry", glyph: "🥫" },
  { id: "cook",   label: "Cook",   glyph: "🍳" },
  { id: "plan",   label: "Plan",   glyph: "📅" },
  { id: "you",    label: "You",    glyph: "🌿" },
];

// --- Sub-components ------------------------------------------------------

function PantryCard({ item, onPick }) {
  const warn = item.status === "warn";
  // Good / warn cards get a gentle temperature wash so they read
  // as different states of the same glass material, not identical
  // surfaces. Overlay is supplied by the primitives layer so the
  // two tints stay symmetrical.
  const statusOverlay = statusTintOverlay(warn ? "warn" : "ok");
  const iconTone = warn ? "warm" : "cool";

  return (
    <GlassPanel
      interactive
      onClick={onPick}
      padding={14}
      style={{
        display: "flex", flexDirection: "column",
        gap: 10, minHeight: 148,
        ...statusOverlay,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <ItemIcon
          icon={resolveIcon(item.iconKey)}
          size={52}
          tone={iconTone}
        />
        <StatusDot tone={warn ? "warn" : "ok"} size={warn ? 10 : 8} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: font.serif, fontStyle: "italic", fontWeight: 400,
          fontSize: 18, lineHeight: 1.15, color: color.ink,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {item.name}
        </div>
        <div style={{
          fontFamily: font.mono, fontSize: 11, color: color.inkFaint,
          marginTop: 4, letterSpacing: "0.02em",
        }}>
          {item.qty}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <TintedPill
          tone="teal"
          size="sm"
          style={{ overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {item.location}
        </TintedPill>
        <span style={{
          fontFamily: font.mono, fontSize: 10,
          color: warn ? color.burnt : color.inkMuted,
          whiteSpace: "nowrap",
          fontWeight: warn ? 500 : 400,
        }}>
          {item.days}d
        </span>
      </div>
    </GlassPanel>
  );
}

function SearchGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="7" fill="none" stroke={color.inkMuted} strokeWidth="1.6" />
      <path d="M16.5 16.5 L21 21" stroke={color.inkMuted} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

