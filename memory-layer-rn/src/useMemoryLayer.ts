import { useEffect, useMemo, useRef, useState } from 'react';
import { MemoryLayer, type MemoryLayerOptions } from './memoryLayer';
import type { WarmUpResult } from './types';

export interface UseMemoryLayerResult {
  /** The layer. Usable immediately; empty until `ready` flips. */
  memory: MemoryLayer;
  /** `true` once the persisted corpus has been loaded. */
  ready: boolean;
  /** Warm-up outcome, for a debug screen. */
  warmUp: WarmUpResult | null;
}

/**
 * Creates a memory layer for the lifetime of a component tree and warms it up once.
 *
 * ```tsx
 * const { memory, ready } = useMemoryLayer({ store });
 *
 * const onGlossRecognized = (tokens: string[]) => {
 *   const hit = memory.lookup(tokens);        // synchronous — safe inside a render callback
 *   if (hit.kind !== 'miss') setDraft(hit.match.translation);
 * };
 * ```
 *
 * Pass `options` as a stable object (module constant, or `useMemo`): it is read once, when the
 * layer is created, so changing it later has no effect.
 */
export function useMemoryLayer(options: MemoryLayerOptions = {}): UseMemoryLayerResult {
  const optionsRef = useRef(options);
  const memory = useMemo(() => new MemoryLayer(optionsRef.current), []);
  const [warmUp, setWarmUp] = useState<WarmUpResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    memory
      .warmUp()
      .then((result) => {
        if (!cancelled) setWarmUp(result);
      })
      .catch(() => {
        // warmUp never rejects, but a broken store implementation might; treat it as "empty".
        if (!cancelled) setWarmUp({ loaded: 0, skipped: 0, degraded: true });
      });

    return () => {
      cancelled = true;
      void memory.close();
    };
  }, [memory]);

  return { memory, ready: warmUp !== null, warmUp };
}
