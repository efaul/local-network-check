import { useEffect, useRef } from 'react';

/**
 * Polls an async function on a fixed interval, starting immediately.
 *
 * Uses a recursive `setTimeout` rather than `setInterval` so a slow request
 * can never overlap the next tick - the next poll is scheduled only after
 * the current one finishes. Safe to call `fn` even after unmount; results
 * are just discarded rather than causing a state update on an unmounted
 * component.
 *
 * Pass `intervalMs: null` to disable polling entirely (still unsubscribes
 * any previous timer) - used by views that only poll conditionally, such as
 * a room's detail page only polling while viewing the live day.
 */
export function usePoll(fn: () => Promise<void>, intervalMs: number | null, deps: readonly unknown[] = []): void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (intervalMs === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      try {
        await fnRef.current();
      } finally {
        if (!cancelled) timer = setTimeout(() => void tick(), intervalMs);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- deps is caller-controlled; spread intentionally
  }, [intervalMs, ...deps]);
}
