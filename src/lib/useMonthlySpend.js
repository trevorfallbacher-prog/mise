import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Returns the total cents spent on scanned receipts within the given month.
 * Defaults to the current month in the user's local timezone.
 *
 *   { cents, receiptCount, loading }
 *
 * We re-query whenever `userId` or `refreshKey` changes — bump refreshKey
 * after saving a receipt to pull in the new total.
 */
export function useMonthlySpend(userId, refreshKey = 0) {
  const [state, setState] = useState({ cents: 0, receiptCount: 0, loading: true });

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setState({ cents: 0, receiptCount: 0, loading: false });
      return;
    }

    // Month range in local time, formatted as YYYY-MM-DD strings since
    // receipt_date is a DATE column (no time component).
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const pad = n => String(n).padStart(2, "0");
    const startStr = `${y}-${pad(m + 1)}-01`;
    // End of month, exclusive — gives us the first of next month.
    const endDate = new Date(y, m + 1, 1);
    const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-01`;

    (async () => {
      // Pull receipts for the current month. We prefer receipt_date when
      // set (the real transaction date), falling back to created_at for
      // receipts where the OCR couldn't read one.
      const { data, error } = await supabase
        .from("receipts")
        .select("total_cents, receipt_date, created_at")
        .eq("user_id", userId)
        .or(`and(receipt_date.gte.${startStr},receipt_date.lt.${endStr}),and(receipt_date.is.null,created_at.gte.${startStr},created_at.lt.${endStr})`);

      if (!alive) return;
      if (error) {
        console.warn("[useMonthlySpend] query failed:", error.message);
        setState({ cents: 0, receiptCount: 0, loading: false });
        return;
      }

      const cents = (data || []).reduce((sum, r) => sum + (r.total_cents || 0), 0);
      setState({ cents, receiptCount: (data || []).length, loading: false });
    })();

    return () => { alive = false; };
  }, [userId, refreshKey]);

  return state;
}
