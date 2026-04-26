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
  // 4.8 has not been released yet; admin should set startedAt to the
  // exact ms when it goes live and add the next patch above this entry.
  { version: "4.8", startedAt: null },
  // 4.7.2 is the current live patch. Approximate start date — adjust
  // if a more precise timestamp matters for an export.
  { version: "4.7.2", startedAt: Date.UTC(2026, 2, 15) /* 2026-03-15 */ },
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

  // PATCHES is ordered newest-first, so the *previous* index is the
  // patch that comes after this one chronologically.
  let nextStartedAt = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (PATCHES[i].startedAt) {
      nextStartedAt = PATCHES[i].startedAt;
      break;
    }
  }

  return {
    version: patch.version,
    from: patch.startedAt,
    to: nextStartedAt || Date.now(),
    isCurrent: nextStartedAt === null,
  };
}
