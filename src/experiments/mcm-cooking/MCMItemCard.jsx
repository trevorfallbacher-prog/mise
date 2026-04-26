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

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Kicker, withAlpha } from "./primitives";
import { useTheme, THEME_TRANSITION } from "./theme";
import {
  font, space, radius, axis, editorialHead,
  stack, inline, divider, field, ctaButton, ghostButton,
} from "./tokens";
import {
  findIngredient, INGREDIENTS, dbCanonicalsSnapshot,
  statesForIngredient, STATE_LABELS,
} from "../../data/ingredients";
import { useIngredientInfo } from "../../lib/useIngredientInfo";
import { canonicalImageUrlFor } from "../../lib/canonicalIcons";
import {
  LOCATIONS, shelfLifeFor, formatDaysChip, daysChipColor,
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

  // Picker latch (canonical / category / state / tile / unit / expires)
  const [pickerOpen, setPickerOpen] = useState(null);
  const [brandEditing, setBrandEditing] = useState(false);

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

  // Identity helpers
  const ing      = canonicalId ? findIngredient(canonicalId) : null;
  const iconUrl  = canonicalImageUrlFor(canonicalId, null);
  const stateOpts = canonicalId ? (statesForIngredient(canonicalId) || []) : [];

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
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
    >
      <motion.div
        initial={{ y: 32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 32, opacity: 0 }}
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
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
        {/* Header — icon + name + right-rail axis pills. Editorial
            italic for the title so it reads as the same hand as the
            rest of the MCM surface. */}
        <div style={{ ...inline(space.flow), alignItems: "flex-start" }}>
          {(iconUrl || item.emoji) && (
            <div style={{ flexShrink: 0, paddingTop: 2 }}>
              {iconUrl ? (
                <img
                  src={iconUrl}
                  alt=""
                  style={{
                    width: 56, height: 56, objectFit: "contain",
                    filter: "drop-shadow(0 2px 4px rgba(30,30,30,0.10))",
                  }}
                />
              ) : (
                <div style={{ fontSize: 48, lineHeight: 1 }}>{item.emoji}</div>
              )}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Kicker tone={theme.color.inkFaint}>Editing</Kicker>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this item"
              style={{
                ...editorialHead,
                width: "100%",
                marginTop: 4,
                fontSize: 26,
                lineHeight: 1.1,
                color: theme.color.ink,
                background: "transparent",
                border: "none",
                outline: "none",
                padding: 0,
              }}
            />
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

        {/* Identity rail — brand + canonical chips. Reach for
            chips here rather than full inputs because the row's
            identity is nominal: the user isn't typing, they're
            picking from the registry. */}
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

        <hr style={{ ...divider, margin: `${space.gap}px 0 ${space.flow}px` }} />

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
