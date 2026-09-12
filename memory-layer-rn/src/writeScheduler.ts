/**
 * Where persistence work runs.
 *
 * The lookup path never touches storage. Writes are handed here and applied after the current
 * frame, so confirming a phrase costs a `Map` insert and the user sees the auto-fill work on the
 * very next sign — not after SQLite has committed.
 *
 * There are no threads in JS, so "write-behind" here means a serialized promise chain: writes
 * keep their order, never overlap, and never block the caller.
 */
export interface WriteScheduler {
  submit(task: () => Promise<void> | void): void;
  /** Resolves once every queued write has finished. */
  flush(): Promise<void>;
  /** Pending writes, for diagnostics. */
  readonly pending: number;
}

export interface QueuedSchedulerOptions {
  /** Called when a submitted write rejects. */
  onError?: (error: unknown) => void;
}

/** Serialized promise chain: order preserved, caller never blocked. */
export function createQueuedWriteScheduler(
  options: QueuedSchedulerOptions = {},
): WriteScheduler {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    submit(task) {
      pending++;
      tail = tail.then(async () => {
        try {
          await task();
        } catch (error) {
          options.onError?.(error);
        } finally {
          pending--;
        }
      });
    },
    flush() {
      return tail;
    },
    get pending() {
      return pending;
    },
  };
}

/**
 * Runs each write immediately and remembers the promise, so `flush()` still awaits it. Useful
 * in tests where a write must be observable without an extra tick.
 */
export function createImmediateWriteScheduler(
  options: QueuedSchedulerOptions = {},
): WriteScheduler {
  const inFlight = new Set<Promise<void>>();

  return {
    submit(task) {
      const promise = (async () => {
        try {
          await task();
        } catch (error) {
          options.onError?.(error);
        }
      })();
      inFlight.add(promise);
      void promise.then(() => inFlight.delete(promise));
    },
    async flush() {
      while (inFlight.size > 0) {
        await Promise.all([...inFlight]);
      }
    },
    get pending() {
      return inFlight.size;
    },
  };
}
