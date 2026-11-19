import { v } from 'convex/values';
import { internal } from './_generated/api';
import { ActionCtx, MutationCtx, internalMutation, mutation, query } from './_generated/server';
import { BACKEND_SLOW_MS, logTiming } from './util/timing';

const MAX_ROWS = 500;
const PRUNE_BATCH = 80;

const extraValidator = v.optional(v.string());

function extraToString(extra?: Record<string, unknown>) {
  return extra && Object.keys(extra).length > 0 ? JSON.stringify(extra) : undefined;
}

async function insertEvent(
  ctx: MutationCtx,
  args: { source: string; label: string; ms: number; at?: number; extra?: string },
) {
  const at = args.at ?? Date.now();
  await ctx.db.insert('monitorEvents', {
    source: args.source,
    label: args.label,
    ms: args.ms,
    at,
    extra: args.extra,
  });

  // Occasional prune so local-dev table stays small.
  if (Math.random() < 0.08) {
    const oldest = await ctx.db.query('monitorEvents').withIndex('by_at').order('asc').take(PRUNE_BATCH);
    const rows = await ctx.db.query('monitorEvents').withIndex('by_at').order('desc').take(MAX_ROWS + 1);
    if (rows.length > MAX_ROWS) {
      for (const row of oldest) {
        await ctx.db.delete(row._id);
      }
    }
  }
}

/** Public ingest for local-dev (frontend / chat-server bridge). */
export const record = mutation({
  args: {
    source: v.string(),
    label: v.string(),
    ms: v.number(),
    at: v.optional(v.number()),
    extra: extraValidator,
  },
  handler: async (ctx, args) => {
    await insertEvent(ctx, args);
    return null;
  },
});

export const recordInternal = internalMutation({
  args: {
    source: v.string(),
    label: v.string(),
    ms: v.number(),
    at: v.optional(v.number()),
    extra: extraValidator,
  },
  handler: async (ctx, args) => {
    await insertEvent(ctx, args);
    return null;
  },
});

export const recent = query({
  args: {
    limit: v.optional(v.number()),
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 200, 1), MAX_ROWS);
    const since = args.since ?? 0;
    const rows = await ctx.db.query('monitorEvents').withIndex('by_at').order('desc').take(limit);
    return rows
      .filter((row) => row.at >= since)
      .map((row) => ({
        id: row._id,
        source: row.source,
        label: row.label,
        ms: row.ms,
        at: row.at,
        extra: row.extra,
      }))
      .reverse();
  },
});

/** Cheap RTT probe for the monitor page. */
export const ping = query({
  args: {},
  handler: async () => {
    return { at: Date.now() };
  },
});

export async function persistFromAction(
  ctx: ActionCtx,
  label: string,
  ms: number,
  extra?: Record<string, unknown>,
) {
  try {
    await ctx.runMutation(internal.monitor.recordInternal, {
      source: 'convex',
      label,
      ms,
      at: Date.now(),
      extra: extraToString(extra),
    });
  } catch (err) {
    console.warn('[monitor] persistFromAction failed', err);
  }
}

export async function persistFromMutation(
  ctx: MutationCtx,
  label: string,
  ms: number,
  extra?: Record<string, unknown>,
) {
  try {
    await insertEvent(ctx, {
      source: 'convex',
      label,
      ms,
      at: Date.now(),
      extra: extraToString(extra),
    });
  } catch (err) {
    console.warn('[monitor] persistFromMutation failed', err);
  }
}

/** Console log + persist for action handlers. */
export async function logAndPersistAction(
  ctx: ActionCtx,
  label: string,
  startedAt: number,
  extra?: Record<string, unknown>,
  opts?: { always?: boolean },
): Promise<number> {
  const ms = logTiming(label, startedAt, extra, opts);
  const always = opts?.always ?? true;
  if (always || ms >= BACKEND_SLOW_MS) {
    await persistFromAction(ctx, label, ms, extra);
  }
  return ms;
}

/** Console log + persist for mutation handlers. */
export async function logAndPersistMutation(
  ctx: MutationCtx,
  label: string,
  startedAt: number,
  extra?: Record<string, unknown>,
  opts?: { always?: boolean },
): Promise<number> {
  const ms = logTiming(label, startedAt, extra, opts);
  const always = opts?.always ?? true;
  if (always || ms >= BACKEND_SLOW_MS) {
    await persistFromMutation(ctx, label, ms, extra);
  }
  return ms;
}

/** Local-dev helper: how big is the world blob saveWorld replaces each step? */
export const worldDocStats = query({
  args: {},
  handler: async (ctx) => {
    const worlds = await ctx.db.query('worlds').collect();
    const maps = await ctx.db.query('maps').collect();
    const engines = await ctx.db.query('engines').collect();
    const bytesOf = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
    const histBytes = (loc: unknown) => {
      if (loc == null) return 0;
      if (typeof loc === 'string') return Math.floor(loc.length * 0.75);
      if (loc instanceof ArrayBuffer) return loc.byteLength;
      if (ArrayBuffer.isView(loc)) return loc.byteLength;
      return bytesOf(loc);
    };
    return {
      worlds: worlds.map((w) => {
        const hist = (w.historicalLocations ?? []).map((h) => ({
          playerId: h.playerId,
          bufferBytes: histBytes(h.location),
        }));
        return {
          id: w._id,
          players: w.players.length,
          agents: w.agents.length,
          conversations: w.conversations.length,
          nextId: w.nextId,
          worldJsonBytes: bytesOf(w),
          historicalBuffers: hist,
          historicalBytes: hist.reduce((a, b) => a + b.bufferBytes, 0),
        };
      }),
      maps: maps.map((m) => ({ id: m._id, jsonBytes: bytesOf(m) })),
      engines: engines.map((e) => ({
        id: e._id,
        jsonBytes: bytesOf(e),
        generationNumber: e.generationNumber,
        processedInputNumber: e.processedInputNumber,
      })),
    };
  },
});
