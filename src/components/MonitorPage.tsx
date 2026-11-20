import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import uPlot, { AlignedData, Options } from 'uplot';
import { api } from '../../convex/_generated/api';
import {
  fetchHubMetrics,
  fetchStatus,
  MetricEvent,
  StatusSnapshot,
} from '../utils/metrics.ts';

const POLL_MS = 2000;
const CHART_WINDOW_SEC = 10 * 60;
const STAT_WINDOW_MS = 5 * 60 * 1000;
const SERIES_COLORS = [
  '#5ec8ff',
  '#fec742',
  '#7dcea0',
  '#e07a5f',
  '#c39bd3',
  '#76d7c4',
  '#f1948a',
  '#85c1e9',
  '#f7dc6f',
  '#a9dfbf',
  '#d7bde2',
];

type ChartPoint = {
  at: number;
  ms: number;
  label: string;
  source: string;
  extra?: string | Record<string, unknown>;
};

type Agg = { lastMs: number; avgMs: number; maxMs: number; n: number; at: number };

/** Healthy baselines (post-tuning / warm Ollama). Used for 正常值对比. */
const NORMAL = {
  enterTotal: { label: '0.5–1.5s', maxMs: 1500 },
  persist: { label: '异步', maxMs: 50 },
  viteProbe: { label: '<10ms', maxMs: 10 },
  startChat: { label: '≈0ms', maxMs: 50 },
  ollamaProbe: { label: '<10ms', maxMs: 10 },
  chatProxy: { label: '<20ms', maxMs: 20 },
  promptContext: { label: '<100ms', maxMs: 100 },
  runStep: { label: '1–2s/步', maxMs: 2000 },
  doSomething: { label: '1–4s', maxMs: 4000 },
  generateMessage: { label: '1–2s', maxMs: 2500 },
  generateMs: { label: '0.3–1.3s', maxMs: 1500 },
  sendMs: { label: '<300ms', maxMs: 300 },
  remember: { label: '1–2s', maxMs: 2000 },
  chatServer: { label: '<10ms', maxMs: 10 },
  convexProbe: { label: '<20ms', maxMs: 20 },
  ollamaChat: { label: '0.2–0.5s', maxMs: 500 },
  ollamaEmbed: { label: '10–40ms', maxMs: 40 },
} as const;

function normalizePath(): string {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
  let path = window.location.pathname;
  if (base && path.startsWith(base)) {
    path = path.slice(base.length) || '/';
  }
  return path;
}

function isMonitorRoute() {
  const path = normalizePath();
  return path === '/monitor' || path.startsWith('/monitor/');
}

export function shouldShowMonitor() {
  return isMonitorRoute();
}

function mergeEvents(
  hub: MetricEvent[],
  convexRows:
    | Array<{
        id: string;
        source: string;
        label: string;
        ms: number;
        at: number;
        extra?: string;
      }>
    | undefined,
): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const e of hub) {
    points.push({
      at: e.at,
      ms: e.ms,
      label: e.label,
      source: e.source,
      extra: e.extra,
    });
  }
  if (convexRows) {
    for (const row of convexRows) {
      points.push({
        at: row.at,
        ms: row.ms,
        label: row.label,
        source: row.source,
        extra: row.extra,
      });
    }
  }
  points.sort((a, b) => a.at - b.at);
  return points;
}

