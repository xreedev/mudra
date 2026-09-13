import RNFS from 'react-native-fs';
import { normalizeLabel } from './duplicateDetection';
import { parseGestureTemplates } from './gestureRecognizer';
import type { GestureTemplate, GestureTemplateFile } from './types';

/**
 * Where user-added gestures live on-device. Deliberately separate from the
 * bundled `src/assets/delivery.json` — that file is compiled into the app
 * bundle by Metro and is read-only at runtime, so anything the app records
 * itself has to go to app-private, runtime-writable storage.
 */
export const USER_GESTURES_PATH = `${RNFS.DocumentDirectoryPath}/user_added_custom_gestures.json`;
const TEMP_PATH = `${USER_GESTURES_PATH}.tmp`;

/** Reads the user-added gestures file. Returns `[]` if it doesn't exist yet or is corrupt —
 *  a bad file must never crash the app or block recognition, it just means "no custom signs". */
export async function loadUserGestures(): Promise<GestureTemplate[]> {
  try {
    const exists = await RNFS.exists(USER_GESTURES_PATH);
    if (!exists) return [];
    const raw = await RNFS.readFile(USER_GESTURES_PATH, 'utf8');
    return parseGestureTemplates(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Overwrites the user-added gestures file with the given full set of
 * templates. Writes to a temp file first and swaps it into place rather
 * than writing `USER_GESTURES_PATH` directly, so a crash or a killed app
 * mid-write can never leave a half-written, corrupt file behind — worst
 * case the temp file is orphaned and the previous save is still intact.
 * Rejects on failure; callers surface that as a save-failed message.
 */
export async function saveUserGestures(templates: readonly GestureTemplate[]): Promise<void> {
  const file: GestureTemplateFile = {
    schema: 'custom-gesture-snapshot-v1',
    created_at: new Date().toISOString(),
    description: 'Gestures recorded on-device via Add custom sign.',
    gestures: [...templates],
  };
  await RNFS.writeFile(TEMP_PATH, JSON.stringify(file, null, 2), 'utf8');
  if (await RNFS.exists(USER_GESTURES_PATH)) {
    await RNFS.unlink(USER_GESTURES_PATH);
  }
  await RNFS.moveFile(TEMP_PATH, USER_GESTURES_PATH);
  notifyUserGesturesChanged();
}

/**
 * Replaces any existing template with the same label (normalized —
 * trimmed, case-insensitive, per `normalizeLabel`) with `newTemplate`, or
 * appends it if the label is new. Pure — callers persist the result
 * themselves via `saveUserGestures`.
 */
export function upsertUserGesture(
  templates: readonly GestureTemplate[],
  newTemplate: GestureTemplate,
): GestureTemplate[] {
  const label = normalizeLabel(newTemplate.label);
  const index = templates.findIndex((template) => normalizeLabel(template.label) === label);
  if (index === -1) return [...templates, newTemplate];
  const next = [...templates];
  next[index] = newTemplate;
  return next;
}

// A save from any screen (e.g. Add custom sign) has to be picked up by
// every other mounted `useAllGestureTemplates` instance (e.g. a CallScreen
// left running in the background by the navigator) without an app
// restart — there's no shared store beyond this file, so a tiny pub-sub is
// the whole cross-instance sync mechanism.
const listeners = new Set<() => void>();

function notifyUserGesturesChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeUserGesturesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
