import { createClient } from "@supabase/supabase-js";

const url = process.env.REACT_APP_SUPABASE_URL;
const key = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Loud warning in dev so it's obvious the env isn't set
  // (in production this would mean a misconfigured deploy)

  console.error(
    "Supabase env vars are missing. " +
      "Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY to your .env file, " +
      "then restart `npm start`."
  );
}

export const supabase = createClient(url ?? "", key ?? "");

/**
 * StrictMode-safe realtime channel factory.
 *
 * Wraps `supabase.channel(topic)` so we never hand back an already-subscribed
 * channel — which is what causes "cannot add postgres_changes callbacks
 * after subscribe()" errors in dev.
 *
 * The sharp edge: `.channel(topic)` is topic-deduped on the client. In
 * React StrictMode (and during any effect re-run whose cleanup hasn't
 * finished its async removal yet), the second mount gets back the
 * channel the first mount already subscribed. Calling `.on()` on that
 * already-subscribed channel throws.
 *
 * Fix: before creating, find and force-remove any existing channel with
 * the same topic. This is a no-op when there isn't one (first mount,
 * normal case). The returned channel is guaranteed fresh — caller does
 * the usual `.on(...).subscribe()` on it.
 *
 * Usage:
 *   const ch = safeChannel("rt:user_badges:" + userId)
 *     .on("postgres_changes", {...}, handler)
 *     .subscribe();
 *   return () => { supabase.removeChannel(ch); };
 */
export function safeChannel(topic, opts) {
  // Supabase tags its channel topics with a "realtime:" prefix internally;
  // match on `.topic` which already includes the prefix.
  const fullTopic = `realtime:${topic}`;
  for (const c of supabase.getChannels()) {
    if (c.topic === fullTopic) supabase.removeChannel(c);
  }
  return supabase.channel(topic, opts);
}