function parseExtra(extra: ChartPoint['extra']): Record<string, unknown> | null {
  if (!extra) return null;
  if (typeof extra === 'object') return extra as Record<string, unknown>;
  try {
    return JSON.parse(extra) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Fixed chart series aligned with RuntimeMap modules (not top-by-frequency). */
type ModuleSeries = {
  key: string;
  title: string;
  samples: (points: ChartPoint[], cutoff: number) => Array<{ at: number; ms: number }>;
};

function samplesByLabel(
  labels: string | string[],
  points: ChartPoint[],
  cutoff: number,
): Array<{ at: number; ms: number }> {
  const set = new Set(Array.isArray(labels) ? labels : [labels]);
  const out: Array<{ at: number; ms: number }> = [];
  for (const p of points) {
    if (p.at < cutoff) continue;
    if (!set.has(p.label)) continue;
    out.push({ at: p.at, ms: p.ms });
  }
  return out;
}

function samplesByExtraField(
  label: string,
  field: string,
  points: ChartPoint[],
  cutoff: number,
): Array<{ at: number; ms: number }> {
  const out: Array<{ at: number; ms: number }> = [];
  for (const p of points) {
    if (p.at < cutoff) continue;
    if (p.label !== label) continue;
    const ex = parseExtra(p.extra);
    const v = ex?.[field];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push({ at: p.at, ms: v });
    }
  }
  return out;
}

const MODULE_SERIES: ModuleSeries[] = [
  {
    key: 'enter.total',
    title: 'Browser',
    samples: (pts, cut) => samplesByLabel('enter.total', pts, cut),
  },
  {
    key: 'humanChat.startChat',
    title: 'startChat',
    samples: (pts, cut) => samplesByLabel('humanChat.startChat', pts, cut),
  },
  {
    key: 'ui.promptContext.once',
    title: 'promptContext',
    samples: (pts, cut) => samplesByLabel('ui.promptContext.once', pts, cut),
  },
  {
    key: 'runStep',
    title: 'runStep',
    samples: (pts, cut) => samplesByLabel(['aiTown.main.runStep', 'runStep'], pts, cut),
  },
  {
    key: 'agentDoSomething',
    title: 'doSomething',
    samples: (pts, cut) => samplesByLabel('agentDoSomething', pts, cut),
  },
  {
    key: 'agentGenerateMessage',
    title: 'generateMessage',
    samples: (pts, cut) => samplesByLabel('agentGenerateMessage', pts, cut),
  },
  {
    key: 'generateMs',
    title: 'generateMs',
    samples: (pts, cut) => samplesByExtraField('agentGenerateMessage', 'generateMs', pts, cut),
  },
  {
    key: 'sendMs',
    title: 'sendMs',
    samples: (pts, cut) => samplesByExtraField('agentGenerateMessage', 'sendMs', pts, cut),
  },
  {
    key: 'agentRemember',
    title: 'remember',
    samples: (pts, cut) =>
      samplesByLabel(['agentRememberConversation', 'agentRemember'], pts, cut),
  },
  {
    key: 'chat-server.chat',
    title: 'chat-server',
    samples: (pts, cut) =>
      samplesByLabel(['chat-server.chat', 'ui.sendMessage.chatServer'], pts, cut),
  },
  {
    key: 'chat-server.llm',
    title: 'Ollama chat',
    samples: (pts, cut) => samplesByLabel('chat-server.llm', pts, cut),
  },
];

function aggregate(
  points: ChartPoint[],
  match: (p: ChartPoint) => boolean,
  windowMs = STAT_WINDOW_MS,
): Agg | null {
  const cutoff = Date.now() - windowMs;
  const rows = points.filter((p) => p.at >= cutoff && match(p));
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  const sum = rows.reduce((a, p) => a + p.ms, 0);
  return {
    lastMs: last.ms,
    avgMs: Math.round(sum / rows.length),
    maxMs: Math.max(...rows.map((p) => p.ms)),
    n: rows.length,
    at: last.at,
  };
}

function aggregateExtraField(
  points: ChartPoint[],
  label: string,
  field: string,
  windowMs = STAT_WINDOW_MS,
): Agg | null {
  const cutoff = Date.now() - windowMs;
  const vals: Array<{ ms: number; at: number }> = [];
  for (const p of points) {
    if (p.at < cutoff) continue;
    if (p.label !== label) continue;
    const ex = parseExtra(p.extra);
    const v = ex?.[field];
    if (typeof v === 'number' && Number.isFinite(v)) {
      vals.push({ ms: v, at: p.at });
    }
  }
  if (vals.length === 0) return null;
  const last = vals[vals.length - 1];
  const sum = vals.reduce((a, p) => a + p.ms, 0);
  return {
    lastMs: last.ms,
    avgMs: Math.round(sum / vals.length),
    maxMs: Math.max(...vals.map((p) => p.ms)),
    n: vals.length,
    at: last.at,
  };
}

function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}

function healthTone(actual: number | null, normalMaxMs: number): 'ok' | 'warn' | 'bad' | 'na' {
  if (actual == null) return 'na';
  if (actual <= normalMaxMs * 1.5) return 'ok';
  if (actual <= normalMaxMs * 3) return 'warn';
  return 'bad';
}

function toneClass(tone: 'ok' | 'warn' | 'bad' | 'na') {
  switch (tone) {
    case 'ok':
      return 'border-emerald-400/40 bg-emerald-950/30';
    case 'warn':
      return 'border-amber-400/40 bg-amber-950/30';
    case 'bad':
      return 'border-rose-400/40 bg-rose-950/35';
    default:
      return 'border-white/10 bg-black/35';
  }
}

