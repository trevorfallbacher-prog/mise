import { useCallback, useEffect, useState } from "react";
import { CURRENT_VERSION, LATEST_RELEASE } from "../data/releaseNotes";

// LocalStorage key for the last release-notes version this user has
// seen. Stored as a plain string ("0.2.0"). Local-only — losing it
// (private browsing, cleared storage) just means the user re-sees
// the latest notification once, which is harmless.
const LS_KEY = "mise:lastSeenReleaseVersion";

/**
 * useWhatsNew — drives the post-update "what's new" notification.
 *
 * On mount, compares CURRENT_VERSION (bundled in releaseNotes.js)
 * against the user's locally-stored last-seen version. If different
 * (or unset for a returning user), opens the slim notification.
 *
 * First-paint behavior:
 *   * No stored version AND not a new install: we can't tell
 *     "first ever open" from "they cleared storage" reliably without
 *     a server round-trip. Pragmatic call: when nothing is stored,
 *     mark CURRENT as seen silently and skip the notification. The
 *     cost of a silent skip (one user misses the latest notes) is
 *     much smaller than the cost of every brand-new account being
 *     greeted with a "what's new" pop-up about features they've
 *     never seen the previous version of. Settings will have an
 *     "open release notes" entry as a re-read escape hatch (10d).
 *   * Stored version === CURRENT_VERSION: no notification.
 *   * Stored version !== CURRENT_VERSION: show notification once.
 *
 * Returns:
 *   showNotification - render the slim sheet?
 *   showFullModal    - render the full ReleaseNotesModal?
 *   openFull()       - move from notification -> full modal (does
 *                      NOT mark as seen yet; user can still dismiss
 *                      from inside the full modal)
 *   dismiss()        - mark current as seen, close everything
 *   closeFull()      - close the full modal without marking seen
 *                      (e.g. user opened from Settings to re-read)
 *   openFromSettings()- explicit entry point for the Settings menu;
 *                       opens the full modal without showing the
 *                       slim notification first
 */
export function useWhatsNew() {
  const [showNotification, setShowNotification] = useState(false);
  const [showFullModal, setShowFullModal] = useState(false);

  useEffect(() => {
    let stored = null;
    try { stored = localStorage.getItem(LS_KEY); } catch (_) { /* private mode */ }

    if (!stored) {
      // First-paint heuristic: silent mark-as-seen for unknown
      // history. Avoids greeting brand-new users with notes about
      // features they've never seen the previous version of.
      try { localStorage.setItem(LS_KEY, CURRENT_VERSION); } catch (_) {}
      return;
    }
    if (stored !== CURRENT_VERSION) {
      setShowNotification(true);
    }
  }, []);

  const markSeen = useCallback(() => {
    try { localStorage.setItem(LS_KEY, CURRENT_VERSION); } catch (_) {}
  }, []);

  const openFull = useCallback(() => {
    // Move from slim notification -> full modal. We close the
    // notification but DON'T mark as seen yet — the user is still
    // engaging; mark-as-seen happens when they dismiss the full
    // modal so the notification doesn't reappear next session.
    setShowNotification(false);
    setShowFullModal(true);
  }, []);

  const closeFull = useCallback(() => {
    setShowFullModal(false);
    // Mark seen on full-modal close so the slim notification
    // doesn't reappear after an explicit interaction with the
    // full notes.
    markSeen();
  }, [markSeen]);

  const dismiss = useCallback(() => {
    setShowNotification(false);
    setShowFullModal(false);
    markSeen();
  }, [markSeen]);

  const openFromSettings = useCallback(() => {
    // Settings entry: skip the slim notification, go straight to
    // the full view. Doesn't toggle "seen" until the user dismisses
    // — they could be re-reading old notes, no need to reset.
    setShowNotification(false);
    setShowFullModal(true);
  }, []);

  return {
    showNotification,
    showFullModal,
    openFull,
    closeFull,
    dismiss,
    openFromSettings,
    // Convenience accessors so consumers (NotificationsPanel pin,
    // future Settings header) can render version + headline without
    // re-importing the data file. Always reflect the bundled latest,
    // independent of seen state — these are facts about the release,
    // not about the user.
    latestVersion: LATEST_RELEASE?.version || CURRENT_VERSION,
    latestTitle:   LATEST_RELEASE?.title   || "What's new",
  };
}
