// MCMItemCard — MCM-styled item editor sheet. Drop-in replacement
// for the legacy src/components/ItemCard.jsx mount when an MCM-grid
// card opens. Same external prop shape (item / pantry / userId /
// isAdmin / familyIds / onUpdate / onDelete / onClose) so App.jsx
// can swap freely.
//
// v1 covers the day-to-day edit path: rename, brand, identity-axis
// chips (canonical / category / state / stored-in), package size +
// remaining gauge, expires, location segment, delete, close.
// Deferred to a follow-up: nutrition deep-dive, ingredient
// composition tags, AI enrichment, cook-log provenance, reheat /
// "I ate this" / schedule-eating sheets. Tap an item that needs
// those flows and the legacy ItemCard still has the answer; this
// editor focuses on the 80% case.
//
// Patches fire onUpdate({field: value}) per-change so changes are
// persisted immediately. There's no Save button — the bottom row
// is Delete + Done.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useDragControls } from "framer-motion";
import { Kicker, withAlpha } from "./primitives";
import { useTheme, THEME_TRANSITION } from "./theme";
import {
  font, space, radius, axis, prose,
  stack, inline, divider, field, ctaButton, ghostButton,
} from "./tokens";
import {
  findIngredient, INGREDIENTS, dbCanonicalsSnapshot,
  statesForIngredient, STATE_LABELS, getIngredientInfo,
} from "../../data/ingredients";
import { useIngredientInfo } from "../../lib/useIngredientInfo";
import { canonicalImageUrlFor } from "../../lib/canonicalIcons";
import { useBodyScrollLock } from "../../lib/useBodyScrollLock";
import { useSheetDismissAtTop } from "../../lib/useSheetDismissAtTop";
import {
  LOCATIONS, shelfLifeFor, formatDaysChip, daysChipColor,
  buildDisplayName, getItemClaims,
} from "./helpers";
import { LOCATION_DOT } from "./FloatingLocationDock";
import { AddDraftHeaderPills } from "./AddDraftHeaderPills";
import { AddDraftPickers } from "./AddDraftPickers";
import { BrandPickerSheet } from "./BrandPickerSheet";

