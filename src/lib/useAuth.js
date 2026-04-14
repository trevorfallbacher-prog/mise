import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Subscribes to Supabase auth state. Returns:
 *   { session, user, loading }
 *
 *   - loading: true on first mount until we've heard from Supabase
 *   - session: null when signed out, the Session object when signed in
 *   - user:    convenience accessor for session.user
 */
export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export async function signOut() {
  await supabase.auth.signOut();
}
