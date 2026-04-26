// KitchenCard — the single-item card rendered in ItemGrid for both
// drilled-tile views and search results. Owns its own swipe-to-
// reveal Remove drawer and the inline fill-gauge slider; both
// behaviors degrade to read-only when their callbacks aren't
// wired (Showcase mode).

import { useEffect, useState } from "react";
import { motion, useMotionValue, useAnimation, useTransform } from "framer-motion";
import {
  GlassPanel, StatusDot, TintedPill, statusTintOverlay, withAlpha,
} from "./primitives";
import { useTheme } from "./theme";
import { font, space, radius } from "./tokens";
import { findIngredient } from "../../data/ingredients";
import { useIngredientInfo } from "../../lib/useIngredientInfo";
import { canonicalImageUrlFor } from "../../lib/canonicalIcons";
import {
  SWIPE_ACTION_WIDTH, shelfLifeFor, isRecent, formatDaysChip, daysChipColor,
} from "./helpers";
import { BrandPickerSheet } from "./BrandPickerSheet";

// Past this leftward offset (in px) on dragEnd, the card snaps
// fully open. Anything less snaps closed. Velocity also opens
// when fast-flicked even if displacement hasn't crossed the
// threshold yet (matches iOS Mail / Things behavior).
const SWIPE_OPEN_THRESHOLD = 36;

