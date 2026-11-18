/** Log timings. Hot paths (worldState every ~1s) should use logTimingSlowOnly. */
export const BACKEND_SLOW_MS = 200;
export const BACKEND_VERY_SLOW_MS = 2000;

export function logTiming(
  label: string,
  startedAt: number,
  extra?: Record<string, unknown>,
  opts?: { always?: boolean },
): number {
  const ms = Date.now() - startedAt;
  const always = opts?.always ?? true;
  if (!always && ms < BACKEND_SLOW_MS) {
    return ms;
  }
  const payload = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  if (ms >= BACKEND_VERY_SLOW_MS) {
    console.warn(`[backend-very-slow] ${label}: ${ms}ms${payload}`);
  } else if (ms >= BACKEND_SLOW_MS) {
    console.warn(`[backend-slow] ${label}: ${ms}ms${payload}`);
  } else {
    console.log(`[timing] ${label}: ${ms}ms${payload}`);
  }
  return ms;
}

/** Only emit when >= BACKEND_SLOW_MS — for high-frequency queries/mutations. */
export function logTimingSlowOnly(
  label: string,
  startedAt: number,
  extra?: Record<string, unknown>,
): number {
  return logTiming(label, startedAt, extra, { always: false });
}
