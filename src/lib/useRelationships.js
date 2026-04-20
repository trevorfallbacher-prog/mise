import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

/**
 * Loads the signed-in user's relationships (family + friends, including
 * pending invites in either direction) and exposes actions to invite/accept/
 * reject/remove.
 *
 * Each row is shaped as:
 *   {
 *     id, kind ('family'|'friend'), status ('pending'|'accepted'),
 *     direction ('outgoing'|'incoming'), otherId, other: <profile row>,
 *   }
 *
 * Profile rows are fetched in a second query once the relationship list
 * resolves. Family members' profiles come through the extended RLS policy;
 * friends' too (since they're both in connection_ids_of).
 *
 * Returns:
 *   {
 *     loading,
 *     family:      [row...] accepted family
 *     friends:     [row...] accepted friends
 *     incoming:    [row...] pending, they invited you
 *     outgoing:    [row...] pending, you invited them
 *     refresh(),
 *     invite(code, kind),     -- send invite or auto-accept if reciprocal
 *     accept(rowId, kind?),   -- accept an incoming pending row
 *     remove(rowId),          -- drop a relationship (accepted or pending)
 *     upgradeToFamily(rowId), -- switch an accepted friend to family
 *     downgradeToFriend(rowId),
 *   }
 */
export function useRelationships(userId) {
  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState(new Map()); // id → profile
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setProfiles(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("relationships")
      .select("*")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
    if (error) {
      console.error("[relationships] load failed:", error);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(data || []);

    // Hydrate profiles for the other side of each relationship.
    const otherIds = Array.from(
      new Set(
        (data || []).map(r =>
          r.requester_id === userId ? r.addressee_id : r.requester_id
        )
      )
    );
    if (otherIds.length === 0) {
      setProfiles(new Map());
      setLoading(false);
      return;
    }
    const { data: profs, error: pe } = await supabase
      .from("profiles")
      .select("id, name, dietary, vegan_style, skill_self_report, goal, invite_code")
      .in("id", otherIds);
    if (pe) {
      console.error("[relationships] profiles failed:", pe);
      setProfiles(new Map());
    } else {
      setProfiles(new Map((profs || []).map(p => [p.id, p])));
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Decorated rows — add direction + other profile inline so UI can render
  // without cross-referencing.
  const decorated = useMemo(() => {
    return rows.map(r => {
      const outgoing = r.requester_id === userId;
      const otherId  = outgoing ? r.addressee_id : r.requester_id;
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        direction: outgoing ? "outgoing" : "incoming",
        otherId,
        other: profiles.get(otherId) || null,
      };
    });
  }, [rows, profiles, userId]);

  const family   = decorated.filter(r => r.status === "accepted" && r.kind === "family");
  const friends  = decorated.filter(r => r.status === "accepted" && r.kind === "friend");
  const incoming = decorated.filter(r => r.status === "pending"  && r.direction === "incoming");
  const outgoing = decorated.filter(r => r.status === "pending"  && r.direction === "outgoing");

  // Send (or auto-accept) an invite by someone's share code.
  const invite = useCallback(async (code, kind) => {
    const cleaned = (code || "").trim().toUpperCase();
    if (!cleaned) throw new Error("enter a code");
    const { data, error } = await supabase.rpc("request_connection", {
      code: cleaned,
      relationship_kind: kind,
    });
    if (error) throw error;
    await load();
    return data;
  }, [load]);

  // Accept an incoming pending row. Optionally override the kind (if the
  // other side invited you as a friend and you want to upgrade to family).
  const accept = useCallback(async (rowId, kind) => {
    const patch = { status: "accepted" };
    if (kind) patch.kind = kind;
    const { error } = await supabase
      .from("relationships")
      .update(patch)
      .eq("id", rowId);
    if (error) throw error;
    await load();
  }, [load]);

  // Drop the relationship from either side, at any status.
  const remove = useCallback(async (rowId) => {
    const { error } = await supabase
      .from("relationships")
      .delete()
      .eq("id", rowId);
    if (error) throw error;
    await load();
  }, [load]);

  const upgradeToFamily = useCallback(async (rowId) => {
    const { error } = await supabase
      .from("relationships")
      .update({ kind: "family" })
      .eq("id", rowId);
    if (error) throw error;
    await load();
  }, [load]);

  const downgradeToFriend = useCallback(async (rowId) => {
    const { error } = await supabase
      .from("relationships")
      .update({ kind: "friend" })
      .eq("id", rowId);
    if (error) throw error;
    await load();
  }, [load]);

  // Stable key for downstream hooks — bumps whenever the accepted family set
  // changes, so usePantry / useScheduledMeals re-query and pick up newly-
  // shared rows (or hide rows from a removed family member).
  const familyKey = family.map(f => f.otherId).sort().join(",");

  return {
    loading,
    family, friends, incoming, outgoing,
    familyKey,
    refresh: load,
    invite, accept, remove,
    upgradeToFamily, downgradeToFriend,
  };
}