export function KitchenCard({
  item,
  onPick,
  tileLabel = null,
  onRemove = null,
  // Inline update — called with a partial patch when the user
  // adjusts the row in place. Currently wired to the tappable
  // fill gauge; when null the gauge is read-only.
  onUpdate = null,
  // External swipe coordination — when null these props no-op,
  // and the card manages its own swipe state in isolation.
  // When wired, the card REPORTS open/close via the callbacks
  // and SUBSCRIBES to isSwipeOpen so it auto-closes when
  // another card in the grid opens (one-card-open-at-a-time
  // iOS pattern).
  isSwipeOpen = false,
  onSwipeOpen = null,
  onSwipeClose = null,
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

  // Swipe-to-reveal state. `swipeX` is the horizontal offset
  // motion value the inner card animates against. `swipeOpen`
  // is the latched two-state — closed (x:0) or open (x:-WIDTH).
  // Drag handlers set the latch on release based on offset +
  // velocity; an effect animates `swipeX` to match. Tapping
  // the open card closes it instead of firing onPick (so a
  // user who swipes accidentally and taps doesn't open the
  // editor unintentionally).
  const swipeX = useMotionValue(0);
  const swipeControls = useAnimation();
  const [swipeOpen, setSwipeOpen] = useState(false);
  const swipeEnabled = typeof onRemove === "function";
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
  // Action-button opacity tied to swipe progress. swipeX 0 →
  // action opacity 0 (button invisible behind a closed card so
  // it doesn't bleed through GlassPanel's translucent fill);
  // swipeX -96 → opacity 1 (fully revealed). useTransform
  // clamps to [0,1] across the range automatically.
  const actionOpacity = useTransform(swipeX, [-SWIPE_ACTION_WIDTH, 0], [1, 0]);

  const animateSwipe = (toOpen, { notify = true } = {}) => {
    setSwipeOpen(toOpen);
    swipeControls.start({
      x: toOpen ? -SWIPE_ACTION_WIDTH : 0,
      transition: { type: "spring", stiffness: 420, damping: 38 },
    });
    // Notify parent so it can close other open cards on this
    // card's open, or clear the state on this card's close.
    // notify:false skips the callback when WE'RE the one being
    // told to close by the parent (avoids a feedback loop).
    if (notify) {
      if (toOpen && onSwipeOpen) onSwipeOpen();
      if (!toOpen && onSwipeClose) onSwipeClose();
    }
  };

  // External-close listener — when another card opens (parent
  // sets a different openSwipeId), this prop flips to false
  // and we animate ourselves closed without re-notifying the
  // parent (already cleared from THEIR perspective).
  // Inverse: parent reset after we closed ourselves — no-op.
  // We don't auto-OPEN from the prop change because swipe
  // open is always user-initiated (drag), never broadcast.
  useEffect(() => {
    if (!isSwipeOpen && swipeOpen) {
      animateSwipe(false, { notify: false });
    }
  }, [isSwipeOpen]);

  const handleDragEnd = (_event, info) => {
    const offsetPastThreshold = info.offset.x < -SWIPE_OPEN_THRESHOLD;
    const fastLeftFlick = info.velocity.x < -350;
    const fastRightFlick = info.velocity.x >  350;
    if (fastRightFlick) animateSwipe(false);
    else if (offsetPastThreshold || fastLeftFlick) animateSwipe(true);
    else animateSwipe(false);
  };

  const handleClick = (e) => {
    // Tapping while open closes the swipe; tapping while
    // closed opens the editor. Both cases stopPropagation so
    // the parent ItemGrid motion.div doesn't double-handle.
    if (swipeOpen) {
      e.stopPropagation();
      animateSwipe(false);
      return;
    }
    // Same one-shot dismiss pattern for the fill-gauge slider:
    // if it's open, a tap on the surrounding card closes it
    // rather than launching the full editor. Prevents the
    // jarring "I tapped near the slider and the whole card
    // opened" experience.
    if (fillEditing) {
      e.stopPropagation();
      setFillEditing(false);
      return;
    }
    if (onPick) onPick();
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    animateSwipe(false);
    if (onRemove) onRemove();
  };

  return (
    <div style={{
      // Swipe shell — clips the inner card so the Remove
      // action button doesn't show until the user drags.
      // Rounded to match the card's borderRadius so the clip
      // edge follows the same curve.
      position: "relative",
      borderRadius: 22,
      overflow: "hidden",
    }}>
      {/* Remove action — fixed behind the card on the right.
          Visually inert until the user swipes the card open,
          at which point it slides into view. Burnt-tinted to
          match CLAUDE.md's "destructive" register; the icon
          glyph is a trash bin emoji as a fallback (custom SVG
          could replace later). Hidden when swipe isn't wired
          (Showcase, no onRemove). */}
      {swipeEnabled && (
        <motion.button
          onClick={handleRemove}
          aria-label={`Remove ${item.name} from kitchen`}
          className="mcm-focusable"
          style={{
            position: "absolute",
            top: 0, right: 0, bottom: 0,
            width: SWIPE_ACTION_WIDTH,
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            border: "none",
            background: theme.color.burnt,
            color: theme.color.ctaText,
            cursor: "pointer",
            padding: 0,
            // Opacity scales with swipe progress (motion value
            // bound above) — invisible at rest, fully opaque
            // at full open. Avoids bleeding through the
            // translucent GlassPanel before the user swipes.
            opacity: actionOpacity,
          }}
        >
          <img
            src="/icons/trash.svg"
            alt=""
            aria-hidden
            style={{
              // Fill the action drawer's full vertical extent
              // with minimal padding — icon carries the affordance
              // without a redundant text label.
              height: "calc(100% - 8px)",
              width: "auto",
              maxWidth: "100%",
              objectFit: "contain",
              filter: "drop-shadow(0 1px 2px rgba(30,20,8,0.30))",
            }}
          />
        </motion.button>
      )}
    <motion.div
      // Drag-to-reveal swipe. drag="x" with constraints
      // clamped between 0 (closed) and -ACTION_WIDTH (open).
      // dragElastic 0.05 lets the user feel a subtle pull
      // past the limit without overshooting. animate is
      // controlled by swipeControls so dragEnd can snap to
      // either bistable position.
      drag={swipeEnabled ? "x" : false}
      dragConstraints={{ left: -SWIPE_ACTION_WIDTH, right: 0 }}
      dragElastic={0.05}
      dragMomentum={false}
      onDragEnd={swipeEnabled ? handleDragEnd : undefined}
      animate={swipeControls}
      style={{ x: swipeX }}
    >
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
        //
        // Right corners squared off when swipe is wired so the
        // card's exposed right edge butts flat against the
        // Remove action behind it instead of curving inward
        // and leaving a wedge gap. At rest the wrapper's clip
        // (top-right/bottom-right rounded) hides the squared
        // edge, so the resting card still looks rounded.
        ...(swipeEnabled ? {
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
        } : null),
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
    </div>
  );
}
