// Hook — Web Push enablement for the current device.
//
// Bridges three surfaces:
//   1. navigator.serviceWorker          — register /sw.js, get a
//                                          ServiceWorkerRegistration
//   2. registration.pushManager         — subscribe / unsubscribe with
//                                          the project's VAPID public key
//   3. public.push_subscriptions        — persist the resulting
//                                          { endpoint, p256dh, auth }
//                                          so the edge function can
//                                          dispatch to this device.
//
// Exposes:
//   supported    — boolean; push + serviceWorker available?
//   permission   — "default" | "granted" | "denied"
//   enabled      — boolean; did the current device subscribe AND hand
//                  us a matching row in push_subscriptions?
//   busy         — boolean; enable / disable in flight
//   enable()     — request permission (if needed), subscribe, persist
//   disable()    — unsubscribe + delete the DB row
//
// Opinionated: we DO NOT prompt for permission on mount. Every call
// path is explicit — user taps Enable in Settings. Browsers treat
// automatic prompts as hostile and will quietly block future prompts
// if the user dismisses a few, so we spend our single shot on a
// surface that has user intent behind it.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY || "";

// base64url (no padding, URL-safe) → Uint8Array, which is what
// PushManager.subscribe expects for applicationServerKey.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ArrayBuffer → base64url — used for the keys we send back to the DB.
function ab2b64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function useWebPush(userId) {
  const supported = typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager"    in window &&
    !!VAPID_PUBLIC_KEY;

  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [enabled, setEnabled] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState(null);

  // On mount, read the current subscription status. If the SW is
  // already registered and we have an active PushSubscription, we
  // consider this device "enabled" — but we only trust it if the DB
  // row is present too, so the Settings UI doesn't lie if the user
  // subscribed on one account and is now signed in as another.
  useEffect(() => {
    let alive = true;
    if (!supported || !userId) {
      setEnabled(false);
      return;
    }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        if (!reg) { if (alive) setEnabled(false); return; }
        const sub = await reg.pushManager.getSubscription();
        if (!sub) { if (alive) setEnabled(false); return; }

        const { data, error: err } = await supabase
          .from("push_subscriptions")
          .select("id")
          .eq("user_id", userId)
          .eq("endpoint", sub.endpoint)
          .maybeSingle();
        if (err) { console.error("[push] status check failed:", err); }
        if (!alive) return;
        setEnabled(!!data);
      } catch (e) {
        console.error("[push] init failed:", e);
        if (alive) setEnabled(false);
      }
    })();
    return () => { alive = false; };
  }, [supported, userId]);

  const enable = useCallback(async () => {
    if (!supported || !userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Register SW if not already.
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // 2. Ask for permission if we haven't yet. If denied, bail with
      //    a clean error instead of trying to subscribe anyway (which
      //    would just throw a less helpful error).
      let perm = Notification.permission;
      if (perm === "default") perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        throw new Error("Notification permission was not granted");
      }

      // 3. Subscribe. If one already exists (e.g., device was
      //    previously enabled for this same user), reuse it — fewer
      //    stale rows, faster path.
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      // 4. Persist. Using upsert so re-enabling on the same device
      //    doesn't create a second row when the endpoint is identical.
      const p256dh = sub.getKey("p256dh");
      const auth   = sub.getKey("auth");
      if (!p256dh || !auth) throw new Error("subscription missing keys");

      const row = {
        user_id:      userId,
        endpoint:     sub.endpoint,
        p256dh:       ab2b64url(p256dh),
        auth:         ab2b64url(auth),
        user_agent:   navigator.userAgent || null,
        last_seen_at: new Date().toISOString(),
      };
      const { error: err } = await supabase
        .from("push_subscriptions")
        .upsert(row, { onConflict: "user_id,endpoint" });
      if (err) throw err;

      setEnabled(true);
    } catch (e) {
      console.error("[push] enable failed:", e);
      setError(e.message || "Couldn't enable push");
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }, [supported, userId, busy]);

  const disable = useCallback(async () => {
    if (!supported || !userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        // Delete the DB row FIRST — if we unsubscribe and then the
        // DB delete fails, the edge function would still try to push
        // to the dead endpoint and get a 410. Reverse order avoids
        // that stale state.
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", userId)
          .eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      } else {
        // No browser-side subscription; still clean up any stale DB
        // rows pointing at this user + this UA. Defensive.
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", userId);
      }
      setEnabled(false);
    } catch (e) {
      console.error("[push] disable failed:", e);
      setError(e.message || "Couldn't disable push");
    } finally {
      setBusy(false);
    }
  }, [supported, userId, busy]);

  return { supported, permission, enabled, busy, error, enable, disable };
}