export function MCMItemCard({
  item,
  pantry,
  userId,
  isAdmin,
  familyIds,
  onUpdate,
  onDelete,
  onClose,
}) {
  const { theme } = useTheme();
  const { dbMap } = useIngredientInfo();

  // Local state mirrors the row. Each field's setter also fires
  // onUpdate immediately so the parent persists the change without
  // a Save button. We don't gate on dirty/clean state — the editor
  // is itself the source of truth while open.
  const [name,        setNameState]        = useState(item.name        || "");
  const [brand,       setBrandState]       = useState(item.brand       || "");
  const [canonicalId, setCanonicalIdState] = useState(item.canonicalId || null);
  const [typeId,      setTypeIdState]      = useState(item.typeId      || null);
  const [tileId,      setTileIdState]      = useState(item.tileId      || null);
  const [location,    setLocationState]    = useState(item.location    || "fridge");
  const [stateAxis,   setStateAxisState]   = useState(item.state       || null);
  // Cut is preserved through the editor but not yet user-editable
  // here (no cut picker in v1). Surfaces in the derived display
  // name when set so a row like (state=ground, canonical=beef,
  // cut=chuck) reads as "Ground Beef Chuck".
  const [cut] = useState(item.cut || null);
  const [amount,      setAmountState]      = useState(item.amount ?? null);
  const [max,         setMaxState]         = useState(item.max    ?? null);
  const [unit,        setUnitState]        = useState(item.unit        || "");
  const [expiresAt,   setExpiresAtState]   = useState(item.expiresAt   || null);

  // AddDraftPickers expects override flags so we feed it true-by-
  // default — every value here is already user-set (we're editing
  // an existing row), so the cascade never wants to overwrite.
  const setOverridden = () => {};
  const allCanonicals = useMemo(
    () => [...INGREDIENTS, ...dbCanonicalsSnapshot()],
    [dbMap]
  );

  // Auto-days for the expires picker's Auto preset — uses shelf-
  // life data anchored to this item's location.
  const autoDays = useMemo(() => {
    if (!canonicalId) return null;
    return shelfLifeFor(canonicalId, location, { opened: false });
  }, [canonicalId, location]);

  // Merged enrichment — admin-curated db row wins, bundled JS
  // INGREDIENT_INFO fills the gap. Returns null when neither has
  // anything to say (free-text rows with no canonical, or canonicals
  // that haven't been enriched yet — those stay quiet rather than
  // showing empty section labels).
  const enrichment = useMemo(() => {
    if (!canonicalId) return null;
    const ing    = findIngredient(canonicalId);
    const dbInfo = dbMap?.[canonicalId] || null;
    return getIngredientInfo(ing, dbInfo);
  }, [canonicalId, dbMap]);
  const hasInfo =
    enrichment
    && (enrichment.nutrition
      || enrichment.description
      || enrichment.flavorProfile
      || enrichment.prepTips
      || (Array.isArray(enrichment.pairs) && enrichment.pairs.length > 0));

  // Picker latch (canonical / category / state / tile / unit / expires)
  const [pickerOpen, setPickerOpen] = useState(null);
  const [brandEditing, setBrandEditing] = useState(false);

  // Drag-to-dismiss controls. Manual dragControls (vs. the default
  // listener-on-the-whole-element) so the sheet body stays
  // scrollable; the top grabber pill OR a pull-down-from-the-top
  // gesture starts a drag. Pulling past DRAG_DISMISS_PX or
  // releasing with enough downward velocity calls onClose;
  // otherwise framer springs it back to y=0 on release.
  const dragControls = useDragControls();
  const sheetRef = useRef(null);
  const dismissHandlers = useSheetDismissAtTop(sheetRef, dragControls);

  // Confirm-delete inline gate so a stray tap on the destructive
  // action doesn't blow away the row. First tap arms; second tap
  // commits. Auto-disarms after 4s.
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (!deleteArmed) return;
    const t = setTimeout(() => setDeleteArmed(false), 4000);
    return () => clearTimeout(t);
  }, [deleteArmed]);

  // Field-by-field setters — update local + fire patch.
  const update = (patch) => onUpdate && onUpdate(patch);
  const setName        = (v) => { setNameState(v);        update({ name: v }); };
  const setBrand       = (v) => { setBrandState(v);       update({ brand: v }); };
  const setCanonicalId = (v) => { setCanonicalIdState(v); update({ canonicalId: v }); };
  const setTypeId      = (v) => { setTypeIdState(v);      update({ typeId: v }); };
  const setTileId      = (v) => { setTileIdState(v);      update({ tileId: v }); };
  const setLocation    = (v) => { setLocationState(v);    update({ location: v }); };
  const setStateAxis   = (v) => { setStateAxisState(v);   update({ state: v }); };
  const setAmount      = (v) => { setAmountState(v);      update({ amount: v }); };
  const setUnit        = (v) => { setUnitState(v);        update({ unit: v }); };
  const setExpiresAt   = (v) => { setExpiresAtState(v);   update({ expiresAt: v }); };

  // Esc closes (matches the legacy ItemCard).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Body scroll lock — pins the body in place via position:fixed
  // so iOS can't scroll the page underneath while the sheet is
  // open. See lib/useBodyScrollLock for why overflow:hidden alone
  // doesn't work on iOS.
  useBodyScrollLock();

  // Identity helpers
  const ing      = canonicalId ? findIngredient(canonicalId) : null;
  const iconUrl  = canonicalImageUrlFor(canonicalId, null);
  const stateOpts = canonicalId ? (statesForIngredient(canonicalId) || []) : [];

  // Derived display name — re-runs as the user mutates the
  // identity components below (brand chip / canonical pick /
  // state pick), so the headline reflects the current truth.
  // Falls through to free-text `name` only when no canonical is
  // bound (the genuine pre-canonical / scratch case).
  const derivedName = useMemo(
    () => buildDisplayName({
      name, brand, canonicalId, state: stateAxis, cut,
    }),
    [name, brand, canonicalId, stateAxis, cut]
  );

  // Claims (Organic / Grass-fed / Made in Italy / etc.) read
  // straight off the raw row — these aren't editable here in
  // v1. Empty array hides the strip entirely.
  const claims = useMemo(() => getItemClaims(item), [item]);

  // Days-until-expiry display (chip-style, color follows freshness)
  const daysToExpiry = (() => {
    if (!expiresAt) return null;
    const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (Number.isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  })();

  // Quantity-gauge math (mirrors KitchenCard's slider).
  const haveGauge = Number(max) > 0 && Number.isFinite(Number(amount));
  const pct = haveGauge ? Math.max(0, Math.min(100, (Number(amount) / Number(max)) * 100)) : 0;
  const sealed = haveGauge && Number(amount) >= Number(max) - 0.0001;
  const fillColor = sealed ? theme.color.teal : theme.color.burnt;
  const step = max <= 10 ? 0.1 : max <= 100 ? 1 : max / 100;
  const fmt = (n) => Number.isInteger(n) ? String(n) : Number(n).toFixed(1);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${item.name}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(20,12,4,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        // Block iOS from interpreting backdrop touches as
        // page-level pan/zoom. Combined with the body scroll lock
        // above, the page underneath has no path to receive any
        // gesture input while this surface is up.
        touchAction: "none",
        overscrollBehavior: "contain",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
      onTouchMove={(e) => {
        // Belt-and-suspenders: if a touchmove originated on the
        // backdrop itself (not a sheet child), preventDefault to
        // make sure iOS doesn't try to fall through to the page.
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <motion.div
        ref={sheetRef}
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 32, opacity: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        // Drag-down-to-dismiss. Two entry points, both wired via
        // the same dragControls instance so framer drives the
        // animation either way:
        //   * the grabber pill at the top calls dragControls.start
        //     directly on pointerdown
        //   * useSheetDismissAtTop watches the WHOLE sheet for a
        //     pull-down gesture starting at scrollTop=0 (and
        //     skipping interactive targets), so a hard scroll past
        //     the top dismisses without the user having to land on
        //     the pill first
        // dragListener={false} keeps framer from auto-capturing
        // every pointer event; everything goes through dragControls.
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0, bottom: 0 }}
        dragMomentum={false}
        onDragEnd={(_event, info) => {
          const DRAG_DISMISS_PX  = 120;
          const DRAG_DISMISS_VEL = 500;
          if (info.offset.y > DRAG_DISMISS_PX || info.velocity.y > DRAG_DISMISS_VEL) {
            onClose && onClose();
          }
        }}
        {...dismissHandlers}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: "env(safe-area-inset-bottom, 0px)",
          marginLeft: "auto",
          marginRight: "auto",
          width: "calc(100% - 24px)",
          maxWidth: 520,
          maxHeight: "90dvh",
          overflowY: "auto",
          // Prevent scroll-chaining: when the sheet's internal scroll
          // hits its top/bottom, iOS would otherwise hand the
          // remaining scroll to the page underneath. `contain` traps
          // it inside the sheet so the background never reacts.
          overscrollBehavior: "contain",
          scrollbarGutter: "stable",
          padding: space.gap,
          borderRadius: radius.panel,
          background: theme.color.glassFillHeavy,
          border: `1px solid ${theme.color.glassBorder}`,
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          boxShadow: "0 24px 60px rgba(20,12,4,0.40), 0 4px 16px rgba(20,12,4,0.20)",
          ...THEME_TRANSITION,
        }}
      >
        {/* Drag handle — small grabber pill at the top of the sheet,
            iOS modal pattern. The wrapping div is a 24 px touch zone
            so the handle is forgiving to thumb misses. touch-action
            none prevents iOS from claiming the pointer for scroll
            before framer's drag controller starts. */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          aria-hidden
          style={{
            width: "100%",
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "grab",
            touchAction: "none",
            marginTop: -10,
            marginBottom: space.tight,
          }}
        >
          <span style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: theme.color.inkFaint,
            opacity: 0.35,
          }} />
        </div>
        {/* Header — icon + name + right-rail axis pills. Editorial
            italic for the title so it reads as the same hand as the
            rest of the MCM surface. */}
        <div style={{ ...inline(space.flow), alignItems: "flex-start" }}>
          {iconUrl && (
            <div style={{ flexShrink: 0, paddingTop: 2 }}>
              <img
                src={iconUrl}
                alt=""
                style={{
                  width: 56, height: 56, objectFit: "contain",
                  filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
                }}
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Kicker tone={theme.color.inkFaint}>Editing</Kicker>
            {/* Header name. When a canonical is bound, the title is
                DERIVED from identity components (brand + state +
                canonical + cut) per the CLAUDE.md hierarchy rule, so
                a typo'd raw.name doesn't fossilize as the visible
                title. Edits land via the identity rail at the bottom.
                When no canonical is bound (free-text / pre-canonical
                rows), the header stays a writable input — the
                user's typed text IS the row's identity until a
                canonical lands. */}
            {canonicalId ? (
              <div style={{
                fontFamily: font.itemName,
                fontStyle: "normal",
                fontWeight: 300,
                fontSize: 38,
                lineHeight: 1.05,
                letterSpacing: "0",
                color: theme.color.ink,
                marginTop: 2,
                whiteSpace: "normal",
                wordBreak: "break-word",
              }}>
                {derivedName}
              </div>
            ) : (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name this item"
                style={{
                  fontFamily: font.itemName,
                  fontStyle: "normal",
                  fontWeight: 300,
                  fontSize: 38,
                  lineHeight: 1.05,
                  letterSpacing: "0",
                  color: theme.color.ink,
                  width: "100%",
                  marginTop: 2,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  padding: 0,
                }}
              />
            )}
            {claims.length > 0 && (
              <div style={{
                marginTop: space.tight,
                fontFamily: font.detail,
                fontStyle: "italic",
                fontSize: 13,
                lineHeight: 1.4,
                color: theme.color.inkMuted,
                letterSpacing: "0.005em",
              }}>
                {claims.join(", ")}
              </div>
            )}
          </div>
          <AddDraftHeaderPills
            theme={theme}
            canonicalId={canonicalId}
            typeId={typeId}
            tileId={tileId}
            location={location}
            onPickCategory={() => setPickerOpen("category")}
            onPickTile={() => setPickerOpen("tile")}
          />
        </div>

        <hr style={{ ...divider, margin: `${space.flow}px 0` }} />

        {/* Quantity row — gauge + numeric readout. Slider sits
            inline (no toggle-to-reveal) since the editor is the
            place to fiddle; the grid card has the lighter
            tap-to-edit affordance. */}
        {haveGauge ? (
          <>
            <FieldKicker theme={theme}>
              Remaining {sealed ? "· sealed" : "· opened"}
            </FieldKicker>
            <div style={{ marginTop: space.tight }}>
              <div style={{
                height: 4,
                borderRadius: 2,
                background: withAlpha(theme.color.ink, 0.06),
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: fillColor,
                  boxShadow: `0 0 6px ${withAlpha(fillColor, 0.45)}`,
                  transition: "width 600ms cubic-bezier(0.22, 1, 0.36, 1), background 200ms ease",
                }} />
              </div>
              <div style={{ ...inline(space.tight), marginTop: space.tight }}>
                <input
                  type="range"
                  min="0"
                  max={Number(max)}
                  step={step}
                  value={Number(amount)}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  aria-label={`Estimate ${item.name} remaining`}
                  style={{ flex: 1, accentColor: fillColor }}
                />
                <span style={{
                  fontFamily: font.mono, fontSize: 11,
                  color: theme.color.inkMuted,
                  minWidth: 80, textAlign: "right", whiteSpace: "nowrap",
                }}>
                  {fmt(Number(amount))} / {fmt(Number(max))} {unit || ""}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <FieldKicker theme={theme}>Package size</FieldKicker>
            <div style={{ ...inline(space.tight), marginTop: space.tight }}>
              <input
                type="number"
                inputMode="decimal"
                value={amount ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? null : Number(e.target.value);
                  setAmount(n);
                  // No max set yet — set max = amount on first edit so
                  // the row promotes from quantityless to gauge-able.
                  if (n != null && (max == null || max <= 0)) {
                    setMaxState(n);
                    update({ max: n });
                  }
                }}
                placeholder="0"
                style={{ ...field, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => setPickerOpen("unit")}
                style={chipBtn(theme, axis.canonical, false)}
              >
                {unit || "+ Pick unit"}
              </button>
            </div>
          </>
        )}

        <hr style={{ ...divider, margin: `${space.gap}px 0 ${space.flow}px` }} />

        {/* Location segment — fridge / pantry / freezer with the
            tile picker chip stacked underneath. */}
        <FieldKicker theme={theme}>Where it lives</FieldKicker>
        <div style={{ ...stack(space.tight), marginTop: space.tight }}>
          <div style={{ ...inline(space.tight) }}>
            {LOCATIONS.map((loc) => {
              const active = location === loc.id;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => setLocation(loc.id)}
                  style={{
                    flex: 1,
                    fontFamily: font.serif,
                    fontStyle: "italic",
                    fontSize: 14,
                    color: active ? theme.color.ink : theme.color.inkMuted,
                    background: active
                      ? withAlpha(axis.storedIn, 0.18)
                      : "transparent",
                    border: `1px solid ${active ? withAlpha(axis.storedIn, 0.55) : theme.color.hairline}`,
                    borderRadius: radius.field,
                    padding: `${space.tight}px ${space.inline}px`,
                    cursor: "pointer",
                    transition: "background 200ms ease, border-color 200ms ease",
                  }}
                >
                  <span style={{ ...inline(space.tight), justifyContent: "center" }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 999,
                      background: LOCATION_DOT[loc.id] || theme.color.inkFaint,
                      opacity: active ? 1 : 0.5,
                      flexShrink: 0,
                    }} />
                    {loc.label}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen("tile")}
            style={chipBtn(theme, axis.storedIn, !tileId)}
          >
            {tileId
              ? `Stored in · ${
                  LOCATIONS.find(l => l.id === location)?.tiles.find(t => t.id === tileId)?.label
                  || tileId
                }`
              : "+ Pick a shelf"}
          </button>
        </div>

        <hr style={{ ...divider, margin: `${space.gap}px 0 ${space.flow}px` }} />

        {/* Expires — single chip. Tapping opens the preset picker
            (auto / none / today / Nd / Nw / Nm / 1y) reused from
            AddDraftPickers. */}
        <FieldKicker theme={theme}>Expires</FieldKicker>
        <div style={{ ...inline(space.tight), marginTop: space.tight }}>
          <button
            type="button"
            onClick={() => setPickerOpen("expires")}
            style={chipBtn(theme, axis.state, !expiresAt)}
          >
            {(() => {
              if (expiresAt instanceof Date) {
                const formatted = expiresAt.toLocaleDateString(undefined, {
                  month: "short", day: "numeric", year: "numeric",
                });
                return `Expires · ${formatted}`;
              }
              if (expiresAt === null) return "Doesn't expire";
              if (expiresAt === "auto") return "Auto · from canonical";
              return "+ Set expiry";
            })()}
          </button>
          {daysToExpiry != null && (
            <span style={{
              fontFamily: font.mono, fontSize: 11,
              color: daysChipColor(daysToExpiry, theme),
              whiteSpace: "nowrap",
            }}>
              {formatDaysChip(daysToExpiry)}
            </span>
          )}
        </div>

        {/* === Product information ====================================
            Read-only zone. Sits below the editable fields because the
            user works on their stuff first (rename, quantity, expiry)
            and reads the canonical's stuff second. Sections gated on
            data presence so empty enrichment doesn't clutter; on a
            free-text row with no canonical, this whole block stays
            silent. */}
        {hasInfo && (
          <>
            <hr style={{ ...divider, margin: `${space.gap}px 0 ${space.flow}px` }} />
            {enrichment.nutrition && (
              <NutritionRow nutrition={enrichment.nutrition} theme={theme} />
            )}
            {enrichment.description && (
              <AboutSection
                description={enrichment.description}
                flavorProfile={enrichment.flavorProfile}
                theme={theme}
              />
            )}
            {enrichment.prepTips && (
              <TipSection tip={enrichment.prepTips} theme={theme} />
            )}
            {Array.isArray(enrichment.pairs) && enrichment.pairs.length > 0 && (
              <PairsSection pairs={enrichment.pairs} theme={theme} />
            )}
          </>
        )}

        <hr style={{ ...divider, margin: `${space.gap}px 0 ${space.flow}px` }} />

        {/* Identity rail — brand + canonical chips. Sits at the
            bottom of the editable zone so the user works through
            the row's mutable state first (rename, quantity, where
            it lives, expiry) and only revisits identity when they
            need to (which is rarely, after the canonical lands).
            Chips here rather than full inputs because identity is
            nominal: the user isn't typing, they're picking from
            the registry. */}
        <FieldKicker theme={theme}>Identity</FieldKicker>
        <div style={{ ...inline(space.tight), flexWrap: "wrap", marginTop: space.tight }}>
          <AxisChip
            theme={theme}
            tone={theme.color.inkMuted}
            label={brand ? `Brand · ${brand}` : "+ Add brand"}
            dashed={!brand}
            onClick={() => setBrandEditing(true)}
          />
          <AxisChip
            theme={theme}
            tone={axis.canonical}
            label={ing ? `Canonical · ${ing.name}` : "+ Pick canonical"}
            dashed={!ing}
            onClick={() => setPickerOpen("canonical")}
          />
          {stateOpts.length > 0 && (
            <AxisChip
              theme={theme}
              tone={axis.state}
              label={stateAxis
                ? `State · ${STATE_LABELS[stateAxis] || stateAxis}`
                : "+ Set state"}
              dashed={!stateAxis}
              onClick={() => setPickerOpen("state")}
            />
          )}
        </div>

        <hr style={{ ...divider, margin: `${space.block}px 0 ${space.flow}px` }} />

        {/* Footer — destructive on the left, primary on the right.
            Delete arms on first tap (border + label flip burnt) and
            commits on second; this protects against stray finger
            mash on a card the user only meant to view. */}
        <div style={{ ...inline(space.flow), justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={() => {
              if (!deleteArmed) { setDeleteArmed(true); return; }
              onDelete && onDelete();
            }}
            style={{
              ...ghostButton,
              fontStyle: "italic",
              color: deleteArmed ? "#FFF8EE" : theme.color.burnt,
              background: deleteArmed
                ? "linear-gradient(180deg, #C85A1F 0%, #A34711 100%)"
                : "transparent",
              border: deleteArmed
                ? "1px solid rgba(255,255,255,0.35)"
                : `1px solid ${withAlpha(theme.color.burnt, 0.45)}`,
            }}
          >
            {deleteArmed ? "Tap again to delete" : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => onClose && onClose()}
            style={ctaButton}
          >
            Done
          </button>
        </div>
      </motion.div>

      {/* Pickers — reused from AddDraftSheet so the visual language
          matches across add and edit. The override-setter args are
          stubbed (we don't need cascade locking when editing an
          existing row). */}
      <AddDraftPickers
        pickerOpen={pickerOpen}
        setPickerOpen={setPickerOpen}
        theme={theme}
        typeId={typeId}
        setTypeId={setTypeId}
        setTypeOverridden={setOverridden}
        canonicalId={canonicalId}
        unit={unit}
        setUnit={setUnit}
        state={stateAxis}
        setState={setStateAxis}
        setStateOverridden={setOverridden}
        expiresAt={expiresAt}
        setExpiresAt={setExpiresAt}
        autoDays={autoDays}
        location={location}
        tileId={tileId}
        setTileId={setTileId}
        setTileOverridden={setOverridden}
        setCanonicalId={setCanonicalId}
        setCanonicalOverridden={setOverridden}
        allCanonicals={allCanonicals}
      />

      {brandEditing && (
        <BrandPickerSheet
          suggestions={[]}
          onPick={(b) => { setBrandEditing(false); setBrand(b); }}
          onClose={() => setBrandEditing(false)}
        />
      )}
    </div>
  );
}

// Small subhelpers — kept inline so this file is self-contained
// and doesn't reach into AddDraftSheet's internal primitives.

function FieldKicker({ theme, children }) {
  return (
    <div style={{
      fontFamily: font.mono,
      fontSize: 10,
      fontWeight: 500,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: theme.color.inkFaint,
    }}>
      {children}
    </div>
  );
}

function AxisChip({ theme, tone, label, dashed, onClick }) {
  return (
    <button type="button" onClick={onClick} style={chipBtn(theme, tone, dashed)}>
      {label}
    </button>
  );
}

// Nutrition row — single editorial line of peer-sized data, NOT
// the SaaS "hero metric + supporting stats" template. The kcal sits
// inline with the macros separated by middle dots; micros (fiber,
// sodium) get a quieter second line. Per-anchor (100g / count /
// serving) goes in the kicker so the numbers below carry weight
// alone.
function NutritionRow({ nutrition, theme }) {
  const per = nutrition.per || "100g";
  const perLabel = per === "count"
    ? "per item"
    : per === "serving"
      ? "per serving"
      : `per ${per}`;
  const macros = [];
  if (nutrition.protein_g != null) macros.push(`${formatGram(nutrition.protein_g)} protein`);
  if (nutrition.carb_g    != null) macros.push(`${formatGram(nutrition.carb_g)} carbs`);
  if (nutrition.fat_g     != null) macros.push(`${formatGram(nutrition.fat_g)} fat`);
  const micros = [];
  if (nutrition.fiber_g  != null) micros.push(`${formatGram(nutrition.fiber_g)} fiber`);
  if (nutrition.sodium_mg != null) micros.push(`${nutrition.sodium_mg}mg sodium`);
  const kcalCell = nutrition.kcal != null ? `${Math.round(nutrition.kcal)} kcal` : null;
  const primaryParts = [kcalCell, ...macros].filter(Boolean);
  if (primaryParts.length === 0 && micros.length === 0) return null;
  return (
    <section style={{ marginTop: space.flow }}>
      <FieldKicker theme={theme}>Nutrition · {perLabel}</FieldKicker>
      <div style={{
        ...stack(space.tight),
        marginTop: space.tight,
        fontFamily: font.detail,
        fontStyle: "italic",
        fontWeight: 400,
        fontSize: 15,
        color: theme.color.ink,
        letterSpacing: "0.005em",
      }}>
        {primaryParts.length > 0 && (
          <div>{primaryParts.join(" · ")}</div>
        )}
        {micros.length > 0 && (
          <div style={{ color: theme.color.inkMuted, fontSize: 14 }}>
            {micros.join(" · ")}
          </div>
        )}
      </div>
    </section>
  );
}

// About — description in editorial italic, then flavorProfile as a
// quieter second voice when available. Both capped at prose.measure
// (62ch) so a wide sheet doesn't stretch the line past the comfort
// reading band.
function AboutSection({ description, flavorProfile, theme }) {
  return (
    <section style={{ marginTop: space.gap }}>
      <FieldKicker theme={theme}>About</FieldKicker>
      <p style={{
        marginTop: space.tight,
        marginBottom: 0,
        fontFamily: font.serif,
        fontStyle: "italic",
        fontWeight: 400,
        fontSize: 15.5,
        lineHeight: 1.55,
        color: theme.color.ink,
        maxWidth: prose.measure,
      }}>
        {description}
      </p>
      {flavorProfile && (
        <p style={{
          marginTop: space.tight,
          marginBottom: 0,
          fontFamily: font.detail,
          fontStyle: "italic",
          fontSize: 13.5,
          lineHeight: 1.5,
          color: theme.color.inkMuted,
          maxWidth: prose.measure,
        }}>
          {flavorProfile}
        </p>
      )}
    </section>
  );
}

// Tip — Fraunces italic, slightly smaller than About so it reads
// as supporting copy rather than competing for the same beat.
function TipSection({ tip, theme }) {
  return (
    <section style={{ marginTop: space.gap }}>
      <FieldKicker theme={theme}>Tip</FieldKicker>
      <p style={{
        marginTop: space.tight,
        marginBottom: 0,
        fontFamily: font.serif,
        fontStyle: "italic",
        fontWeight: 400,
        fontSize: 14.5,
        lineHeight: 1.55,
        color: theme.color.ink,
        maxWidth: prose.measure,
      }}>
        {tip}
      </p>
    </section>
  );
}

// Pairs — comma-separated list of canonical names, capped at 8 to
// keep the line single-row on most viewports. Resolves ids to
// display names so the row reads as English, not slugs.
function PairsSection({ pairs, theme }) {
  const names = pairs
    .slice(0, 8)
    .map(id => findIngredient(id)?.name || prettifySlug(id))
    .filter(Boolean);
  if (names.length === 0) return null;
  return (
    <section style={{ marginTop: space.gap }}>
      <FieldKicker theme={theme}>Pairs with</FieldKicker>
      <p style={{
        marginTop: space.tight,
        marginBottom: 0,
        fontFamily: font.detail,
        fontStyle: "italic",
        fontSize: 14,
        color: theme.color.inkMuted,
        maxWidth: prose.measure,
      }}>
        {names.join(", ")}
      </p>
    </section>
  );
}

function formatGram(n) {
  if (n == null) return "0g";
  const num = Number(n);
  if (Number.isInteger(num)) return `${num}g`;
  return `${num.toFixed(1)}g`;
}

function prettifySlug(id) {
  return String(id || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function chipBtn(theme, tone, dashed) {
  return {
    fontFamily: font.serif,
    fontStyle: "italic",
    fontWeight: 400,
    fontSize: 14,
    color: theme.color.ink,
    background: dashed ? "transparent" : withAlpha(tone, 0.18),
    border: dashed
      ? `1px dashed ${withAlpha(tone, 0.55)}`
      : `1px solid ${withAlpha(tone, 0.55)}`,
    borderRadius: 999,
    padding: `${space.tight}px ${space.flow}px`,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background 200ms ease, border-color 200ms ease",
  };
}

export default MCMItemCard;
