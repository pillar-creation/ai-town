type MetricExtra = Record<string, string | number | boolean | null | undefined>;

export type MetricEvent = {
  id?: number;
  source: string;
  label: string;
  ms: number;
  at: number;
  extra?: MetricExtra;
};

const QUEUE: MetricEvent[] = [];
const MAX_QUEUE = 100;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastFlushFailedAt = 0;

const FLUSH_MS = 800;
const RETRY_COOLDOWN_MS = 5000;

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushMetrics();
  }, FLUSH_MS);
}

/** Fire-and-forget local metrics ingest via Vite → chat-server proxy. */
export function reportMetric(
  label: string,
  ms: number,
  extra?: MetricExtra,
  source = 'frontend',
) {
  const event: MetricEvent = {
    source,
    label,
    ms: Math.round(ms),
    at: Date.now(),
    extra,
  };
  QUEUE.push(event);
  if (QUEUE.length > MAX_QUEUE) {
    QUEUE.splice(0, QUEUE.length - MAX_QUEUE);
  }
  scheduleFlush();
}

export async function flushMetrics() {
  if (QUEUE.length === 0) return;
  if (Date.now() - lastFlushFailedAt < RETRY_COOLDOWN_MS) return;

  const batch = QUEUE.splice(0, QUEUE.length);
  try {
    const res = await fetch('/chat-api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) {
      throw new Error(`metrics HTTP ${res.status}`);
    }
  } catch {
    lastFlushFailedAt = Date.now();
    // Put events back (best-effort) so a brief chat-server blip does not drop them all.
    QUEUE.unshift(...batch);
    if (QUEUE.length > MAX_QUEUE) {
      QUEUE.splice(0, QUEUE.length - MAX_QUEUE);
    }
  }
}

export type ServiceStatus = {
  name: string;
  url: string;
  ok: boolean;
  status: number;
  ms: number;
  error?: string;
};

export type StatusSnapshot = {
  ok: boolean;
  at: number;
  probeMs: number;
  services: ServiceStatus[];
  chat?: { model: string; ollama: string };
  summary?: Array<{
    key: string;
    count: number;
    avgMs: number;
    maxMs: number;
    lastMs: number;
    lastAt: number;
  }>;
  error?: string;
};

export type HubMetrics = {
  ok: boolean;
  events: MetricEvent[];
  summary: StatusSnapshot['summary'];
};

export async function fetchStatus(): Promise<StatusSnapshot> {
  const res = await fetch('/chat-api/status');
  if (!res.ok) {
    throw new Error(`status HTTP ${res.status}`);
  }
  return (await res.json()) as StatusSnapshot;
}

export async function fetchHubMetrics(sinceId = 0): Promise<HubMetrics> {
  const res = await fetch(`/chat-api/metrics?sinceId=${sinceId}&limit=400`);
  if (!res.ok) {
    throw new Error(`metrics HTTP ${res.status}`);
  }
  return (await res.json()) as HubMetrics;
}
