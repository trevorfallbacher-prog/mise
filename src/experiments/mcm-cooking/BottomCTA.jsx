// Bottom-of-pantry CTA variants: TriageCTA when there's something
// to use up soon, FreshCTA when the kitchen is healthy, and the
// design-reference ShowcaseDemoCTA used by Showcase.jsx. All three
// share the same panel shape (icon + text stack + button) so they
// read as a typographic family, not three different layouts.

import { GlassPanel, PrimaryButton, Starburst, Kicker, FadeIn, withAlpha } from "./primitives";
import { useTheme } from "./theme";
import { font } from "./tokens";
import { canonicalImageUrlFor } from "../../lib/canonicalIcons";
import { isRecent, sumLocationTiles } from "./helpers";

// Triage CTA — the real-mode replacement for the design-demo
// "Cook · Lemon-butter pasta" card. Only renders in real-items
// mode (when onOpenItem is wired) AND only when there are warn
// items to triage. Copy pivots with count: singular / plural /
// "all gone today" flavor. Tap opens the single most-urgent
// item's editor via the same shared overlay the tile cards use.
// When count > 1, the button's label doubles as "see all" and
// we pre-select the FIRST-expiring row — user can close and
// re-open from the pantry to reach the next one, rather than
// the CTA itself becoming a list.
export function TriageCTA({ warnCount, firstExpiring, onOpenItem }) {
  const { theme } = useTheme();
  if (!firstExpiring) return null;
  const days = firstExpiring.days;
  const daysCopy = days == null
    ? "now"
    : days < 0
      ? "already past"
      : days === 0
        ? "today"
        : `in ${days} day${days === 1 ? "" : "s"}`;
  const kicker = warnCount === 1 ? "One to use soon" : `${warnCount} to use soon`;
  const body = firstExpiring.name;
  const sub = `Expires ${daysCopy}${firstExpiring.brand ? ` · ${firstExpiring.brand}` : ""}`;
  return (
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
        {/* Left accent rule — a 4px wide burnt strip running the
            full height of the card. Same magazine pull-quote
            cue that says "this side bar has something urgent to
            tell you." Positioned absolute so it hugs the card
            edge regardless of padding; rounds with the panel's
            corner via inherit so it doesn't stick out past the
            rounded-rect shape. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            width: 4,
            background: theme.color.burnt,
            borderTopLeftRadius: "inherit",
            borderBottomLeftRadius: "inherit",
          }}
        />
        <Starburst
          size={140}
          color="rgba(217,107,43,0.14)"
          style={{ position: "absolute", top: -40, right: -40 }}
        />
        {/* Icon slot — prefers the expiring item's own icon /
            emoji (bread loaf for sourdough, chicken for chicken,
            etc.) so the card reads as "THIS is the thing" rather
            than a generic hourglass. Falls back to ⏳ only when
            nothing's resolvable. Marked marginLeft:4 so it
            doesn't sit on the burnt accent rule. */}
        {(() => {
          const raw = firstExpiring?._raw || null;
          const iconUrl = canonicalImageUrlFor(raw?.canonicalId || null, null);
          const emoji = firstExpiring?.emoji || "⏳";
          if (iconUrl) {
            return (
              <img
                src={iconUrl}
                alt=""
                aria-hidden
                style={{
                  width: 44, height: 44, objectFit: "contain",
                  marginLeft: 4,
                  filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
                }}
              />
            );
          }
          return (
            <div style={{
              // 42px so the emoji fallback matches the 44×44 img
              // render visual weight (emoji glyph boxes cap at
              // ~95% of fontSize).
              fontSize: 42, lineHeight: 1, marginLeft: 4,
              filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
            }}>{emoji}</div>
          );
        })()}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Kicker tone={theme.color.burnt}>{kicker}</Kicker>
          <div style={{
            // Pale Martini display face — sits in the same
            // typographic family as the hero + drilled header
            // so the bottom CTA reads as a continuation of the
            // page, not a separate component. Single weight,
            // no variable axes.
            fontFamily: font.display,
            fontWeight: 400,
            fontSize: 20, color: theme.color.ink, marginTop: 2,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {body}
          </div>
          <div style={{
            fontFamily: font.sans, fontSize: 12, color: theme.color.inkMuted, marginTop: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {sub}
          </div>
        </div>
        <PrimaryButton
          onClick={() => onOpenItem(firstExpiring._raw)}
          style={{ padding: "12px 18px", fontSize: 14 }}
        >
          Open
        </PrimaryButton>
      </GlassPanel>
    </FadeIn>
  );
}

// Showcase demo CTA — the design-reference "Lemon-butter pasta"
// pitch used only by Showcase.jsx (where onStartCooking is wired
// but onOpenItem is not). Hardcoded copy by intent: this is the
// surface that appears in screenshots, not real-mode UI.
export function ShowcaseDemoCTA({ onStartCooking }) {
  const { theme } = useTheme();
  return (
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
        <div style={{ fontSize: 36, lineHeight: 1 }}>🍳</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Kicker tone={theme.color.burnt}>Ready when you are</Kicker>
          <div style={{
            fontFamily: font.serif, fontStyle: "italic", fontWeight: 300,
            fontSize: 20, color: theme.color.ink, marginTop: 2, letterSpacing: "-0.01em",
          }}>
            Lemon-butter pasta
          </div>
          <div style={{
            fontFamily: font.sans, fontSize: 12, color: theme.color.inkMuted, marginTop: 2,
          }}>
            6 of 7 ingredients on hand · 18 min
          </div>
        </div>
        <PrimaryButton onClick={onStartCooking} style={{ padding: "12px 18px", fontSize: 14 }}>
          Cook
        </PrimaryButton>
      </GlassPanel>
    </FadeIn>
  );
}

// Fresh CTA — shown in real mode when the pantry is stocked and
// nothing's expiring soon. Replaces the empty space below the
// tile grid with a forward-looking "what's for dinner?" pull,
// the friendly counterpart to TriageCTA. Copy adapts to the
// current state: a fresh grocery run within the last 24h
// foregrounds the new arrivals; otherwise it just leans on the
// total stock count + shelf breadth so the message reads as
// personal rather than generic.
export function FreshCTA({ cards, cardsByLocTile, onStartCooking }) {
  const { theme } = useTheme();
  const total = cards.length;
  const newCards = cards.filter(isRecent);
  const fresh = newCards.length;
  // Count how many of the three locations have something in them
  // — "across 3 shelves" reads more meaningfully than a flat item
  // count when the pantry is broadly stocked.
  const populatedLocations = ["fridge", "pantry", "freezer"]
    .filter(loc => sumLocationTiles(cardsByLocTile[loc]) > 0).length;
  const kicker = fresh > 0 ? "Fresh on the shelves" : "Stocked & ready";
  const headline = fresh > 0
    ? `${fresh} new ${fresh === 1 ? "arrival" : "arrivals"}`
    : populatedLocations >= 2
      ? "Pantry's looking good"
      : `${total} item${total === 1 ? "" : "s"} on hand`;
  const subline = fresh > 0
    ? `${total} on hand · added in the last 24h`
    : populatedLocations >= 2
      ? `${total} items across ${populatedLocations} shelves · all fresh`
      : "Nothing expiring soon";
  return (
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
        {/* Left accent rule — teal here (vs. burnt on TriageCTA)
            so the user reads "this is the positive variant" at a
            glance. Same shape and position as TriageCTA's accent
            so the two CTAs feel like a typographic pair, not two
            different layouts. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            width: 4,
            background: theme.color.teal,
            borderTopLeftRadius: "inherit",
            borderBottomLeftRadius: "inherit",
          }}
        />
        <Starburst
          size={140}
          color={withAlpha(theme.color.teal, 0.14)}
          style={{ position: "absolute", top: -40, right: -40 }}
        />
        <div style={{
          fontSize: 36, lineHeight: 1, marginLeft: 4,
          filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
        }}>
          {fresh > 0 ? "🌿" : "🍽️"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Kicker tone={theme.color.teal}>{kicker}</Kicker>
          <div style={{
            fontFamily: font.display,
            fontWeight: 400,
            fontSize: 20, color: theme.color.ink, marginTop: 2,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {headline}
          </div>
          <div style={{
            fontFamily: font.sans, fontSize: 12, color: theme.color.inkMuted, marginTop: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {subline}
          </div>
        </div>
        <PrimaryButton
          onClick={onStartCooking}
          style={{ padding: "12px 18px", fontSize: 14 }}
        >
          Plan
        </PrimaryButton>
      </GlassPanel>
    </FadeIn>
  );
}
