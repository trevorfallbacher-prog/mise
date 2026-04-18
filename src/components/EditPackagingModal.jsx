import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import ModalSheet from "./ModalSheet";
import { PackagingStep } from "./LinkIngredient";
import { Z } from "../lib/tokens";

// EditPackagingModal — admin-only surface for editing an existing
// canonical's shared packaging catalog. Loads the current
// ingredient_info row for the slug, seeds PackagingStep with the
// saved sizes + parentId, and on save upserts the new block back
// into ingredient_info. Preserves any other keys already on the
// info JSONB (description, flavorProfile, storage, etc.) via a
// read-modify-write.
//
// Gap this closes: the creation flow was the only way to set
// packaging. Once a canonical existed, sizes were locked unless
// you deleted and re-created. AdminPanel's CanonicalsList row
// only exposed parentId edits. This modal gives admins a direct
// editor for the packaging.sizes array.
//
// Props:
//   slug        — ingredient_id (canonical slug) to edit
//   name        — display name (shown in the header copy)
//   viewerId    — admin's user_id, stamped into _meta.reviewed_by
//   onClose()   — dismiss without saving
//   onSaved()   — dismiss after a successful save; parent refreshes
export default function EditPackagingModal({ slug, name, viewerId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("ingredient_info")
        .select("info")
        .eq("ingredient_id", slug)
        .maybeSingle();
      if (!alive) return;
      if (error) {
        setSaveError(`Couldn't load existing packaging: ${error.message}`);
        setInitial({});
        setLoading(false);
        return;
      }
      const info = data?.info || {};
      const pkg = info.packaging || {};
      setInitial({
        sizes: Array.isArray(pkg.sizes) ? pkg.sizes : [],
        typicalIdx: typeof pkg.defaultIndex === "number" ? pkg.defaultIndex : 0,
        parentId: info.parentId || null,
      });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [slug]);

  const handleCommit = async (block) => {
    // SKIP / null block from PackagingStep = caller cancel. For
    // the edit flow we treat it the same as dismissing without
    // saving — nothing was explicitly cleared.
    if (!block) { onClose?.(); return; }
    setSaving(true);
    setSaveError(null);
    try {
      // Read-modify-write on info so we don't clobber non-packaging
      // keys (description, flavor profile, diet flags, etc).
      const { data: existing, error: loadErr } = await supabase
        .from("ingredient_info")
        .select("info")
        .eq("ingredient_id", slug)
        .maybeSingle();
      if (loadErr) throw loadErr;
      const prev = existing?.info || {};
      const next = { ...prev };

      // Packaging block: sizes + defaultIndex (parentId lives at the
      // top level of info, not nested). PackagingStep may return
      // either or both depending on what the user filled in.
      if (Array.isArray(block.sizes) && block.sizes.length > 0) {
        next.packaging = {
          sizes: block.sizes,
          defaultIndex: typeof block.defaultIndex === "number" ? block.defaultIndex : 0,
        };
      } else {
        // User cleared every size → drop the packaging block so
        // the UI stops offering chips for this canonical.
        delete next.packaging;
      }
      if (block.parentId) next.parentId = block.parentId;
      else delete next.parentId;

      next._meta = {
        ...(prev._meta || {}),
        reviewed: true,
        reviewed_by: viewerId || null,
        reviewed_at: new Date().toISOString(),
        source: "admin_edit_packaging",
        stub: false,
      };

      const { error: upErr } = await supabase
        .from("ingredient_info")
        .upsert({ ingredient_id: slug, info: next }, { onConflict: "ingredient_id" });
      if (upErr) throw upErr;
      onSaved?.();
    } catch (e) {
      setSaveError(e.message || String(e));
      setSaving(false);
    }
  };

  return (
    <ModalSheet onClose={onClose} label={`EDIT PACKAGING · ${name || slug}`} zIndex={Z.picker}>
      <div style={{ padding: "12px 4px 8px" }}>
        {loading ? (
          <div style={{ padding: "40px 12px", textAlign: "center", color: "#666", fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
            Loading…
          </div>
        ) : (
          <>
            {saveError && (
              <div style={{
                padding: "10px 12px", marginBottom: 10,
                background: "#1a0a0a", border: "1px solid #3a1a1a",
                borderRadius: 10, color: "#ef4444",
                fontFamily: "'DM Sans',sans-serif", fontSize: 12,
              }}>
                {saveError}
              </div>
            )}
            <PackagingStep
              name={name || slug}
              slug={slug}
              initial={initial || {}}
              onCommit={handleCommit}
              onCancel={onClose}
            />
            {saving && (
              <div style={{ textAlign: "center", padding: "8px 0", color: "#888", fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.08em" }}>
                SAVING…
              </div>
            )}
          </>
        )}
      </div>
    </ModalSheet>
  );
}
