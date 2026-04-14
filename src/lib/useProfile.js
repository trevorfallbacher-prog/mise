import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";

/**
 * Loads the profile row for the given user id. Returns:
 *   { profile, loading, error, refresh, upsert }
 *
 *   - profile: null if no row exists yet (user hasn't completed onboarding)
 *   - upsert(partial): insert-or-update the profile row for this user
 */
export function useProfile(userId) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) setError(error);
    setProfile(data ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const upsert = useCallback(
    async (partial) => {
      if (!userId) throw new Error("upsert called without a userId");
      const row = { id: userId, ...partial };
      const { data, error } = await supabase
        .from("profiles")
        .upsert(row, { onConflict: "id" })
        .select()
        .single();
      if (error) throw error;
      setProfile(data);
      return data;
    },
    [userId]
  );

  return { profile, loading, error, refresh: load, upsert };
}
