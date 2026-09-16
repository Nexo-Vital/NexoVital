import { useEffect, useState } from 'react';

/**
 * Simulates an async fetch so panel skeletons are visible. Starts in the
 * loading state when a delay is given, then resolves once.
 */
export function useMockLoad(delayMs = 0): boolean {
  const [loading, setLoading] = useState(delayMs > 0);

  useEffect(() => {
    if (delayMs <= 0) {
      return;
    }
    const id = window.setTimeout(() => setLoading(false), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);

  return loading;
}
