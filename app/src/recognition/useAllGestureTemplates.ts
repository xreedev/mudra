import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUNDLED_GESTURE_TEMPLATES } from './bundledTemplates';
import { normalizeLabel } from './duplicateDetection';
import {
  loadUserGestures,
  saveUserGestures,
  subscribeUserGesturesChanged,
  upsertUserGesture,
} from './userGestureStore';
import type { GestureTemplate } from './types';

export interface AllGestureTemplates {
  /** Bundled templates merged with user-added ones — a user template with
   *  the same label as a bundled one takes precedence, since the bundled
   *  JSON itself can't be rewritten at runtime. Pass this to
   *  `recognizeLandmarks` anywhere gestures need matching. */
  templates: GestureTemplate[];
  /** Just the user-recorded templates, e.g. for a "your signs" list. */
  userTemplates: GestureTemplate[];
  /** True until the on-device user-gestures file has been read once. */
  loading: boolean;
  /** Adds a new gesture or overwrites an existing one with the same label,
   *  persists the change, and updates `templates`/`userTemplates`. Rejects
   *  if the write fails — callers should show a save-failed message. Safe
   *  to call again before a prior call resolves (e.g. a double tap): calls
   *  are serialized, never interleaved into a corrupted save. */
  addOrUpdate: (template: GestureTemplate) => Promise<void>;
  /** Deletes every user-recorded gesture, leaving only the bundled set.
   *  Rejects if the write fails. Joins the same save queue as
   *  `addOrUpdate`, so it can never race a concurrent save. */
  clearAll: () => Promise<void>;
}

/**
 * The single source of truth for "every gesture this app can currently
 * recognize" — bundled templates plus whatever the user has recorded via
 * Add custom sign, kept in sync with the on-device JSON file.
 */
export function useAllGestureTemplates(): AllGestureTemplates {
  const [userTemplates, setUserTemplates] = useState<GestureTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  // Mirrors `userTemplates` so `addOrUpdate` always builds on the latest
  // set (including one loaded by a disk-reload from another instance's
  // save) without needing it in a `useCallback` dependency array.
  const userTemplatesRef = useRef<GestureTemplate[]>(userTemplates);
  useEffect(() => {
    userTemplatesRef.current = userTemplates;
  }, [userTemplates]);
  // Serializes `addOrUpdate` calls so a double tap (or any concurrent
  // callers) can never interleave two saves into a corrupted write —
  // each call waits for the previous one to settle before it runs.
  const pendingSave = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadUserGestures();
      if (!cancelled) {
        setUserTemplates(loaded);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // A save from any instance (this one, or e.g. a CallScreen left mounted
    // in the background by the navigator) notifies every instance to
    // re-read the file, so a newly-recorded sign is recognizable without
    // restarting the app or even leaving the screen it was added from.
    return subscribeUserGesturesChanged(() => {
      loadUserGestures().then((loaded) => {
        userTemplatesRef.current = loaded;
        setUserTemplates(loaded);
      });
    });
  }, []);

  const addOrUpdate = useCallback((template: GestureTemplate) => {
    const run = pendingSave.current.then(async () => {
      const next = upsertUserGesture(userTemplatesRef.current, template);
      await saveUserGestures(next);
      userTemplatesRef.current = next;
      setUserTemplates(next);
    });
    // Chain the queue on a version that never rejects, so one failed save
    // doesn't permanently wedge every save after it — the failure itself
    // still reaches this call's own caller via the returned `run` promise.
    pendingSave.current = run.catch(() => undefined);
    return run;
  }, []);

  const clearAll = useCallback(() => {
    const run = pendingSave.current.then(async () => {
      await saveUserGestures([]);
      userTemplatesRef.current = [];
      setUserTemplates([]);
    });
    pendingSave.current = run.catch(() => undefined);
    return run;
  }, []);

  const templates = useMemo(() => {
    const userLabels = new Set(userTemplates.map((template) => normalizeLabel(template.label)));
    const bundledMinusOverridden = BUNDLED_GESTURE_TEMPLATES.filter(
      (template) => !userLabels.has(normalizeLabel(template.label)),
    );
    return [...bundledMinusOverridden, ...userTemplates];
  }, [userTemplates]);

  return { templates, userTemplates, loading, addOrUpdate, clearAll };
}
