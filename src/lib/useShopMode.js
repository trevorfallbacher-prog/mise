// Shop Mode — active shopping trip + trip_scans manager.
//
// Shop Mode is the feature that marries three identity sources:
//   * OFF / barcode (high-accuracy identity)
//   * bare-bones shopping list (user intent, typed fast)
//   * receipt OCR (price + store, noisy names)
//
// This hook owns the lifecycle of a shopping_trips row:
//   startTrip()            → creates an 'active' trip row
//   upsertScan(upc, off)   → writes/bumps a trip_scans row
//   pairScanToList(scan, listItemId) → binds the scan to a list slot
//   checkoutTrip(receiptId) → marks trip 'checked_out', attaches receipt
//   cancelTrip()           → marks trip 'cancelled' (soft delete)
//
// Realtime sync keeps two phones in a family trip in step — if partner
// A scans an item, partner B sees the trip_scans row appear in their
// list instantly.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, safeChannel } from "./supabase";

function tripFromDb(row) {
  return {
    id:         row.id,
    userId:     row.user_id,
    startedAt:  row.started_at,
    endedAt:    row.ended_at,
    storeName:  row.store_name,
    receiptId:  row.receipt_id,
    status:     row.status,
  };
}

function scanFromDb(row) {
  return {
    id:                          row.id,
    tripId:                      row.trip_id,
    userId:                      row.user_id,
    scannedAt:                   row.scanned_at,
    barcodeUpc:                  row.barcode_upc,
    offPayload:                  row.off_payload || null,
    status:                      row.status,
    canonicalId:                 row.canonical_id,
    brand:                       row.brand,
    productName:                 row.product_name,
    qty:                         row.qty ?? 1,
    pairedShoppingListItemId:    row.paired_shopping_list_item_id,
    pairedPantryItemId:          row.paired_pantry_item_id,
    pairedReceiptLineIndex:      row.paired_receipt_line_index,
  };
}

