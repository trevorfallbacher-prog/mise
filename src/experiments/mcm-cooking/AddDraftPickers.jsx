// AddDraftPickers — the six ModalSheet pickers that hang off
// AddDraftSheet's `pickerOpen` state. Extracted from
// AddDraftSheet.jsx (which had grown past the 1500-line tripwire)
// so the parent stays focused on form state + cascade resolution
// while the picker presentation lives in one obvious place.
//
// Render contract: parent owns `pickerOpen` + every value/setter
// the pickers mutate; this component just maps the current
// pickerOpen value to a MCMPickerSheet variant. No local state.

import { AnimatePresence } from "framer-motion";
import { MCMPickerSheet } from "./MCMPickerSheet";
import { axis } from "./tokens";
import {
  LOCATIONS, DEFAULT_UNIT_OPTIONS,
} from "./helpers";
import {
  findIngredient,
  statesForIngredient, STATE_LABELS,
} from "../../data/ingredients";
import { FOOD_TYPES } from "../../data/foodTypes";

export function AddDraftPickers({
  pickerOpen,
  setPickerOpen,
  theme,
  // category
  typeId,
  setTypeId,
  setTypeOverridden,
  // unit (also reads canonicalId for ingredient-specific units)
  canonicalId,
  unit,
  setUnit,
  // state
  state,
  setState,
  setStateOverridden,
  // expires
  expiresAt,
  setExpiresAt,
  autoDays,
  // tile
  location,
  tileId,
  setTileId,
  setTileOverridden,
  // canonical
  setCanonicalId,
  setCanonicalOverridden,
  allCanonicals,
}) {
  // AnimatePresence sits at the top so the underlying motion.div in
  // MCMPickerSheet runs its `exit` keyframe on dismount. Without this
  // the picker just disappears the instant pickerOpen flips back to
  // null — felt jarring next to the snappy spring entry. mode="wait"
  // because exactly one picker is open at a time, so we want the
  // outgoing one to finish before any incoming one mounts.
  return (
    <AnimatePresence mode="wait">
      {pickerOpen === "category" && (
        <MCMPickerSheet
          kicker="Category"
          title="What category does this fit?"
          accent={theme.color.burnt}
          options={FOOD_TYPES.map(t => ({
            id: t.id, label: t.label, emoji: t.emoji, sub: t.blurb,
          }))}
          value={typeId}
          onPick={(id) => {
            setTypeId(id);
            setTypeOverridden(true);
            setPickerOpen(null);
          }}
          onClose={() => setPickerOpen(null)}
        />
      )}
      {pickerOpen === "unit" && (() => {
        const ing = canonicalId ? findIngredient(canonicalId) : null;
        const units = ing?.units && ing.units.length > 0
          ? ing.units
          : DEFAULT_UNIT_OPTIONS;
        return (
          <MCMPickerSheet
            kicker="Unit"
            title={ing ? `Pick a unit for ${ing.name}` : "Pick a unit"}
            accent={theme.color.teal}
            options={units.map(u => ({
              id: u.id,
              label: u.label || u.id,
              // Sub line shows the canonical's default if any —
              // helps users see which unit is the "natural" one
              // for that ingredient (e.g. butter → sticks).
              sub: ing?.defaultUnit === u.id ? "default" : null,
            }))}
            value={unit}
            onPick={(id) => { setUnit(id); setPickerOpen(null); }}
            onClose={() => setPickerOpen(null)}
          />
        );
      })()}
      {pickerOpen === "state" && canonicalId && (() => {
        const opts = statesForIngredient(canonicalId) || [];
        return (
          <MCMPickerSheet
            kicker="State"
            title="What state is it in?"
            accent={axis.state}
            options={opts.map(s => ({
              id: s,
              label: STATE_LABELS[s] || s,
            }))}
            value={state}
            onPick={(id) => {
              setState(id);
              setStateOverridden(true);
              setPickerOpen(null);
            }}
            onClose={() => setPickerOpen(null)}
          />
        );
      })()}
      {pickerOpen === "expires" && (() => {
        // Auto leads — system-derived expiry from the canonical's
        // shelf-life data. Auto's sub-line previews the
        // estimate when the canonical exposes one. Same
        // humanizer the pill uses so the picker doesn't read
        // "~365 days from today" while the pill says "in ~1
        // year".
        const humanizeWindow = (days) => {
          if (days <= 0) return "today";
          if (days === 1) return "tomorrow";
          if (days < 14) return `${days} days from today`;
          if (days < 30) return `~${Math.round(days / 7)} weeks from today`;
          if (days < 365) return `~${Math.round(days / 30)} months from today`;
          const years = Math.round(days / 365);
          return `~${years} year${years === 1 ? "" : "s"} from today`;
        };
        const autoSub = autoDays
          ? humanizeWindow(autoDays)
          : "Smart guess from the canonical";
        const presets = [
          { id: "auto",    label: "Auto",           sub: autoSub,                      kind: "auto" },
          { id: "none",    label: "Doesn't expire", sub: "Shelf-stable",               kind: "none" },
          { id: "today",   label: "Today",          sub: "Use it now",                 days: 0 },
          { id: "3d",      label: "3 days",         sub: "Fresh produce, leftovers",   days: 3 },
          { id: "1w",      label: "1 week",         sub: "Most fridge items",          days: 7 },
          { id: "2w",      label: "2 weeks",        sub: "Cured meats, hard cheese",   days: 14 },
          { id: "1m",      label: "1 month",        sub: "Dairy with seal",            days: 30 },
          { id: "3m",      label: "3 months",       sub: "Pantry / freezer",           days: 90 },
          { id: "6m",      label: "6 months",       sub: "Long-life pantry",           days: 180 },
          { id: "1y",      label: "1 year",         sub: "Canned, dry goods",          days: 365 },
        ];
        return (
          <MCMPickerSheet
            kicker="Expires"
            title="When does this go bad?"
            accent={axis.state}
            options={presets.map(p => ({
              id: p.id, label: p.label, sub: p.sub,
            }))}
            value={
              expiresAt === "auto" ? "auto"
              : expiresAt === null ? "none"
              : null
            }
            onPick={(id) => {
              const p = presets.find(x => x.id === id);
              if (!p) return;
              if (p.kind === "auto") {
                setExpiresAt("auto");
              } else if (p.kind === "none") {
                setExpiresAt(null);
              } else {
                const d = new Date();
                d.setDate(d.getDate() + p.days);
                d.setHours(23, 59, 0, 0);
                setExpiresAt(d);
              }
              setPickerOpen(null);
            }}
            onClose={() => setPickerOpen(null)}
          />
        );
      })()}
      {pickerOpen === "tile" && (() => {
        const loc = LOCATIONS.find(l => l.id === location);
        const tiles = loc?.tiles || [];
        return (
          <MCMPickerSheet
            kicker="Stored in"
            title={`Which ${loc?.label.toLowerCase() || "shelf"} tile?`}
            accent={axis.storedIn}
            options={tiles.map(t => ({
              id: t.id, label: t.label, emoji: t.emoji, sub: t.blurb,
            }))}
            value={tileId}
            onPick={(id) => {
              setTileId(id);
              setTileOverridden(true);
              setPickerOpen(null);
            }}
            onClose={() => setPickerOpen(null)}
          />
        );
      })()}
      {pickerOpen === "canonical" && (
        <MCMPickerSheet
          kicker="Canonical"
          title="Which ingredient is this?"
          accent={axis.canonical}
          options={allCanonicals.map(ing => ({
            id: ing.id,
            label: ing.name,
            emoji: ing.emoji,
            // Sub line uses the category as a quick scope
            // signal so two similarly-named canonicals
            // (e.g. "milk" dairy vs "coconut milk" pantry)
            // are distinguishable mid-list.
            sub: ing.category ? ing.category : null,
          }))}
          value={canonicalId}
          onPick={(id) => {
            setCanonicalId(id);
            setCanonicalOverridden(true);
            setPickerOpen(null);
          }}
          onClose={() => setPickerOpen(null)}
        />
      )}
    </AnimatePresence>
  );
}
