/** In-memory metrics hub for local-dev monitoring only. */

const MAX_EVENTS = 800;
const PROBE_TIMEOUT_MS = 2500;

/** @type {Array<{id:number, at:number, source:string, label:string, ms:number, extra?:Record<string, unknown>}>} */
const events = [];
let nextId = 1;

const DEFAULT_TARGETS = {
  vite: process.env.MONITOR_VITE_URL ?? 'http://127.0.0.1:5173/ai-town/',
  convex: process.env.MONITOR_CONVEX_URL ?? 'http://127.0.0.1:3210/version',
  chat: process.env.MONITOR_CHAT_URL ?? 'http://127.0.0.1:8791/health',
  ollama: process.env.MONITOR_OLLAMA_URL ?? 'http://127.0.0.1:11434/',
  dashboard: process.env.MONITOR_DASHBOARD_URL ?? 'http://127.0.0.1:6791/',
};

/**
 * @param {object} event
 * @param {string} event.source
 * @param {string} event.label
 * @param {number} event.ms
 * @param {Record<string, unknown>} [event.extra]
 * @param {number} [event.at]
 */
export function pushEvent(event) {
  const row = {
    id: nextId++,
    at: event.at ?? Date.now(),
    source: String(event.source || 'unknown'),
    label: String(event.label || 'unnamed'),
    ms: Number(event.ms) || 0,
    extra: event.extra && typeof event.extra === 'object' ? event.extra : undefined,
  };
  events.push(row);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
  return row;
}

export function listEvents({ sinceId = 0, limit = 400 } = {}) {
  const filtered = sinceId > 0 ? events.filter((e) => e.id > sinceId) : events;
  return filtered.slice(-Math.max(1, Math.min(limit, MAX_EVENTS)));
}

export function summarizeEvents(windowMs = 5 * 60 * 1000) {
  const cutoff = Date.now() - windowMs;
  const recent = events.filter((e) => e.at >= cutoff);
  /** @type {Record<string, {count:number, sum:number, max:number, lastMs:number, lastAt:number}>} */
  const byLabel = {};
  for (const e of recent) {
    const key = `${e.source}:${e.label}`;
    const bucket = byLabel[key] ?? { count: 0, sum: 0, max: 0, lastMs: 0, lastAt: 0 };
    bucket.count += 1;
    bucket.sum += e.ms;
    bucket.max = Math.max(bucket.max, e.ms);
    if (e.at >= bucket.lastAt) {
      bucket.lastMs = e.ms;
      bucket.lastAt = e.at;
    }
    byLabel[key] = bucket;
  }
  return Object.entries(byLabel)
    .map(([key, b]) => ({
      key,
      count: b.count,
      avgMs: Math.round(b.sum / b.count),
      maxMs: b.max,
      lastMs: b.lastMs,
      lastAt: b.lastAt,
    }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * @param {string} name
 * @param {string} url
 */
async function probeOne(name, url) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
    });
    const ms = Date.now() - started;
    // 2xx–4xx means the process answered (dashboard may 401/404 without auth).
    const ok = res.status > 0 && res.status < 500;
    return {
      name,
      url,
      ok,
      status: res.status,
      ms,
      error: ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      name,
      url,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: err?.name === 'AbortError' ? 'timeout' : err?.message ?? 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeServices(targets = DEFAULT_TARGETS) {
  const started = Date.now();
  const names = Object.keys(targets);
  const results = await Promise.all(names.map((name) => probeOne(name, targets[name])));
  for (const r of results) {
    pushEvent({
      source: 'probe',
      label: `probe.${r.name}`,
      ms: r.ms,
      extra: { ok: r.ok, status: r.status, error: r.error },
    });
  }
  return {
    at: Date.now(),
    probeMs: Date.now() - started,
    services: results,
  };
}