export function useShopMode(userId) {
  const [activeTrip,  setActiveTrip]  = useState(null);
  const [scans,       setScans]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const tripIdRef = useRef(null);

  // Load the active trip (if any) on mount. At most one 'active' trip
  // per user at a time — partial-index enforced on the DB side (see
  // shopping_trips_status_idx in migration 0126).
  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data: trips } = await supabase
      .from("shopping_trips")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1);
    const trip = (trips || [])[0];
    if (!trip) {
      setActiveTrip(null);
      setScans([]);
      tripIdRef.current = null;
      return;
    }
    setActiveTrip(tripFromDb(trip));
    tripIdRef.current = trip.id;
    const { data: tripScans } = await supabase
      .from("trip_scans")
      .select("*")
      .eq("trip_id", trip.id)
      .order("scanned_at", { ascending: true });
    setScans((tripScans || []).map(scanFromDb));
  }, [userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refresh();
      if (!alive) return;
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [refresh]);

  // Realtime — watch trip_scans for the active trip so partner
  // updates land without a poll.
  useEffect(() => {
    if (!activeTrip?.id) return;
    const channel = safeChannel(`trip-scans-${activeTrip.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "trip_scans", filter: `trip_id=eq.${activeTrip.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = scanFromDb(payload.new);
            setScans(prev => prev.some(s => s.id === incoming.id) ? prev : [...prev, incoming]);
          } else if (payload.eventType === "UPDATE") {
            const incoming = scanFromDb(payload.new);
            setScans(prev => prev.map(s => s.id === incoming.id ? incoming : s));
          } else if (payload.eventType === "DELETE") {
            const gone = payload.old?.id;
            setScans(prev => prev.filter(s => s.id !== gone));
          }
        })
      .subscribe();
    return () => { try { channel?.unsubscribe?.(); } catch { /* noop */ } };
  }, [activeTrip?.id]);

  const startTrip = useCallback(async () => {
    if (!userId) return null;
    const { data, error } = await supabase
      .from("shopping_trips")
      .insert({ user_id: userId, status: "active" })
      .select("*")
      .single();
    if (error) {
      console.warn("[shop-mode] startTrip failed:", error.message);
      return null;
    }
    const trip = tripFromDb(data);
    setActiveTrip(trip);
    setScans([]);
    tripIdRef.current = trip.id;
    return trip;
  }, [userId]);

  // Upsert a scan: re-scanning the same UPC on the same trip bumps
  // qty rather than creating a new row. The unique(trip_id,
  // barcode_upc) constraint from migration 0126 enforces this at the
  // DB level; here we read-then-update-or-insert so we stay within
  // postgrest's API (no raw SQL).
  const upsertScan = useCallback(async ({ upc, offPayload, canonicalId, brand, productName, status }) => {
    const tripId = tripIdRef.current;
    if (!tripId || !userId || !upc) return null;
    // Check if this UPC already has a row on this trip.
    const existing = (scans || []).find(s => s.barcodeUpc === upc);
    if (existing) {
      const nextQty = (existing.qty || 1) + 1;
      const { data, error } = await supabase
        .from("trip_scans")
        .update({ qty: nextQty })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) {
        console.warn("[shop-mode] upsertScan bump failed:", error.message);
        return existing;
      }
      const bumped = scanFromDb(data);
      setScans(prev => prev.map(s => s.id === bumped.id ? bumped : s));
      return bumped;
    }
    const { data, error } = await supabase
      .from("trip_scans")
      .insert({
        trip_id:       tripId,
        user_id:       userId,
        barcode_upc:   upc,
        off_payload:   offPayload || null,
        status:        status || "red",
        canonical_id:  canonicalId || null,
        brand:         brand || null,
        product_name:  productName || null,
        qty:           1,
      })
      .select("*")
      .single();
    if (error) {
      console.warn("[shop-mode] upsertScan insert failed:", error.message);
      return null;
    }
    const fresh = scanFromDb(data);
    setScans(prev => prev.some(s => s.id === fresh.id) ? prev : [...prev, fresh]);
    return fresh;
  }, [scans, userId]);

  const adjustScanQty = useCallback(async (scanId, nextQty) => {
    if (!scanId || !Number.isFinite(nextQty) || nextQty < 1) return;
    const { data, error } = await supabase
      .from("trip_scans")
      .update({ qty: nextQty })
      .eq("id", scanId)
      .select("*")
      .single();
    if (error) {
      console.warn("[shop-mode] adjustScanQty failed:", error.message);
      return;
    }
    const next = scanFromDb(data);
    setScans(prev => prev.map(s => s.id === next.id ? next : s));
  }, []);

  const pairScanToList = useCallback(async (scanId, listItemId) => {
    if (!scanId) return;
    const { data, error } = await supabase
      .from("trip_scans")
      .update({ paired_shopping_list_item_id: listItemId || null })
      .eq("id", scanId)
      .select("*")
      .single();
    if (error) {
      console.warn("[shop-mode] pairScanToList failed:", error.message);
      return;
    }
    const next = scanFromDb(data);
    setScans(prev => prev.map(s => s.id === next.id ? next : s));
  }, []);

  const checkoutTrip = useCallback(async ({ receiptId = null, storeName = null } = {}) => {
    const tripId = tripIdRef.current;
    if (!tripId) return null;
    const { data, error } = await supabase
      .from("shopping_trips")
      .update({
        status: "checked_out",
        ended_at: new Date().toISOString(),
        receipt_id: receiptId || null,
        store_name: storeName || null,
      })
      .eq("id", tripId)
      .select("*")
      .single();
    if (error) {
      console.warn("[shop-mode] checkoutTrip failed:", error.message);
      return null;
    }
    const trip = tripFromDb(data);
    setActiveTrip(null);
    setScans([]);
    tripIdRef.current = null;
    return trip;
  }, []);

  const cancelTrip = useCallback(async () => {
    const tripId = tripIdRef.current;
    if (!tripId) return;
    await supabase
      .from("shopping_trips")
      .update({ status: "cancelled", ended_at: new Date().toISOString() })
      .eq("id", tripId);
    setActiveTrip(null);
    setScans([]);
    tripIdRef.current = null;
  }, []);

  return {
    activeTrip,
    scans,
    loading,
    startTrip,
    upsertScan,
    adjustScanQty,
    pairScanToList,
    checkoutTrip,
    cancelTrip,
    refresh,
  };
}