function toneText(tone: 'ok' | 'warn' | 'bad' | 'na') {
  switch (tone) {
    case 'ok':
      return 'text-emerald-300';
    case 'warn':
      return 'text-amber-300';
    case 'bad':
      return 'text-rose-300';
    default:
      return 'text-white/45';
  }
}

function RuntimeNode({
  title,
  subtitle,
  actual,
  normalLabel,
  normalMaxMs,
  compact,
}: {
  title: string;
  subtitle?: string;
  actual: number | null;
  normalLabel: string;
  normalMaxMs: number;
  compact?: boolean;
}) {
  const tone = healthTone(actual, normalMaxMs);
  return (
    <div
      className={`rounded-md border px-2.5 py-2 ${toneClass(tone)} ${
        compact ? 'min-w-[7.5rem]' : 'min-w-[9.5rem]'
      }`}
    >
      <div className="font-display text-sm tracking-wide text-[#fec742]">{title}</div>
      {subtitle && <div className="mt-0.5 font-body text-[10px] text-white/45">{subtitle}</div>}
      <div className={`mt-1 font-body text-sm font-semibold ${toneText(tone)}`}>
        实际 {formatMs(actual)}
      </div>
      <div className="font-body text-[11px] text-white/50">正常 {normalLabel}</div>
    </div>
  );
}

