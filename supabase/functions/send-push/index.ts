// Supabase Edge Function: send-push
//
// Invoked by the DB trigger fanout_notification_push (migration 0053)
// every time a row lands in public.notifications. Signs and dispatches
// a Web Push message to every active push_subscriptions row belonging
// to the target user.
//
// Deploy:
//   supabase functions deploy send-push --no-verify-jwt
//   supabase secrets set VAPID_PUBLIC_KEY=B...
//   supabase secrets set VAPID_PRIVATE_KEY=...
//   supabase secrets set VAPID_SUBJECT=mailto:admin@example.com
//
// The trigger calls us with a service_role Bearer token (populated
// from app.settings.supabase_service_key set in the DB). We verify
// that token before doing anything — if anyone else hits the
// endpoint directly they get a 401 instead of permission-free access
// to every user's subscriptions.
//
// Request body:
//   {
//     userId: "<uuid>",
//     notification: {
//       id:          "<uuid>",             // notifications.id, used as notification.tag
//       title:       "mise",
//       body:        "Alice added Butter",
//       emoji:       "🧈",
//       kind:        "pantry_edit",
//       target_kind: "pantry_scan" | "receipt" | "cook_log" | "user_profile" | null,
//       target_id:   "<uuid>" | null
//     }
//   }
//
// Response:
//   { ok: true, sent: <n>, pruned: <n> }
//
// Dead-endpoint handling: push services return 404 (Gone) or 410
// (Expired Subscription) when a subscription is no longer valid
// (browser cleared site data, user blocked push, etc). We DELETE
// the row so future notifications don't retry the dead endpoint.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

type PushSubRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type Notification = {
  id?: string;
  title?: string;
  body?: string;
  emoji?: string;
  kind?: string;
  target_kind?: string | null;
  target_id?: string | null;
};

// Top-level wrapper so ANY unhandled throw inside the handler gets
// caught and returned as a structured JSON error with the stack.
// Previously unhandled errors bubbled to Deno.serve's default
// handler, which returns the string "Internal Server Error" to
// pg_net — opaque and un-diagnosable from SQL.
async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: JSON_HEADERS,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPub    = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPriv   = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubj   = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "server missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
  if (!vapidPub || !vapidPriv) {
    return new Response(
      JSON.stringify({ error: "server missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — run `supabase secrets set VAPID_PUBLIC_KEY=…`" }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  // Authorization — the caller must present either the service-role
  // key (DB trigger path) or the anon key with a valid user JWT. We
  // accept only the service-role key here because the DB trigger is
  // the only legitimate caller; direct client invocations would be a
  // privilege-escalation surface.
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== serviceKey) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  let body: { userId?: string; notification?: Notification };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400, headers: JSON_HEADERS,
    });
  }
  if (!body?.userId || !body?.notification) {
    return new Response(
      JSON.stringify({ error: "body needs { userId, notification }" }),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  // setVapidDetails throws synchronously on malformed keys or subject
  // (e.g. subject missing the `mailto:` / `https://` prefix, keys at
  // the wrong byte length, etc). An unhandled throw here returns a
  // generic "Internal Server Error" string to pg_net which swallows
  // it; wrap in try/catch so the next invocation returns a structured
  // error that actually tells us what's wrong.
  try {
    webpush.setVapidDetails(vapidSubj, vapidPub, vapidPriv);
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.error("[send-push] setVapidDetails threw:", msg);
    return new Response(
      JSON.stringify({
        error: "vapid_setup_failed",
        detail: msg,
        subjectStartsWith: vapidSubj.slice(0, 8),
        publicLen: vapidPub.length,
        privateLen: vapidPriv.length,
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pull every active subscription for this user. If none, the
  // notification row still exists (in-app path is independent); we
  // just have nothing to push.
  const { data: subs, error: loadErr } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("user_id", body.userId);
  if (loadErr) {
    console.error("[send-push] load failed:", loadErr);
    return new Response(
      JSON.stringify({ error: "couldn't load subscriptions", detail: loadErr.message }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
  if (!subs?.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0, pruned: 0 }), { headers: JSON_HEADERS });
  }

  const payload = JSON.stringify({
    id:          body.notification.id ?? null,
    title:       body.notification.title || "mise",
    body:        body.notification.body  || "",
    emoji:       body.notification.emoji || null,
    kind:        body.notification.kind  || null,
    target_kind: body.notification.target_kind ?? null,
    target_id:   body.notification.target_id   ?? null,
  });

  // Dispatch in parallel. Individual failures get logged; dead
  // endpoints (404 / 410) get pruned so we stop retrying them.
  let sent = 0;
  const pruneIds: string[] = [];
  const tasks = (subs as PushSubRow[]).map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60 * 60 * 24 },  // 24h — push services drop anything older
      );
      sent++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        pruneIds.push(sub.id);
      } else {
        console.error("[send-push] dispatch failed:", status, (err as Error)?.message);
      }
    }
  });
  await Promise.allSettled(tasks);

  if (pruneIds.length > 0) {
    const { error: pruneErr } = await supabase
      .from("push_subscriptions")
      .delete()
      .in("id", pruneIds);
    if (pruneErr) {
      console.error("[send-push] prune failed:", pruneErr);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, sent, pruned: pruneIds.length }),
    { headers: JSON_HEADERS },
  );
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    const stack = (e as Error)?.stack || "";
    console.error("[send-push] UNHANDLED:", msg, "\n", stack);
    return new Response(
      JSON.stringify({
        error: "unhandled_exception",
        detail: msg,
        stack: stack.split("\n").slice(0, 6).join("\n"),
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
});
