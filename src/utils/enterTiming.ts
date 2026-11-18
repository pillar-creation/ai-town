type MarkPayload = Record<string, string | number | boolean | null | undefined>;

const PREFIX = '[enter-timing]';

let sessionId = 0;
let startedAt = 0;
let lastAt = 0;
let active = false;

export function beginEnterTiming(reason: string) {
  sessionId += 1;
  startedAt = performance.now();
  lastAt = startedAt;
  active = true;
  console.log(
    `${PREFIX} #${sessionId} START (${reason}) — open DevTools console to follow phase timings`,
  );
  return sessionId;
}

export function markEnterTiming(label: string, payload?: MarkPayload) {
  if (!active) return;
  const now = performance.now();
  const sinceStart = now - startedAt;
  const sinceLast = now - lastAt;
  lastAt = now;
  const extra = payload ? ` ${JSON.stringify(payload)}` : '';
  console.log(
    `${PREFIX} #${sessionId} +${sinceStart.toFixed(0)}ms (Δ${sinceLast.toFixed(0)}ms) ${label}${extra}`,
  );
}

export function endEnterTiming(label: string, payload?: MarkPayload) {
  if (!active) return;
  markEnterTiming(label, payload);
  const total = performance.now() - startedAt;
  console.log(`${PREFIX} #${sessionId} DONE total=${total.toFixed(0)}ms`);
  active = false;
}

export function isEnterTimingActive() {
  return active;
}