function RuntimeMap({
  points,
  status,
}: {
  points: ChartPoint[];
  status: StatusSnapshot | null;
}) {
  const probe = (name: string) => status?.services?.find((s) => s.name === name)?.ms ?? null;

  const enter = aggregate(points, (p) => p.label === 'enter.total');
  const prompt = aggregate(points, (p) => p.label === 'ui.promptContext.once');
  const startChat = aggregate(points, (p) => p.label === 'humanChat.startChat');
  const runStep = aggregate(
    points,
    (p) => p.label === 'aiTown.main.runStep' || p.label === 'runStep',
  );
  const doSomething = aggregate(points, (p) => p.label === 'agentDoSomething');
  const genMsg = aggregate(points, (p) => p.label === 'agentGenerateMessage');
  const remember = aggregate(
    points,
    (p) => p.label === 'agentRememberConversation' || p.label === 'agentRemember',
  );
  const generateMs = aggregateExtraField(points, 'agentGenerateMessage', 'generateMs');
  const sendMs = aggregateExtraField(points, 'agentGenerateMessage', 'sendMs');
  const chatServerChat = aggregate(
    points,
    (p) => p.label === 'chat-server.chat' || p.label === 'ui.sendMessage.chatServer',
  );
  const chatLlm = aggregate(points, (p) => p.label === 'chat-server.llm');

  const pick = (agg: Agg | null) => (agg ? agg.lastMs : null);

  return (
    <div className="space-y-4 rounded-md border border-white/10 bg-black/25 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl text-white/90">Runtime</h2>
          <p className="mt-1 font-body text-xs text-white/50">
            结构对齐架构耗时图 · 实际=近 5 分钟最近一次 · 绿/黄/红相对「正常」基线
          </p>
        </div>
        <div className="font-body text-[11px] text-white/40">
          <span className="mr-2 text-emerald-300">正常</span>
          <span className="mr-2 text-amber-300">偏慢</span>
          <span className="text-rose-300">异常</span>
        </div>
      </div>

      {/* Browser */}
      <div className="flex justify-center">
        <RuntimeNode
          title="Browser"
          subtitle="进房 enter.total"
          actual={pick(enter)}
          normalLabel={NORMAL.enterTotal.label}
          normalMaxMs={NORMAL.enterTotal.maxMs}
        />
      </div>

      {/* Fast band */}
      <div className="rounded-md border border-dashed border-white/15 bg-white/[0.03] p-3">
        <div className="mb-2 font-body text-xs uppercase tracking-[0.15em] text-white/45">
          快 · 通常 &lt;100ms
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <RuntimeNode
            title="persistMessage"
            subtitle="异步 · 不挡回复"
            actual={null}
            normalLabel={NORMAL.persist.label}
            normalMaxMs={NORMAL.persist.maxMs}
            compact
          />
          <RuntimeNode
            title="Vite :5173"
            subtitle="探针"
            actual={probe('vite')}
            normalLabel={NORMAL.viteProbe.label}
            normalMaxMs={NORMAL.viteProbe.maxMs}
            compact
          />
          <RuntimeNode
            title="humanChat.startChat"
            actual={pick(startChat)}
            normalLabel={NORMAL.startChat.label}
            normalMaxMs={NORMAL.startChat.maxMs}
            compact
          />
          <RuntimeNode
            title="Ollama GET /"
            subtitle="探针"
            actual={probe('ollama')}
            normalLabel={NORMAL.ollamaProbe.label}
            normalMaxMs={NORMAL.ollamaProbe.maxMs}
            compact
          />
          <RuntimeNode
            title="/chat-api 代理"
            subtitle="→ chat-server"
            actual={probe('chat')}
            normalLabel={NORMAL.chatProxy.label}
            normalMaxMs={NORMAL.chatProxy.maxMs}
            compact
          />
        </div>
      </div>

      {/* Slow band */}
      <div className="rounded-md border border-dashed border-rose-400/25 bg-rose-950/15 p-3">
        <div className="mb-2 font-body text-xs uppercase tracking-[0.15em] text-rose-200/70">
          慢 · 秒级 ← 一眼看这里
        </div>
        <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-start lg:justify-center">
          <RuntimeNode
            title="promptContext"
            subtitle="开聊拉人设/记忆"
            actual={pick(prompt)}
            normalLabel={NORMAL.promptContext.label}
            normalMaxMs={NORMAL.promptContext.maxMs}
          />
          <div className="flex flex-col items-center gap-2">
            <RuntimeNode
              title="Convex runStep"
              subtitle="引擎一步"
              actual={pick(runStep)}
              normalLabel={NORMAL.runStep.label}
              normalMaxMs={NORMAL.runStep.maxMs}
            />
            <div className="text-white/25">↓</div>
            <RuntimeNode
              title="agentDoSomething"
              actual={pick(doSomething)}
              normalLabel={NORMAL.doSomething.label}
              normalMaxMs={NORMAL.doSomething.maxMs}
            />
            <div className="flex flex-wrap justify-center gap-2">
              <div className="flex flex-col items-center gap-2">
                <RuntimeNode
                  title="agentGenerateMessage"
                  subtitle="NPC 说话"
                  actual={pick(genMsg)}
                  normalLabel={NORMAL.generateMessage.label}
                  normalMaxMs={NORMAL.generateMessage.maxMs}
                />
                <div className="flex flex-wrap justify-center gap-2">
                  <RuntimeNode
                    title="generateMs"
                    subtitle="编排+LLM"
                    actual={pick(generateMs)}
                    normalLabel={NORMAL.generateMs.label}
                    normalMaxMs={NORMAL.generateMs.maxMs}
                    compact
                  />
                  <RuntimeNode
                    title="sendMs"
                    subtitle="写回/调度"
                    actual={pick(sendMs)}
                    normalLabel={NORMAL.sendMs.label}
                    normalMaxMs={NORMAL.sendMs.maxMs}
                    compact
                  />
                </div>
              </div>
              <RuntimeNode
                title="agentRemember"
                subtitle="对话后固化记忆"
                actual={pick(remember)}
                normalLabel={NORMAL.remember.label}
                normalMaxMs={NORMAL.remember.maxMs}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Infra */}
      <div className="rounded-md border border-dashed border-white/15 bg-white/[0.03] p-3">
        <div className="mb-2 font-body text-xs uppercase tracking-[0.15em] text-white/45">
          后端
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <RuntimeNode
            title="Convex :3210"
            subtitle="探针"
            actual={probe('convex')}
            normalLabel={NORMAL.convexProbe.label}
            normalMaxMs={NORMAL.convexProbe.maxMs}
            compact
          />
          <RuntimeNode
            title="chat-server :8791"
            subtitle={chatServerChat ? `chat ${formatMs(chatServerChat.lastMs)}` : '探针'}
            actual={probe('chat')}
            normalLabel={NORMAL.chatServer.label}
            normalMaxMs={NORMAL.chatServer.maxMs}
            compact
          />
          <RuntimeNode
            title="Ollama chat"
            subtitle="qwen2.5 推理"
            actual={pick(chatLlm) ?? pick(chatServerChat)}
            normalLabel={NORMAL.ollamaChat.label}
            normalMaxMs={NORMAL.ollamaChat.maxMs}
            compact
          />
          <RuntimeNode
            title="Ollama embed"
            subtitle="mxbai（暂无单独埋点）"
            actual={null}
            normalLabel={NORMAL.ollamaEmbed.label}
            normalMaxMs={NORMAL.ollamaEmbed.maxMs}
            compact
          />
        </div>
        <p className="mt-3 text-center font-body text-[11px] text-white/35">
          顶部 Ollama GET 只是存活探针；真正推理看 generateMs / chat-server.llm。无样本时显示 —。
        </p>
      </div>
    </div>
  );
}

