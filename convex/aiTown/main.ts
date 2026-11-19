import { ConvexError, v } from 'convex/values';
import {
  DatabaseReader,
  MutationCtx,
  internalAction,
  internalMutation,
  mutation,
  query,
} from '../_generated/server';
import { insertInput } from './insertInput';
import { Game } from './game';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { ENGINE_ACTION_DURATION } from '../constants';
import { logTiming } from '../util/timing';

export async function createEngine(ctx: MutationCtx) {
  const now = Date.now();
  const engineId = await ctx.db.insert('engines', {
    currentTime: now,
    generationNumber: 0,
    running: true,
  });
  return engineId;
}

async function loadWorldStatus(db: DatabaseReader, worldId: Id<'worlds'>) {
  const worldStatus = await db
    .query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .unique();
  if (!worldStatus) {
    throw new Error(`No engine found for world ${worldId}`);
  }
  return worldStatus;
}

export async function startEngine(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const { engineId } = await loadWorldStatus(ctx.db, worldId);
  const engine = await ctx.db.get(engineId);
  if (!engine) {
    throw new Error(`Invalid engine ID: ${engineId}`);
  }
  if (engine.running) {
    throw new Error(`Engine ${engineId} isn't currently stopped`);
  }
  const now = Date.now();
  const generationNumber = engine.generationNumber + 1;
  await ctx.db.patch(engineId, {
    // Forcibly advance time to the present. This does mean we'll skip
    // simulating the time the engine was stopped, but we don't want
    // to have to simulate a potentially large stopped window and send
    // it down to clients.
    lastStepTs: engine.currentTime,
    currentTime: now,
    running: true,
    generationNumber,
  });
  await ctx.scheduler.runAfter(0, internal.aiTown.main.runStep, {
    worldId: worldId,
    generationNumber,
    maxDuration: ENGINE_ACTION_DURATION,
  });
}

export async function kickEngine(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const { engineId } = await loadWorldStatus(ctx.db, worldId);
  const engine = await ctx.db.get(engineId);
  if (!engine) {
    throw new Error(`Invalid engine ID: ${engineId}`);
  }
  if (!engine.running) {
    throw new Error(`Engine ${engineId} isn't currently running`);
  }
  const generationNumber = engine.generationNumber + 1;
  await ctx.db.patch(engineId, { generationNumber });
  await ctx.scheduler.runAfter(0, internal.aiTown.main.runStep, {
    worldId: worldId,
    generationNumber,
    maxDuration: ENGINE_ACTION_DURATION,
  });
}

export async function stopEngine(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const { engineId } = await loadWorldStatus(ctx.db, worldId);
  const engine = await ctx.db.get(engineId);
  if (!engine) {
    throw new Error(`Invalid engine ID: ${engineId}`);
  }
  if (!engine.running) {
    throw new Error(`Engine ${engineId} isn't currently running`);
  }
  await ctx.db.patch(engineId, { running: false });
}

/** Jump simulation clock forward without replaying the missed window. */
export const snapEngineClock = internalMutation({
  args: {
    engineId: v.id('engines'),
    generationNumber: v.number(),
    currentTime: v.number(),
    lastStepTs: v.number(),
  },
  handler: async (ctx, args) => {
    const engine = await ctx.db.get(args.engineId);
    if (!engine) {
      throw new Error(`Invalid engine ID: ${args.engineId}`);
    }
    if (engine.generationNumber !== args.generationNumber) {
      throw new ConvexError({ kind: 'generationNumber' as const, message: 'stale snap' });
    }
    await ctx.db.patch(args.engineId, {
      currentTime: args.currentTime,
      lastStepTs: args.lastStepTs,
    });
  },
});

