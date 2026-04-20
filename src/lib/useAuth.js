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
      // Seed realtime with the initial access token so the socket
      // opens authenticated. Without this, realtime uses the anon
      // key and RLS-filtered subscriptions silently drop user-scoped
      // rows (notifications, cook_logs, etc.).
      if (data.session?.access_token) {
        supabase.realtime.setAuth(data.session.access_token);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
      // Realtime's socket caches the JWT at open time and won't
      // rotate it on its own. Every auth transition (TOKEN_REFRESHED
      // fires roughly hourly, also SIGNED_IN / SIGNED_OUT) re-seeds
      // the transport so inbound rows continue to pass the RLS
      // check after the original token would have expired. Bug
      // symptom without this: realtime notifications work on first
      // load, then quietly stop ~1 hour in until the user hard-
      // refreshes and opens a fresh socket.
      supabase.realtime.setAuth(s?.access_token ?? null);
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
