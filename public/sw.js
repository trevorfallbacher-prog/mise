/* mise service worker — Web Push delivery + deep-link routing.
 *
 * Scope notes:
 *   - This is the ONLY service worker the app registers. It lives at
 *     /sw.js so its scope is the full origin.
 *   - No caching logic in v1: adding a cache layer here without a full
 *     offline-app story just breaks hot reloads in dev. Push is the
 *     whole job.
 *
 * Runtime contract:
 *   - `push`: display a notification. Payload is JSON:
 *       { id, title, body, emoji, target_kind, target_id, kind }
 *     Every field optional — we fall back to safe defaults so an
 *     empty push still surfaces something.
 *   - `notificationclick`: focus an open mise tab (postMessage the
 *     deep-link into it) OR open a new one. The running tab's
 *     message handler in App.jsx calls openNotificationTarget() with
 *     the target_kind / target_id.
 */

self.addEventListener("install", (event) => {
  // Don't wait for old SWs — push should work as soon as the user
  // enables it. Nothing stateful lives in the SW yet.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "mise";
  const body  = payload.body  || "";
  // Icons were pointing at /icon-192.png + /icon-badge-72.png which
  // don't exist in public/. Chrome falls back silently but Firefox /
  // Safari / Samsung Internet silently DROP the whole notification
  // when the icon URL 404s. Omit the icon fields until we actually
  // ship the branded PNGs — OS default (manifest icon or browser
  // fallback) renders in the meantime. Add them back when
  // public/icon-192.png and public/icon-badge-72.png exist.
  // tag prevents a stack of duplicate banners for the same logical
  // event — when the same notification row fires twice (e.g., retry),
  // the later one replaces the earlier.
  const tag   = payload.id || `mise-${Date.now()}`;

  const options = {
    body,
    tag,
    data: {
      id:          payload.id          || null,
      target_kind: payload.target_kind || null,
      target_id:   payload.target_id   || null,
      kind:        payload.kind        || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    // Prefer focusing an existing tab over opening a new one — one
    // clean state beats two competing instances of the app. The
    // focused tab gets a postMessage so App.jsx can invoke its own
    // `openNotificationTarget` with the deep-link.
    for (const client of allClients) {
      // Match any mise tab. Loose check because build origins vary
      // (localhost:3000, preview, prod). The client ALWAYS knows if
      // it's actually mise from the URL; we're just routing intent.
      if ("focus" in client) {
        await client.focus();
        client.postMessage({ kind: "notification-tap", payload: data });
        return;
      }
    }

    // No open tab — open a new one. The SPA reads the `?notify=…`
    // query and routes to the deep-link on mount.
    const url = `/?notify=${encodeURIComponent(data.id || "")}`
      + (data.target_kind ? `&target_kind=${encodeURIComponent(data.target_kind)}` : "")
      + (data.target_id   ? `&target_id=${encodeURIComponent(data.target_id)}`     : "");
    await self.clients.openWindow(url);
  })());
});
