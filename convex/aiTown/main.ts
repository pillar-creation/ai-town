import { ConvexError, v } from 'convex/values';
import { DatabaseReader, MutationCtx, internalAction, mutation, query } from '../_generated/server';
import { insertInput } from './insertInput';
import { Game } from './game';
import { internal } from '../_generated/api';
import { sleep } from '../util/sleep';
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
    try {
      const loadStarted = Date.now();
      const { engine, gameState } = await ctx.runQuery(internal.aiTown.game.loadWorld, {
        worldId: args.worldId,
        generationNumber: args.generationNumber,
      });
      loadMs = Date.now() - loadStarted;
      const game = new Game(engine, args.worldId, gameState);

      let now = Date.now();
      const deadline = now + args.maxDuration;
      while (now < deadline) {
        const engineTime = game.engine.currentTime ?? now;
        const behindMs = now - engineTime;
        const stepStarted = Date.now();
        await game.runStep(ctx, now);
        stepMsTotal += Date.now() - stepStarted;
        steps += 1;
        now = Date.now();
        // While draining backlog, skip pacing sleeps so we catch up with many
        // ~1s steps (smooth for clients) instead of one huge history dump.
        if (behindMs > game.stepDuration * 2) {
          continue;
        }
        const sleepUntil = Math.min(now + game.stepDuration, deadline);
        const sleepMs = sleepUntil - now;
        if (sleepMs > 0) {
          await sleep(sleepMs);
        }
        now = Date.now();
      }
      logTiming('aiTown.main.runStep', actionStarted, {
        worldId: String(args.worldId),
        gen: args.generationNumber,
        maxDuration: args.maxDuration,
        steps,
        loadMs,
        stepMsTotal,
        players: gameState.world.players.length,
        agents: gameState.world.agents.length,
      });
      await ctx.scheduler.runAfter(0, internal.aiTown.main.runStep, {
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
