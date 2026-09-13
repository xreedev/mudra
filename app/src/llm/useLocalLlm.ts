import { useEffect, useState } from 'react';
import RNFS from 'react-native-fs';
import { glossOptionsSystemWithFewShot, glossToText, glossToTextOptions } from './features';
import { load, localProvider, warmup } from './LocalLlmProvider';

// Kept out of index.ts's barrel — imports react-native-fs and
// LocalLlmProvider (which imports llama.rn), both native modules, same
// reason useLiveHandGestures.ts is excluded from recognition/index.ts.

/** Where the GGUF lives on-device. The app creates this directory itself —
 *  NEVER via `adb shell mkdir` (see llm-testbed/INTEGRATION.md): a
 *  directory created by adb/shell inside the app's external files dir is
 *  not recognized as belonging to the app by Android's storage layer, even
 *  though `ls -la` shows plausible permissions — the app's own process
 *  can't stat() or readDir() it. Push the .gguf into this path with adb
 *  push only AFTER the app itself has created the folder (calling
 *  preloadLocalLlm() once does that). */
export const MODELS_DIR = `${RNFS.ExternalDirectoryPath}/models`;
// Swapped from the 7B Q4_K_M model down to 3B: noticeably faster load/first-token
// latency on-device, at an acceptable quality cost for gloss->sentence composition.
export const MODEL_FILENAME = 'qwen2.5-3b-instruct-q4_k_m.gguf';
const MODEL_PATH = `${MODELS_DIR}/${MODEL_FILENAME}`;
// Path relative to android/app/src/main/assets — where the release build
// bundles the GGUF (see android/app/build.gradle's noCompress).
const ASSET_MODEL_PATH = `models/${MODEL_FILENAME}`;

export type LocalLlmStatus = 'checking' | 'missing' | 'loading' | 'ready' | 'error';

export interface LocalLlmResult {
  status: LocalLlmStatus;
  detail?: string;
}

/**
 * The actual load-and-warmup sequence, run at most ONCE per app session no
 * matter how many callers ask for it — a single memoized promise, not just
 * a boolean flag. That distinction matters: a boolean set only at the very
 * end leaves a real window (the full ~8-13s load+warmup) where a second
 * caller mounting in that window would see "not started yet" and kick off
 * its own duplicate load. Sharing one promise means every caller — whether
 * it's the early app-level preload or a later CallScreen mount — awaits the
 * exact same in-flight (or already-finished) load.
 *
 * Call this as early as possible (App.tsx, on the very first render) so the
 * ~8-13s cold load+warmup happens while the user is on the home screen
 * picking a contact, not after they've already tapped into a call.
 * CallScreen's useLocalLlm() hook calls it too — if the app-level preload
 * already finished (or is in flight) by the time the user gets there, this
 * resolves instantly instead of starting a fresh load.
 */
let loadPromise: Promise<LocalLlmResult> | null = null;

export function preloadLocalLlm(): Promise<LocalLlmResult> {
  if (loadPromise) return loadPromise;

  loadPromise = (async (): Promise<LocalLlmResult> => {
    try {
      await RNFS.mkdir(MODELS_DIR);
    } catch {
      // mkdir on an already-existing directory is a harmless no-op on most
      // RNFS backends; only a genuinely broken storage state would surface
      // here, and the exists() check below will catch that anyway.
    }

    let exists = await RNFS.exists(MODEL_PATH);
    if (!exists) {
      // Release builds bundle the GGUF as a raw, uncompressed Android asset
      // (see android/app/build.gradle's noCompress) so a fresh install works
      // with no manual `adb push` step — extract it to the real,
      // mmap-able path llama.cpp needs, once, on first launch. Debug builds
      // don't bundle the asset at all, so existsAssets() legitimately
      // returns false there and this falls through to "missing" below.
      try {
        if (await RNFS.existsAssets(ASSET_MODEL_PATH)) {
          await RNFS.copyFileAssets(ASSET_MODEL_PATH, MODEL_PATH);
          exists = await RNFS.exists(MODEL_PATH);
        }
      } catch {
        // Extraction failing just means the "missing" status below is
        // accurate — nothing further to recover here.
      }
    }

    if (!exists) {
      return {
        status: 'missing',
        detail: `Push the model with:\nadb push ${MODEL_FILENAME} ${MODELS_DIR}/`,
      };
    }

    const result = await load({
      modelPath: MODEL_PATH,
      nCtx: 1024,
      nGpuLayers: 0, // see llm-testbed/INTEGRATION.md "Why no GPU"
      nThreads: 6,
      nThreadsBatch: 8,
      nBatch: 512,
      flashAttn: 'auto',
    });

    if (!result.ok) {
      return { status: 'error', detail: result.error };
    }

    try {
      // CallScreen only ever calls composeSentenceOptions(), which uses
      // this (longer, more-few-shot) prompt shape — not glossToText()'s
      // single-sentence prompt. Warming up the wrong one just adds seconds
      // to loading for a code path nothing currently calls; warm up
      // whichever prompt the UI actually uses. If a screen starts calling
      // composeSentence() too, add `await warmup(glossSystemWithFewShot())`
      // back here — each distinct system-prompt shape needs its own warmup.
      await warmup(glossOptionsSystemWithFewShot());
    } catch {
      // Warmup failing isn't fatal — the model is loaded and usable, the
      // first real composeSentenceOptions() call just pays the cold-start
      // cost instead. Not worth failing the whole preload over.
    }

    return { status: 'ready' };
  })();

  return loadPromise;
}

export interface LocalLlm {
  status: LocalLlmStatus;
  /** Set when status is 'error' or 'missing', for a UI to surface. */
  detail?: string;
  /** ["WHERE","HOSPITAL"] -> "Where is the hospital?" — undefined until
   *  status is 'ready'; throws if called before then. */
  composeSentence: (gloss: string[]) => Promise<string>;
  /** Same glosses -> 2 or 3 DIFFERENT candidate sentences, for when the
   *  glosses are genuinely ambiguous about who is signing (customer vs.
   *  driver) — see GLOSS_TO_TEXT_OPTIONS_SYSTEM in prompts.ts. The UI shows
   *  all of them and the user picks the one matching their actual
   *  situation, rather than the LLM silently guessing which role applies.
   *  `context` is the current call's recent turn history (see
   *  `buildRecentContext`) — optional, but passing it lets the LLM use what
   *  was already said to judge who's more likely signing now. */
  composeSentenceOptions: (gloss: string[], context?: string) => Promise<string[]>;
}

/** Reactive status for a component (CallScreen) to render — piggybacks on
 *  preloadLocalLlm()'s shared promise rather than starting its own load. */
export function useLocalLlm(): LocalLlm {
  const [status, setStatus] = useState<LocalLlmStatus>(loadPromise ? 'loading' : 'checking');
  const [detail, setDetail] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    preloadLocalLlm().then((result) => {
      if (cancelled) return;
      setStatus(result.status);
      setDetail(result.detail);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    status,
    detail,
    composeSentence: (gloss: string[]) => glossToText(localProvider, gloss),
    composeSentenceOptions: (gloss: string[], context?: string) =>
      glossToTextOptions(localProvider, gloss, context),
  };
}
