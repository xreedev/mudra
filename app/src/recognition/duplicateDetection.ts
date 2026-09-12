import type { GestureTemplate } from './types';

/** Trims and case-folds a label so "ARRIVED", "arrived" and " Arrived " all
 *  identify the same gesture — labels are never used as a unique id on
 *  their own, this is the single normalization every label comparison
 *  (duplicate checks, persistence upserts) goes through. */
export function normalizeLabel(label: string): string {
  return label.trim().toUpperCase();
}

export type SaveDecision = { kind: 'save' } | { kind: 'label-collision'; existing: GestureTemplate };

/**
 * Decides what should happen before a newly-captured gesture is persisted, checking the user's
 * own custom signs *before* the bundled set: a custom sign already recorded under this label
 * always wins the match over a bundled one with the same name (it's the one that's actually
 * currently active for that label — `useAllGestureTemplates` already shadows the bundled entry
 * with it). Either way, an existing label → `label-collision`, which needs the user to confirm
 * before it overwrites that template (this is also how a user shadows a bundled sign with their
 * own recording, on purpose). No label match anywhere → `save`, safe to persist directly as a new
 * gesture — two custom signs are free to share a similar hand shape under different labels.
 */
export function classifyGestureSave(
  userTemplates: readonly GestureTemplate[],
  bundledTemplates: readonly GestureTemplate[],
  label: string,
): SaveDecision {
  const normalized = normalizeLabel(label);
  const userMatch = userTemplates.find((template) => normalizeLabel(template.label) === normalized);
  if (userMatch) return { kind: 'label-collision', existing: userMatch };
  const bundledMatch = bundledTemplates.find((template) => normalizeLabel(template.label) === normalized);
  if (bundledMatch) return { kind: 'label-collision', existing: bundledMatch };
  return { kind: 'save' };
}
