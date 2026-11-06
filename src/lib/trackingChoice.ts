/**
 * The visitor's own decision about advertising and analytics tracking.
 *
 * Why this exists: the privacy policy states that browsing and conversion data
 * is shared with Google and Meta, and that California law treats that as
 * "sharing" for cross-context behavioural advertising regardless of whether
 * money changes hands. CPRA expects a self-serve way to say no — emailing a
 * human and waiting 45 days is a right, not a control. This is the control.
 *
 * Two independent signals, either of which means no:
 *
 *   1. An explicit choice made on /privacy-choices, stored in localStorage.
 *   2. Global Privacy Control — `navigator.globalPrivacyControl`, sent by
 *      browsers and extensions that let someone opt out of selling/sharing
 *      once, globally. California regulators treat GPC as a valid opt-out
 *      request that a business must honour, so ignoring it while offering a
 *      toggle would be answering the easy half.
 *
 * GPC is deliberately NOT written into storage. It is the browser's live
 * position, and persisting it would leave a stale "opted out" behind if the
 * visitor later turns GPC off, with no way to tell that from a real choice.
 * An explicit opt-IN does not override a live GPC signal either — the signal
 * is the more recent statement of intent on every page load.
 *
 * The mirrored guard in index.html runs before the Google and Meta snippets
 * and must agree with this module: see {@link TRACKING_CHOICE_KEY}.
 */

/**
 * localStorage key holding the explicit choice: "opted_out" or "opted_in".
 *
 * IMPORTANT: the inline guard at the top of index.html reads this exact key
 * and these exact values. It cannot import this module — it has to run before
 * any bundle loads, which is the entire point — so the string is duplicated
 * there. Change it in both places or the guard silently stops matching.
 */
export const TRACKING_CHOICE_KEY = "hql_tracking_choice";

export type TrackingChoice = "opted_out" | "opted_in" | "unset";

/** The stored choice, or "unset". Never throws: storage can be unavailable. */
export function readTrackingChoice(): TrackingChoice {
  try {
    const v = localStorage.getItem(TRACKING_CHOICE_KEY);
    return v === "opted_out" || v === "opted_in" ? v : "unset";
  } catch {
    return "unset";
  }
}

/** Records an explicit choice. Never throws. */
export function writeTrackingChoice(choice: Exclude<TrackingChoice, "unset">): void {
  try {
    localStorage.setItem(TRACKING_CHOICE_KEY, choice);
  } catch {
    /* Private mode or blocked storage. The page still reflects the choice for
       this pageview; it simply cannot be remembered, which is stated in the UI. */
  }
}

/** Whether this browser is sending Global Privacy Control. */
export function hasGlobalPrivacyControl(): boolean {
  try {
    return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  } catch {
    return false;
  }
}

/**
 * The question every tracking call should ask.
 *
 * Default is tracking allowed, matching the policy as written: this site has
 * no consent banner and does not claim one, so an un-chosen visitor is in the
 * same position as before this control existed. The control's job is to make
 * "no" possible and durable, not to silently change the default.
 */
export function isTrackingOptedOut(): boolean {
  return hasGlobalPrivacyControl() || readTrackingChoice() === "opted_out";
}

/** Why the visitor is opted out, for honest UI copy. Null when they are not. */
export function optOutReason(): "gpc" | "choice" | null {
  if (hasGlobalPrivacyControl()) return "gpc";
  if (readTrackingChoice() === "opted_out") return "choice";
  return null;
}
