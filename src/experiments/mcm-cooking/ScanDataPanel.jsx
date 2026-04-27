// ScanDataPanel — debug viewer for the latest barcode scan inside
// AddDraftSheet. Surfaces:
//
//   • SOURCE — cache hit vs OFF live, plus the source/sourceId so
//     "where did this row come from?" is glanceable.
//   • NUTRITION — kcal / protein / fat / carbs / fiber / sugar /
//     sodium per the OFF mapping (`mapNutrition` in the edge fn).
//     Per-100g vs per-serving is labeled.
//   • IDENTITY — final canonical, OFF productName / genericName,
//     detected brand, OFF categoryHints / labelTags / originTags.
//   • CORRECTION — what the family/global memory taught (if any).
//   • RAW — collapsible JSON dump of the full res + correction
//     payload for cases where a field above isn't surfaced yet.
//
// Lives at the bottom of AddDraftSheet's form below Brand. Only
// renders when a scan has populated state; manual-add mounts hide it.

import { useState } from "react";
import { font } from "./tokens";
import { withAlpha } from "./primitives";

export function ScanDataPanel({ scanDebug, theme }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!scanDebug) return null;

  const { res, correction, finalCanonicalId, offTextForInference, displayName, detectedBrand, upc, memoryBook, scan } = scanDebug;
  // `displayName` is a legacy field from before the rename to
  // offTextForInference — fall back to it so older scanDebug
  // payloads still render the OFF-text-for-inference row.
  const offText = offTextForInference || displayName || null;
  const nutrition = res?.nutrition || null;
  const per       = nutrition?.per || null;

  // Winning-source label — mirrors the canonical cascade in
  // handleScan so the panel says "memory" when the correction
  // tier was load-bearing, even if OFF returned a miss.
  //
  //   1. correction (household / global memory)
  //   2. brand_nutrition cache (lookupBarcode's offline fallback)
  //   3. OFF live (productName / canonicalId / etc.)
  //   4. inference (matched canonical from display or generic name)
  //   5. nothing (form is empty post-scan)
  const winningSource = (() => {
    if (memoryBook) {
      const c = memoryBook.bindConfidence;
      if (c === "exact")    return "AI photo · exact registry match";
      if (c === "stripped") return "AI photo · stripped to existing canonical";
      return "AI photo · new canonical from AI suggestion";
    }
    if (correction?.canonicalId === finalCanonicalId && correction?.canonicalId) {
      return correction.source === "global" ? "Global memory" : "Household memory";
    }
    if (res?.cached) return "Local brand_nutrition cache";
    if (res?.found && res?.source) return res.source;
    if (finalCanonicalId) return "Inferred from name";
    return res?.found ? (res?.source || "OFF") : "—";
  })();

  return (
    <div style={{
      marginTop: 18,
      padding: 14,
      borderRadius: 12,
      border: `1px dashed ${theme.color.hairline}`,
      background: withAlpha(theme.color.ink, 0.02),
    }}>
      <div style={{
        fontFamily: font.mono, fontSize: 10,
        letterSpacing: "0.14em", textTransform: "uppercase",
        color: theme.color.inkFaint,
        marginBottom: 8,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>Scan data</span>
        <span style={{ fontSize: 9, color: theme.color.inkFaint, letterSpacing: "0.04em" }}>
          {upc}
        </span>
      </div>

      {/* SOURCE — what tier of the cascade actually paired the
          canonical, NOT just what lookupBarcode said. A correction-
          only resolve reads "Household memory" rather than "OFF
          not found", so the user can tell whether the row landed
          via taught memory vs a fresh OFF hit. */}
      <Row theme={theme} label="Source">
        {winningSource}
        {res?.sourceId && res.sourceId !== upc && (
          <span style={{ color: theme.color.inkFaint, marginLeft: 6 }}>
            · {res.sourceId}
          </span>
        )}
        {res?.found === false && (
          <span style={{ color: theme.color.inkFaint, marginLeft: 6 }}>
            · OFF: {res?.reason || "not found"}
          </span>
        )}
      </Row>

      {/* NUTRITION */}
      {nutrition && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            fontFamily: font.mono, fontSize: 9,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: theme.color.inkFaint,
            marginBottom: 6,
          }}>
            Nutrition · per {per === "serving" ? `serving${nutrition.serving_g ? ` (${nutrition.serving_g}g)` : ""}` : "100g"}
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "4px 14px",
            fontFamily: font.mono, fontSize: 12,
            color: theme.color.ink,
          }}>
            <Macro theme={theme} label="kcal"     value={nutrition.kcal} />
            <Macro theme={theme} label="protein"  value={nutrition.protein_g} unit="g" />
            <Macro theme={theme} label="fat"      value={nutrition.fat_g}     unit="g" />
            <Macro theme={theme} label="carbs"    value={nutrition.carb_g}    unit="g" />
            <Macro theme={theme} label="fiber"    value={nutrition.fiber_g}   unit="g" />
            <Macro theme={theme} label="sugar"    value={nutrition.sugar_g}   unit="g" />
            <Macro theme={theme} label="sodium"   value={nutrition.sodium_mg} unit="mg" />
          </div>
        </div>
      )}

      {/* IDENTITY */}
      <Row theme={theme} label="Canonical" style={{ marginTop: 10 }}>
        {finalCanonicalId || <Empty theme={theme}>—</Empty>}
      </Row>
      <Row theme={theme} label="Display name">
        {displayName || <Empty theme={theme}>—</Empty>}
      </Row>
      <Row theme={theme} label="Brand">
        {detectedBrand || <Empty theme={theme}>—</Empty>}
      </Row>
      {res?.genericName && res.genericName !== displayName && (
        <Row theme={theme} label="Generic name">{res.genericName}</Row>
      )}
      {res?.quantity && (
        <Row theme={theme} label="Package quantity">{res.quantity}</Row>
      )}

      {/* TAG ARRAYS */}
      {Array.isArray(res?.categoryHints) && res.categoryHints.length > 0 && (
        <Row theme={theme} label="Category hints">{res.categoryHints.join(" · ")}</Row>
      )}
      {Array.isArray(res?.labelTags) && res.labelTags.length > 0 && (
        <Row theme={theme} label="Labels">{res.labelTags.join(" · ")}</Row>
      )}
      {Array.isArray(res?.originTags) && res.originTags.length > 0 && (
        <Row theme={theme} label="Origins">{res.originTags.join(" · ")}</Row>
      )}
      {Array.isArray(res?.countryTags) && res.countryTags.length > 0 && (
        <Row theme={theme} label="Countries">{res.countryTags.join(" · ")}</Row>
      )}

      {/* SCAN PATH — what we extracted from the OFF lookup vs. the
          USDA correction tier vs. detectBrand. Surfaces the merge
          providers ("which source contributed each field") + the
          flavor/variant claims stripped from OFF text. Critical for
          debugging "why did this row land with brand X / no name /
          tile Y" without having to dig into console.log noise. */}
      {(scan?.flavorClaims?.length > 0 || offText || finalCanonicalId || detectedBrand) && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            fontFamily: font.mono, fontSize: 9,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: theme.color.inkFaint,
            marginBottom: 6,
          }}>
            Scan path · what we extracted
          </div>
          {finalCanonicalId && (
            <Row theme={theme} label="Canonical bound">{finalCanonicalId}</Row>
          )}
          {!finalCanonicalId && (
            <Row theme={theme} label="Canonical bound">
              <span style={{ color: theme.color.burnt }}>none — name field stays empty</span>
            </Row>
          )}
          {detectedBrand && (
            <Row theme={theme} label="Brand">{detectedBrand}</Row>
          )}
          {offText && (
            <Row theme={theme} label="OFF text (inference only)">
              <span style={{ color: theme.color.inkFaint }}>{offText}</span>
            </Row>
          )}
          {Array.isArray(scan?.flavorClaims) && scan.flavorClaims.length > 0 && (
            <Row theme={theme} label="Claims extracted">
              {scan.flavorClaims.map((c, i) => (
                <span key={i} style={{
                  display: "inline-block",
                  padding: "1px 8px",
                  marginRight: 4,
                  borderRadius: 999,
                  background: withAlpha(theme.color.mustard, 0.18),
                  color: theme.color.mustard,
                  fontFamily: font.mono, fontSize: 10,
                  letterSpacing: "0.04em",
                }}>{c}</span>
              ))}
            </Row>
          )}
        </div>
      )}

      {/* MEMORY BOOK — AI photo flow's canonical decision metadata.
          Shows the bind tier (exact / stripped / guessed) plus the
          fuzzy score and any claims AI extracted, so the user can
          verify whether the canonical was a registry hit, a stripped
          variant, or a fresh AI proposal. */}
      {memoryBook && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            fontFamily: font.mono, fontSize: 9,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: theme.color.inkFaint,
            marginBottom: 6,
          }}>
            AI photo read · {memoryBook.aiConfidence || "—"}
          </div>
          <Row theme={theme} label="Bind tier">
            {memoryBook.bindConfidence}
            {memoryBook.canonicalScore != null && (
              <span style={{ color: theme.color.inkFaint, marginLeft: 6 }}>
                · score {memoryBook.canonicalScore}
              </span>
            )}
          </Row>
          {memoryBook.canonicalName && (
            <Row theme={theme} label="AI canonical">{memoryBook.canonicalName}</Row>
          )}
          {memoryBook.claims.length > 0 && (
            <Row theme={theme} label="Claims">{memoryBook.claims.join(" · ")}</Row>
          )}
        </div>
      )}

      {/* CORRECTION */}
      {correction && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            fontFamily: font.mono, fontSize: 9,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: theme.color.inkFaint,
            marginBottom: 6,
          }}>
            Learned correction · {correction.source || "household"}
          </div>
          {correction.canonicalId && <Row theme={theme} label="canonicalId">{correction.canonicalId}</Row>}
          {correction.typeId      && <Row theme={theme} label="typeId">{correction.typeId}</Row>}
          {correction.tileId      && <Row theme={theme} label="tileId">{correction.tileId}</Row>}
          {correction.location    && <Row theme={theme} label="location">{correction.location}</Row>}
          {correction.emoji       && <Row theme={theme} label="emoji">{correction.emoji}</Row>}
        </div>
      )}

      {/* RAW */}
      <button
        type="button"
        onClick={() => setShowRaw(s => !s)}
        style={{
          marginTop: 10,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: font.mono, fontSize: 10,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: theme.color.inkFaint,
        }}
      >
        {showRaw ? "▾ Hide raw" : "▸ Show raw"}
      </button>
      {showRaw && (
        <pre style={{
          marginTop: 8,
          padding: 10,
          borderRadius: 8,
          background: withAlpha(theme.color.ink, 0.04),
          border: `1px solid ${theme.color.hairline}`,
          color: theme.color.inkMuted,
          fontFamily: font.mono, fontSize: 10,
          lineHeight: 1.5,
          maxHeight: 280,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: 0,
        }}>
          {JSON.stringify({ res, correction }, null, 2)}
        </pre>
      )}
    </div>
  );
}

function Row({ theme, label, children, style }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "baseline",
      marginTop: 4, ...style,
    }}>
      <span style={{
        fontFamily: font.mono, fontSize: 9,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: theme.color.inkFaint,
        flexShrink: 0, minWidth: 92,
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: font.mono, fontSize: 12,
        color: theme.color.ink,
        wordBreak: "break-word", flex: 1, minWidth: 0,
      }}>
        {children}
      </span>
    </div>
  );
}

function Macro({ theme, label, value, unit }) {
  const empty = value == null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={{
        fontFamily: font.mono, fontSize: 9,
        letterSpacing: "0.10em", textTransform: "uppercase",
        color: theme.color.inkFaint,
        minWidth: 56,
      }}>{label}</span>
      <span style={{
        color: empty ? theme.color.inkFaint : theme.color.ink,
      }}>
        {empty ? "—" : `${value}${unit ? ` ${unit}` : ""}`}
      </span>
    </div>
  );
}

function Empty({ theme, children }) {
  return <span style={{ color: theme.color.inkFaint }}>{children}</span>;
}
