// KitchenCard — the single-item card rendered in ItemGrid for both
// drilled-tile views and search results. Tap opens the editor
// (MCMItemCard); the inline fill-gauge slider degrades to read-only
// when onUpdate isn't wired (Showcase mode).
//
// Horizontal swipe-to-reveal-Remove was removed in the migration to
// MCMItemCard: the framer drag was unreliable on iOS (directional
// lock + 12 px grid gap dead zone) and "tap to open, delete inside
// the editor" is the cleaner flow.

import { useState } from "react";
import { motion } from "framer-motion";
import {
  GlassPanel, StatusDot, TintedPill, statusTintOverlay, withAlpha,
} from "./primitives";
import { useTheme } from "./theme";
import { font, space, radius } from "./tokens";
import { findIngredient } from "../../data/ingredients";
import { useIngredientInfo } from "../../lib/useIngredientInfo";
import { canonicalImageUrlFor } from "../../lib/canonicalIcons";
import {
  shelfLifeFor, isRecent, formatDaysChip, daysChipColor,
} from "./helpers";
import { BrandPickerSheet } from "./BrandPickerSheet";

export function KitchenCard({
  item,
  onPick,
  tileLabel = null,
  // Inline update — called with a partial patch when the user
  // adjusts the row in place. Currently wired to the tappable
  // fill gauge; when null the gauge is read-only.
  onUpdate = null,
  // Distinct brands across the user's pantry — used as the
  // suggestion list when the "+ ADD BRAND" affordance opens
  // the BrandPickerSheet. Empty array is fine (the sheet falls
  // back to a "type one to start" empty-state copy).
  brandSuggestions = [],
}) {
  const { theme } = useTheme();
  // Canonical nutrition lookup — DB-approved info wins, bundled
  // canonical metadata fills the gap. Returns the kcal anchor
  // (per 100g / per count / etc.) so the card can surface a
  // single quick calorie chip without rolling out the full
  // breakdown panel here.
  const { getInfo } = useIngredientInfo();
  const nutrition = (() => {
    if (!item?.canonicalId) return null;
    const dbInfo = getInfo(item.canonicalId);
    const bundled = findIngredient(item.canonicalId);
    return dbInfo?.nutrition || bundled?.nutrition || null;
  })();
  const warn = item.status === "warn";
  // Warn cards pick up a gentle theme-derived burnt wash so
  // "expires soon" is noticeable at the card level without being
  // alarming. Wash follows time-of-day automatically.
  const warnOverlay = warn ? statusTintOverlay(theme, "warn") : null;
  // Bundled SVG icon for the item's canonical id if one exists
  // (public/icons/<canonical>.svg, registered in canonicalIcons
  // BUNDLED_ICON_SLUGS). Admin-generated images from
  // ingredient_info.imageUrl aren't threaded through yet — that
  // needs the IngredientInfo context, tracked as a follow-up.
  // Emoji is always the fallback.
  const canonicalId = item?._raw?.canonicalId || null;
  const iconUrl = canonicalImageUrlFor(canonicalId, null);

  // Inline fill-gauge editing — toggled by tapping the gauge
  // bar. Reveals a small slider underneath that drags the row's
  // amount between 0 and max. Live updates fire through onUpdate
  // so the user sees the bar redraw as they slide. Disabled
  // when onUpdate isn't wired (Showcase mode).
  const [fillEditing, setFillEditing] = useState(false);
  // Brand picker is a modal sheet; this latch decides whether
  // BrandPickerSheet is mounted. Tap the "+ ADD BRAND" chip to
  // open, picker calls onClose to dismiss.
  const [brandEditing, setBrandEditing] = useState(false);
  const updateEnabled = typeof onUpdate === "function";

  const handleClick = (e) => {
    // Tapping the card opens the editor — UNLESS the inline
    // fill-gauge slider is expanded, in which case the surrounding
    // tap closes it first. Prevents the jarring "I tapped near
    // the slider and the whole card opened" experience.
    if (fillEditing) {
      e.stopPropagation();
      setFillEditing(false);
      return;
    }
    if (onPick) onPick();
  };

  return (
    <>
    <motion.div
      // Spoilage aura — fixed-size green halo that lingers
      // around the card's edge when the item is warn. Shadow
      // dimensions stay constant (no growth into the
      // surrounding space); only the alpha breathes between
      // two non-zero values so the glow never disappears, just
      // pulses gently like a slow background hum. Reads as
      // "this card is in the warn state at all times" rather
      // than "every 3.6s it tries to remind me."
      //
      // initial seeds the shadow at its low-alpha baseline so
      // the aura is visible from first paint instead of fading
      // in from 0.
      initial={warn ? {
        boxShadow: "0 0 16px 3px rgba(123,156,92,0.42), 0 0 32px 6px rgba(123,156,92,0.22)",
      } : undefined}
      animate={warn ? {
        boxShadow: [
          "0 0 16px 3px rgba(123,156,92,0.42), 0 0 32px 6px rgba(123,156,92,0.22)",
          "0 0 16px 3px rgba(123,156,92,0.70), 0 0 32px 6px rgba(123,156,92,0.40)",
          "0 0 16px 3px rgba(123,156,92,0.42), 0 0 32px 6px rgba(123,156,92,0.22)",
        ],
      } : undefined}
      transition={warn ? { duration: 3.6, ease: "easeInOut", repeat: Infinity } : undefined}
      style={{
        position: "relative",
        borderRadius: 22, // match GlassPanel rounding so the
                          // glow contour follows the card edge
                          // rather than spilling square corners
      }}
    >
    <GlassPanel
      interactive
      onClick={handleClick}
      padding={10}
      style={{
        // Horizontal layout — icon on the left at 60px, text
        // column right-side stacking name + qty/brand + meta
        // row (category pill + days chip). Vertical chrome
        // tuned tight: padding 10 (was 14), minHeight 76
        // (was 92), gap 12 between icon + text (was 14). Text
        // column gap below also tightened from 4 → 2 so the
        // three lines (name / subhead / meta) feel like a
        // single label block rather than spaced-out tiers.
        position: "relative",
        display: "flex", flexDirection: "row", alignItems: "stretch",
        gap: 12, minHeight: 76,
        ...warnOverlay,
      }}
    >
      {/* Status / NEW / ok badge — absolutely positioned in the
          card's upper-right corner so it floats over both the
          icon column and the text column without taking row
          space. Same priority cascade: warn > new > ok. */}
      <div style={{ position: "absolute", top: 10, right: 12, zIndex: 1 }}>
        {warn ? (
          <StatusDot tone="warn" size={10} />
        ) : isRecent(item) ? (
          <span style={{
            fontFamily: font.mono, fontSize: 8, fontWeight: 600,
            letterSpacing: "0.10em", textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: 999,
            background: withAlpha(theme.color.teal, 0.18),
            color: theme.color.teal,
            lineHeight: 1,
          }}>
            new
          </span>
        ) : (
          <StatusDot tone="ok" size={8} />
        )}
      </div>

      {/* Icon column — only renders when the canonical has a
          bundled SVG. Emoji fallback is hidden until the icon set
          catches up; rows without artwork carry on text-only and
          read fine at the row's tight density. */}
      {iconUrl && (
        <div style={{
          display: "flex", alignItems: "center",
          flexShrink: 0,
        }}>
          <img
            src={iconUrl}
            alt=""
            style={{
              width: 60, height: 60, objectFit: "contain",
              filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
            }}
          />
        </div>
      )}

      {/* Text column — name + qty/brand + meta row. minWidth: 0
          so the inner flex children honor ellipsis truncation
          rather than overflowing the card. */}
      <div style={{
        flex: 1, minWidth: 0,
        display: "flex", flexDirection: "column",
        justifyContent: "center",
        gap: 2,
        // Right padding so the absolute status badge doesn't
        // overlap long names.
        paddingRight: 22,
      }}>
        {/* Tile-context chip when in search mode — sits above
            the name as a small kicker. */}
        {tileLabel && (
          <div style={{
            fontFamily: font.mono, fontSize: 9,
            letterSpacing: "0.10em", textTransform: "uppercase",
            color: theme.color.inkFaint,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {tileLabel}
          </div>
        )}
        {/* + ADD BRAND affordance — small UNSET_CHIP-style button
            that sits ABOVE the name when the row has no brand
            (per the CLAUDE.md identity-hierarchy spec: empty
            brand slot inline reads as broken, so the affordance
            goes on its own line above the header). Only renders
            when onUpdate is wired (Showcase mode stays inert).
            Tapping opens the BrandPickerSheet for free-form
            entry + suggestion-list pick. */}
        {!item.brand && updateEnabled && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setBrandEditing(true);
            }}
            aria-label={`Add a brand to ${item.name}`}
            className="mcm-focusable"
            style={{
              alignSelf: "flex-start",
              fontFamily: font.mono, fontSize: 9,
              color: theme.color.inkMuted,
              background: "transparent",
              border: `1px dashed ${theme.color.hairline}`,
              borderRadius: radius.chip,
              padding: `${space.nudge}px ${space.tight}px`,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              cursor: "pointer",
              marginBottom: 1,
            }}
          >
            + add brand
          </button>
        )}
        <div style={{
          // Filmotype Honey (Typekit) — Adobe Fonts face on
          // item-card NAMES so items read in a different
          // typographic register than tile cards (Pale Martini)
          // and the row's own subheader (Beverly Drive Right).
          // Single weight 300, normal style.
          fontFamily: font.itemName, fontStyle: "normal", fontWeight: 300,
          fontSize: 30, lineHeight: 1, color: theme.color.ink,
          letterSpacing: "0",
          // Filmotype Honey carries extra descender space below
          // the baseline; pull the subheader up so the row
          // doesn't read as two disconnected lines.
          marginBottom: -8,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {item.name}
        </div>
        {/* Qty + brand subheader row — Beverly Drive Right
            (font.itemSub) so the metadata reads as a paired
            second beat below the Kinescope name in the same
            display family but a distinctly different shape.
            Existing CLAUDE.md "Butter · Kerrygold" pattern. */}
        <div style={{
          display: "flex", alignItems: "baseline", gap: 6,
          fontFamily: font.itemSub, fontSize: 14,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap", overflow: "hidden",
        }}>
          <span style={{ color: theme.color.inkFaint, flexShrink: 0 }}>
            {item.qty}
          </span>
          {item.brand && (
            <>
              <span style={{ color: theme.color.inkFaint, opacity: 0.4, flexShrink: 0 }}>·</span>
              <span style={{
                color: theme.color.inkMuted,
                overflow: "hidden", textOverflow: "ellipsis",
                fontWeight: 500,
              }}>
                {item.brand}
              </span>
            </>
          )}
        </div>
        {/* Meta row — category pill on left, days chip on right.
            Renders only when at least one of the two has content,
            so cards without a category and without a date fall
            back to a tighter two-line layout. */}
        {(item.typeLabel || item.days != null || nutrition?.kcal != null) && (
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 6,
            marginTop: 0,
          }}>
            {item.typeLabel ? (
              <TintedPill
                tone="burnt"
                size="sm"
                style={{ overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {item.typeLabel}
              </TintedPill>
            ) : <span />}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              flexShrink: 0,
            }}>
              {nutrition?.kcal != null && (() => {
                // Format the per-anchor compactly: "100g" → "/100g",
                // "count" → "/ea", "serving" → "/serv". Keeps the
                // chip honest without ballooning the row.
                const per = (nutrition.per || "100g");
                const compact = per === "count" ? "/ea"
                  : per === "serving" ? "/serv"
                  : `/${per}`;
                return (
                  <span style={{
                    fontFamily: font.mono, fontSize: 10,
                    color: theme.color.inkFaint,
                    letterSpacing: "0.04em",
                    whiteSpace: "nowrap",
                  }}
                  title={`${Math.round(nutrition.kcal)} kcal per ${per}`}
                  >
                    {Math.round(nutrition.kcal)} kcal{compact}
                  </span>
                );
              })()}
              <span style={{
                fontFamily: font.mono, fontSize: 10,
                color: daysChipColor(item.days, theme),
                whiteSpace: "nowrap",
                fontWeight: warn ? 500 : 400,
              }}>
                {formatDaysChip(item.days)}
              </span>
            </div>
          </div>
        )}

        {/* Fill gauge — sealed/opened indicator. Tap to expand
            an inline slider that drags the row's amount between
            0 and max. Tap again (or the ✕) to dismiss. Bar
            tints teal when sealed and burnt when opened to
            match the AddDraftSheet's slider color treatment. */}
        {(() => {
          const max = Number(item.max);
          const amt = Number(item.amount);
          if (!(max > 0) || !Number.isFinite(amt)) return null;
          const pct = Math.max(0, Math.min(100, (amt / max) * 100));
          const sealed = amt >= max - 0.0001;
          const fill = sealed ? theme.color.teal : theme.color.burnt;
          const label = sealed
            ? `Sealed · ${item.qty}`
            : `Opened · ${pct.toFixed(0)}% remaining`;
          // Slider step — 0.1 for small packages so half-units
          // are reachable, 1 for medium, max/100 for big counts.
          const step = max <= 10 ? 0.1 : max <= 100 ? 1 : max / 100;
          const fmt = (n) => Number.isInteger(n) ? String(n) : Number(n).toFixed(1);
          return (
            <>
              <button
                type="button"
                onClick={(e) => {
                  if (!updateEnabled) return;
                  e.stopPropagation();
                  setFillEditing(prev => !prev);
                }}
                aria-label={`Adjust ${item.name} amount — currently ${label}`}
                title={updateEnabled ? "Tap to adjust how much is left" : label}
                disabled={!updateEnabled}
                style={{
                  width: "100%",
                  // Padding expands the tap target without
                  // moving the visual bar — 8px above + below
                  // the 4px bar gives a ~20px touch zone, still
                  // under Apple's 44px guideline but workable
                  // for a row-density inline control.
                  padding: "8px 0",
                  marginTop: -4,
                  background: "transparent",
                  border: "none",
                  cursor: updateEnabled ? "pointer" : "default",
                  display: "block",
                }}
              >
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: withAlpha(theme.color.ink, 0.06),
                    overflow: "hidden",
                  }}
                >
                  <div style={{
                    height: "100%", width: `${pct}%`,
                    background: fill,
                    boxShadow: `0 0 6px ${withAlpha(fill, 0.45)}`,
                    transition: "width 600ms cubic-bezier(0.22, 1, 0.36, 1), background 200ms ease",
                  }} />
                </div>
              </button>
              {updateEnabled && fillEditing && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 8,
                    padding: "8px 10px",
                    background: withAlpha(theme.color.ink, 0.04),
                    borderRadius: 10,
                    border: `1px solid ${theme.color.hairline}`,
                  }}
                >
                  <input
                    type="range"
                    min="0" max={max} step={step}
                    value={amt}
                    onChange={(e) => {
                      const newAmount = Number(e.target.value);
                      const wasSealed = amt >= max - 0.0001;
                      const isOpening = wasSealed && newAmount < max;
                      const patch = { amount: newAmount };
                      // First open — re-anchor the freshness clock
                      // off "now" against the canonical's
                      // opened-shelf-life window. Only fires when
                      // the canonical actually ships opened data;
                      // without it, the original sealed expiry
                      // stays in place (which is honest — we
                      // don't know how fast it spoils once
                      // opened, so we don't fake a date).
                      if (isOpening) {
                        const days = shelfLifeFor(
                          item.canonicalId,
                          item._location || item._raw?.location,
                          { opened: true }
                        );
                        if (Number.isFinite(days) && days > 0) {
                          const d = new Date();
                          d.setDate(d.getDate() + days);
                          d.setHours(23, 59, 0, 0);
                          patch.expiresAt = d;
                        }
                      }
                      onUpdate(patch);
                    }}
                    aria-label={`Estimate ${item.name} remaining`}
                    style={{
                      flex: 1,
                      accentColor: fill,
                    }}
                  />
                  <span style={{
                    fontFamily: font.mono, fontSize: 10,
                    color: theme.color.inkMuted,
                    minWidth: 64, textAlign: "right",
                    whiteSpace: "nowrap",
                  }}>
                    {fmt(amt)} / {fmt(max)} {item.unit || ""}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFillEditing(false); }}
                    aria-label="Close slider"
                    style={{
                      width: 22, height: 22,
                      background: "transparent",
                      border: `1px solid ${theme.color.hairline}`,
                      color: theme.color.inkMuted,
                      borderRadius: 999,
                      fontFamily: font.mono, fontSize: 10,
                      cursor: "pointer", flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </GlassPanel>
    </motion.div>
    {brandEditing && (
      <BrandPickerSheet
        suggestions={brandSuggestions}
        onPick={(brand) => {
          setBrandEditing(false);
          if (updateEnabled) onUpdate({ brand });
        }}
        onClose={() => setBrandEditing(false)}
      />
    )}
    </>
  );
}