export const runStep = internalAction({
  args: {
    worldId: v.id('worlds'),
    generationNumber: v.number(),
    maxDuration: v.number(),
  },
  handler: async (ctx, args) => {
    const actionStarted = Date.now();
    let steps = 0;
    let loadMs = 0;
    let stepMsTotal = 0;
    let nextDelayMs = 0;
    let lastStepStarted = actionStarted;
    // Per-step wall breakdown: loadInputs / simulate / save / behind.
    const stepDetails: Array<{
      i: number;
      total: number;
      loadInputs: number;
      simulate: number;
      save: number;
      behind: number;
    }> = [];
    try {
      const loadStarted = Date.now();
      const { engine, gameState } = await ctx.runQuery(internal.aiTown.game.loadWorld, {
        worldId: args.worldId,
        generationNumber: args.generationNumber,
      });
      loadMs = Date.now() - loadStarted;
      const game = new Game(engine, args.worldId, gameState);

      const now = Date.now();
      let engineTime = game.engine.currentTime ?? now;
      let behindMs = now - engineTime;
      // Hours of backlog used to catch up at ~10x realtime (100ms yield / 1s
      // sim step), so NPCs looked like they were on fast-forward. Skip large
      // gaps the same way startEngine does when restarting a stopped world.
      const CATCH_UP_SNAP_MS = 60_000;
      if (behindMs > CATCH_UP_SNAP_MS) {
        console.warn(
          `[engine] ${behindMs}ms behind wall clock; snapping instead of fast-forward catch-up`,
        );
        const snapped = now - game.stepDuration;
        await ctx.runMutation(internal.aiTown.main.snapEngineClock, {
          engineId: game.engine._id,
          generationNumber: args.generationNumber,
          currentTime: snapped,
          lastStepTs: snapped - game.stepDuration,
        });
        game.engine.currentTime = snapped;
        game.engine.lastStepTs = snapped - game.stepDuration;
        engineTime = snapped;
        behindMs = now - engineTime;
      }
      lastStepStarted = Date.now();
      const parts = await game.runStep(ctx, now);
      const stepWall = Date.now() - lastStepStarted;
      stepMsTotal += stepWall;
      steps += 1;
      stepDetails.push({
        i: steps,
        total: stepWall,
        loadInputs: parts.loadInputsMs,
        simulate: parts.simulateMs,
        save: parts.saveMs,
        behind: behindMs,
      });
      const behindAfter = Date.now() - (game.engine.currentTime ?? Date.now());
      const paceUntil = lastStepStarted + game.stepDuration;
      // Pace catch-up near realtime (1s sim / ~1s wall). The old 100ms yield
      // made mild lag look like 10x speed on the client.
      const MIN_YIELD_MS = 100;
      const CATCH_UP_YIELD_MS = game.stepDuration;
      nextDelayMs =
        behindAfter > game.stepDuration * 2
          ? CATCH_UP_YIELD_MS
          : Math.max(MIN_YIELD_MS, paceUntil - Date.now());
      // Console only — persisting here was another mutation on the hot path
      // and wedged the self-hosted isolate pool (pages hung on 10s timeouts).
      logTiming(
        'aiTown.main.runStep',
        actionStarted,
        {
          worldId: String(args.worldId),
          gen: args.generationNumber,
          maxDuration: args.maxDuration,
          steps,
          loadMs,
          stepMsTotal,
          nextDelayMs,
          stepsMs: stepDetails.map((d) => [
            d.i,
            d.total,
            d.loadInputs,
            d.simulate,
            d.save,
            d.behind,
          ]),
          players: gameState.world.players.length,
          agents: gameState.world.agents.length,
        },
        { always: false },
      );
      await ctx.scheduler.runAfter(nextDelayMs, internal.aiTown.main.runStep, {
        worldId: args.worldId,
        generationNumber: game.engine.generationNumber,
        maxDuration: args.maxDuration,
      });
    } catch (e: unknown) {
      logTiming('aiTown.main.runStep.FAILED', actionStarted, {
        worldId: String(args.worldId),
        gen: args.generationNumber,
        steps,
        loadMs,
        stepMsTotal,
        nextDelayMs,
        stepsMs: stepDetails.map((d) => [
          d.i,
          d.total,
          d.loadInputs,
          d.simulate,
          d.save,
          d.behind,
        ]),
        error: e instanceof Error ? e.message : String(e),
      });
      if (e instanceof ConvexError) {
        if (e.data.kind === 'engineNotRunning') {
          console.debug(`Engine is not running: ${e.message}`);
          return;
        }
        if (e.data.kind === 'generationNumber') {
          console.debug(`Generation number mismatch: ${e.message}`);
          return;
        }
      }
      throw e;
    }
  },
});

export const sendInput = mutation({
  args: {
    worldId: v.id('worlds'),
    name: v.string(),
    args: v.any(),
  },
  handler: async (ctx, args) => {
    return await insertInput(ctx, args.worldId, args.name as any, args.args);
  },
});

export const inputStatus = query({
  args: {
    inputId: v.id('inputs'),
  },
  handler: async (ctx, args) => {
    const input = await ctx.db.get(args.inputId);
    if (!input) {
      throw new Error(`Invalid input ID: ${args.inputId}`);
    }
    return input.returnValue ?? null;
  },
});