function LatencyChart({ points }: { points: ChartPoint[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const hasSamples = useMemo(() => {
    const cutoff = Date.now() - CHART_WINDOW_SEC * 1000;
    return MODULE_SERIES.some((s) => s.samples(points, cutoff).length > 0);
  }, [points]);

  useLayoutEffect(() => {
    if (!hostRef.current) return;
    const width = Math.max(hostRef.current.clientWidth, 320);
    const opts: Options = {
      width,
      height: 280,
      series: [
        {},
        ...MODULE_SERIES.map((s, i) => ({
          label: s.title,
          stroke: SERIES_COLORS[i % SERIES_COLORS.length],
          width: 2,
          spanGaps: true,
          points: { show: true, size: 3 },
        })),
      ],
      axes: [
        {
          stroke: '#cfcfcf',
          grid: { show: false },
          values: (_u, splits) =>
            splits.map((s) => {
              const d = new Date(s * 1000);
              return `${d.getHours().toString().padStart(2, '0')}:${d
                .getMinutes()
                .toString()
                .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
            }),
        },
        {
          stroke: '#cfcfcf',
          grid: { stroke: 'rgba(255,255,255,0.08)' },
          size: 50,
          values: (_u, splits) =>
            splits.map((v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}s` : `${Math.round(v)}`)),
        },
      ],
      scales: {
        x: { time: false },
        y: { range: (_u, _min, max) => [0, Math.max(max * 1.15, 50)] },
      },
      legend: { show: true },
    };
    plotRef.current?.destroy();
    plotRef.current = new uPlot(opts, [[], ...MODULE_SERIES.map(() => [])], hostRef.current);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, []);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const cutoff = Date.now() - CHART_WINDOW_SEC * 1000;
    const perSeries = MODULE_SERIES.map((s) => s.samples(points, cutoff));
    const buckets = new Map<number, Map<number, number>>();

    perSeries.forEach((samples, seriesIdx) => {
      for (const sample of samples) {
        const tSec = Math.floor(sample.at / 1000);
        if (!buckets.has(tSec)) buckets.set(tSec, new Map());
        buckets.get(tSec)!.set(seriesIdx, sample.ms);
      }
    });

    const times = [...buckets.keys()].sort((a, b) => a - b);
    const xs: number[] = [];
    const ys: number[][] = MODULE_SERIES.map(() => []);
    for (const t of times) {
      xs.push(t);
      const bag = buckets.get(t)!;
      MODULE_SERIES.forEach((_, i) => {
        ys[i].push(bag.has(i) ? bag.get(i)! : NaN);
      });
    }

    plot.setData([xs, ...ys] as AlignedData, true);
    const nowSec = Date.now() / 1000;
    plot.setScale('x', { min: nowSec - CHART_WINDOW_SEC, max: nowSec });
  }, [points]);

  useEffect(() => {
    const onResize = () => {
      if (!plotRef.current || !hostRef.current) return;
      plotRef.current.setSize({
        width: Math.max(hostRef.current.clientWidth, 320),
        height: 280,
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="w-full overflow-hidden rounded-md border border-white/10 bg-black/30 p-2">
      <div ref={hostRef} className="w-full" />
      {!hasSamples && (
        <p className="px-2 py-6 text-center text-sm text-white/50">
          暂无模块耗时样本。进入小镇、发消息或等待 NPC 行动后，上方 Runtime 各模块会出现曲线。
        </p>
      )}
    </div>
  );
}

export default function MonitorPage() {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [hubEvents, setHubEvents] = useState<MetricEvent[]>([]);
  const [hubError, setHubError] = useState<string | null>(null);
  const sinceRef = useRef(0);

  const convexEvents = useQuery(api.monitor.recent, { limit: 200 });
  const convexPing = useQuery(api.monitor.ping);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const [snap, hub] = await Promise.all([
          fetchStatus(),
          fetchHubMetrics(sinceRef.current),
        ]);
        if (cancelled) return;
        setStatus(snap);
        setHubError(null);
        if (hub.events.length > 0) {
          const maxId = Math.max(...hub.events.map((e) => e.id ?? 0));
          if (maxId > sinceRef.current) sinceRef.current = maxId;
          setHubEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id).filter((id): id is number => id != null));
            const merged = [...prev];
            for (const e of hub.events) {
              if (e.id != null && seen.has(e.id)) continue;
              merged.push(e);
            }
            return merged.slice(-600);
          });
        }
      } catch (err: any) {
        if (cancelled) return;
        setHubError(err?.message ?? '无法连接 chat-server /status');
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const points = useMemo(
    () =>
      mergeEvents(
        hubEvents,
        convexEvents?.map((row) => ({
          id: String(row.id),
          source: row.source,
          label: row.label,
          ms: row.ms,
          at: row.at,
          extra: row.extra,
        })),
      ),
    [hubEvents, convexEvents],
  );

  const recentRows = useMemo(() => [...points].reverse().slice(0, 40), [points]);

  const downCount = status?.services?.filter((s) => !s.ok).length ?? 0;

  return (
    <main className="min-h-screen bg-[#1a1a1a] text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-body text-xs uppercase tracking-[0.2em] text-white/50">
              local only
            </p>
            <h1 className="font-display text-4xl tracking-wide text-[#fec742] sm:text-5xl">
              伊甸园 Monitor
            </h1>
            <p className="mt-2 max-w-2xl font-body text-sm text-white/70">
              Runtime 耗时结构 + 曲线。数据来自 chat-server 环缓冲与 Convex monitorEvents。
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <a
              href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/`}
              className="rounded border border-[#fec742]/50 px-3 py-2 font-body text-sm text-[#fec742] hover:bg-[#fec742]/10"
            >
              ← 回到小镇
            </a>
            <span className="font-body text-xs text-white/45">
              probe {status?.probeMs ?? '—'} ms
              {status?.chat ? ` · ${status.chat.model}` : ''}
              {convexPing ? ' · convex ok' : ' · convex …'}
              {downCount > 0 ? ` · ${downCount} down` : ''}
            </span>
          </div>
        </header>

        {hubError && (
          <div className="rounded border border-rose-400/40 bg-rose-950/40 px-3 py-2 font-body text-sm text-rose-200">
            chat-server 不可用：{hubError}。请确认 `npm run dev:chat` 已启动（默认 :8791）。
          </div>
        )}

        <RuntimeMap points={points} status={status} />

        <section>
          <h2 className="mb-3 font-display text-2xl text-white/90">模块耗时 (10 min)</h2>
          <p className="mb-2 font-body text-xs text-white/45">
            与上方 Runtime 模块对齐：Browser / startChat / promptContext / runStep / doSomething /
            generateMessage / generateMs / sendMs / remember / chat-server / Ollama chat
          </p>
          <LatencyChart points={points} />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-white/10 bg-black/30 p-3">
            <h3 className="mb-2 font-display text-xl text-[#fec742]">Top labels (5m)</h3>
            <ul className="space-y-1 font-body text-sm text-white/80">
              {(status?.summary ?? []).slice(0, 12).map((row) => (
                <li key={row.key} className="flex justify-between gap-3 border-b border-white/5 py-1">
                  <span className="truncate">{row.key}</span>
                  <span className="shrink-0 text-white/60">
                    avg {row.avgMs} · max {row.maxMs} · n={row.count}
                  </span>
                </li>
              ))}
              {(status?.summary?.length ?? 0) === 0 && (
                <li className="text-white/40">暂无 hub 汇总</li>
              )}
            </ul>
          </div>

          <div className="rounded-md border border-white/10 bg-black/30 p-3">
            <h3 className="mb-2 font-display text-xl text-[#fec742]">Recent events</h3>
            <div className="max-h-80 overflow-auto font-body text-xs">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-black/80 text-white/50">
                  <tr>
                    <th className="py-1 pr-2">time</th>
                    <th className="py-1 pr-2">source</th>
                    <th className="py-1 pr-2">label</th>
                    <th className="py-1 text-right">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRows.map((row, i) => (
                    <tr key={`${row.at}-${row.label}-${i}`} className="border-t border-white/5">
                      <td className="py-1 pr-2 text-white/45">
                        {new Date(row.at).toLocaleTimeString()}
                      </td>
                      <td className="py-1 pr-2 text-white/60">{row.source}</td>
                      <td className="py-1 pr-2 text-white/85">{row.label}</td>
                      <td className="py-1 text-right text-[#fec742]">{Math.round(row.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recentRows.length === 0 && (
                <p className="py-6 text-center text-white/40">等待事件…</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
