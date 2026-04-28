// Star Citizen patch cycle metadata.
//
// A "patch cycle" is the window between two patches going live. The
// admin Patch Exports view scopes refinery logs and login events to a
// patch's [startedAt, endedAt) interval — endedAt = the next patch's
// startedAt, or "now" if this is the current patch.
//
// Update this list when a new patch releases:
//   1. Set the current patch's startedAt if it was null.
//   2. Add the new patch entry above the current one.
//
// Timestamps are unix epoch ms. Approximations are fine — the actual SC
// patch release moments aren't recorded with second-level precision in
// this app's data anyway. Adjust as needed; the export endpoint reads
// this list at runtime.

export const PATCHES = [
  // Newest first. When a future-dated patch goes live, its startedAt is
  // already correct — patchRange() naturally treats it as released once
  // Date.now() crosses startedAt.
  { version: "4.8", startedAt: Date.UTC(2026, 4, 14) /* 2026-05-14 */ },
  { version: "4.7.2", startedAt: Date.UTC(2026, 3, 22) /* 2026-04-22 */ },
];

/**
 * Resolve a patch's [from, to) range. `to` is the start of the next
 * patch, or `Date.now()` if this is the current (no later patch with a
 * known start date).
 *
 * Returns null if the requested patch isn't in the list, or if its
 * startedAt is null (un-released).
 */
export function patchRange(version) {
  const idx = PATCHES.findIndex((p) => p.version === version);
  if (idx === -1) return null;
  const patch = PATCHES[idx];
  if (!patch.startedAt) return null;
  // Future-dated patches haven't started yet; nothing to range over.
  if (patch.startedAt > Date.now()) return null;

  // PATCHES is ordered newest-first, so the *previous* index is the
  // patch that comes after this one chronologically. Skip patches whose
  // startedAt is in the future — they don't end this cycle yet.
  const now = Date.now();
  let nextStartedAt = null;
  for (let i = idx - 1; i >= 0; i--) {
    const candidate = PATCHES[i].startedAt;
    if (candidate && candidate <= now) {
      nextStartedAt = candidate;
      break;
    }
  }

  return {
    version: patch.version,
    from: patch.startedAt,
    to: nextStartedAt || now,
    isCurrent: nextStartedAt === null,
  };
}

/**
 * Returns the most recent already-released patch (the "current" patch).
 * PATCHES is ordered newest-first; we walk from the top and return the
 * first entry whose startedAt is in the past.
 *
 * Returns null if no patch in the list has started yet.
 */
export function currentPatch(now = Date.now()) {
  for (const p of PATCHES) {
    if (p.startedAt && p.startedAt <= now) {
      return { version: p.version, startedAt: p.startedAt };
    }
  }
  return null;
}

/**
 * True when `now` falls on the same UTC calendar date as the current
 * patch's startedAt. Used to gate the user-facing "Clear my ledger
 * because a new patch just dropped" button: visible/usable only on the
 * patch's release day, hidden on every other day.
 *
 * UTC-based so the window is identical for every player worldwide and
 * doesn't drift with the operator's local timezone.
 */
export function isPatchDropDay(now = Date.now()) {
  const cp = currentPatch(now);
  if (!cp) return false;
  const a = new Date(now);
  const b = new Date(cp.startedAt);
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
