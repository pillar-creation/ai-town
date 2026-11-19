import { ConvexError, v } from 'convex/values';
import { QueryCtx, internalMutation, mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';
import { characters } from '../data/characters';
import { insertInput } from './aiTown/insertInput';
import {
  DEFAULT_NAME,
  ENGINE_ACTION_DURATION,
  HUMAN_CHAT_AUTHOR_ID,
  IDLE_WORLD_TIMEOUT,
  WORLD_HEARTBEAT_INTERVAL,
} from './constants';
import { playerId } from './aiTown/ids';
import { kickEngine, startEngine, stopEngine } from './aiTown/main';
import { engineInsertInput } from './engine/abstractGame';
import { logTiming, logTimingSlowOnly } from './util/timing';

export const defaultWorldStatus = query({
  handler: async (ctx) => {
    const started = Date.now();
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('isDefault', (q) => q.eq('isDefault', true))
      .first();
    logTimingSlowOnly('world.defaultWorldStatus', started, {
      found: !!worldStatus,
      status: worldStatus?.status ?? null,
    });
    return worldStatus;
  },
});

export const heartbeatWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .first();
    if (!worldStatus) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const now = Date.now();

    // Skip the update (and then potentially make the transaction readonly)
    // if it's been viewed sufficiently recently..
    if (!worldStatus.lastViewed || worldStatus.lastViewed < now - WORLD_HEARTBEAT_INTERVAL / 2) {
      await ctx.db.patch(worldStatus._id, {
        lastViewed: Math.max(worldStatus.lastViewed ?? now, now),
      });
    }

    // Restart worlds that are not simulating. Freeze/unfreeze is no longer a
    // product surface, so stopped worlds should come back when someone is watching.
    if (worldStatus.status !== 'running') {
      console.log(`Restarting ${worldStatus.status} world ${worldStatus._id}...`);
      await ctx.db.patch(worldStatus._id, { status: 'running' });
      const engine = await ctx.db.get(worldStatus.engineId);
      if (engine && !engine.running) {
        await startEngine(ctx, worldStatus.worldId);
      }
    }
  },
});

export const stopInactiveWorlds = internalMutation({
  handler: async (ctx) => {
    const cutoff = Date.now() - IDLE_WORLD_TIMEOUT;
    const worlds = await ctx.db.query('worldStatus').collect();
    for (const worldStatus of worlds) {
      if (cutoff < worldStatus.lastViewed || worldStatus.status !== 'running') {
        continue;
      }
      console.log(`Stopping inactive world ${worldStatus._id}`);
      await ctx.db.patch(worldStatus._id, { status: 'inactive' });
      await stopEngine(ctx, worldStatus.worldId);
    }
  },
});

/** Stop the default world so client queries can run when the isolate pool is wedged. */
export const freezeDefaultWorld = mutation({
  handler: async (ctx) => {
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('isDefault', (q) => q.eq('isDefault', true))
      .first();
    if (!worldStatus) {
      return { ok: false as const };
    }
    await ctx.db.patch(worldStatus._id, { status: 'inactive' });
    const engine = await ctx.db.get(worldStatus.engineId);
    if (engine?.running) {
      await ctx.db.patch(engine._id, {
        running: false,
        generationNumber: engine.generationNumber + 1,
      });
    }
    return { ok: true as const, worldId: worldStatus.worldId };
  },
});

/**
 * Recover a wedged simulation: drop in-world conversations / stuck agent ops,
 * jump engine time to wall clock, and restart the loop. Use when NPCs look
 * frozen because runStep fell minutes behind.
 */
export const recoverDefaultWorld = mutation({
  handler: async (ctx) => {
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('isDefault', (q) => q.eq('isDefault', true))
      .first();
    if (!worldStatus) {
      return { ok: false as const, reason: 'no-default-world' as const };
    }
    const world = await ctx.db.get(worldStatus.worldId);
    if (!world) {
      return { ok: false as const, reason: 'missing-world' as const };
    }
    const engine = await ctx.db.get(worldStatus.engineId);
    if (!engine) {
      return { ok: false as const, reason: 'missing-engine' as const };
    }

    const clearedConversations = world.conversations.length;
    const clearedOps = world.agents.filter((a) => a.inProgressOperation).length;

    const players = world.players.map((p) => {
      const next = { ...p };
      delete next.pathfinding;
      delete next.activity;
      next.speed = 0;
      return next;
    });
    const agents = world.agents.map((a, i) => {
      const next = { ...a };
      delete next.inProgressOperation;
      delete next.toRemember;
      // Stagger invite eligibility so agents don't all fire agentDoSomething together.
      next.lastInviteAttempt = Date.now() + i * 20_000;
      return next;
    });

    await ctx.db.replace(world._id, {
      ...world,
      players,
      agents,
      conversations: [],
    });

    const now = Date.now();
    // Invalidate in-flight runSteps / agent ops tied to the old generation.
    if (engine.running) {
      await ctx.db.patch(engine._id, {
        running: false,
        generationNumber: engine.generationNumber + 1,
      });
    }
    await ctx.db.patch(worldStatus._id, {
      status: 'running',
      lastViewed: now,
    });
    await startEngine(ctx, worldStatus.worldId);
    const restarted = await ctx.db.get(worldStatus.engineId);

    return {
      ok: true as const,
      worldId: worldStatus.worldId,
      clearedConversations,
      clearedOps,
      generationNumber: restarted?.generationNumber ?? engine.generationNumber + 1,
    };
  },
});

export const restartDeadWorlds = internalMutation({
  handler: async (ctx) => {
    // Only restart when the loop is actually stopped. Comparing simulation
    // `currentTime` to wall clock is wrong: a healthy engine can fall minutes
    // behind while catching up, and kicking it every minute causes generation
    // mismatches that wedge the isolate pool (NPCs look frozen).
    const worlds = await ctx.db.query('worldStatus').collect();
    for (const worldStatus of worlds) {
      if (worldStatus.status !== 'running') {
        continue;
      }
      const engine = await ctx.db.get(worldStatus.engineId);
      if (!engine) {
        throw new Error(`Invalid engine ID: ${worldStatus.engineId}`);
      }
      if (!engine.running) {
        console.warn(`Restarting stopped engine ${engine._id} for running world...`);
        await startEngine(ctx, worldStatus.worldId);
      }
    }
  },
});

export const userStatus = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    // const identity = await ctx.auth.getUserIdentity();
    // if (!identity) {
    //   return null;
    // }
    // return identity.tokenIdentifier;
    return DEFAULT_NAME;
  },
});

export const joinWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const name = DEFAULT_NAME;
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new ConvexError(`Invalid world ID: ${args.worldId}`);
    }
    const existingPlayer = world.players.find((p) => p.human === DEFAULT_NAME);
    if (existingPlayer) {
      return null;
    }
    return await insertInput(ctx, world._id, 'join', {
      name,
      character: characters[Math.floor(Math.random() * characters.length)].name,
      description: `${DEFAULT_NAME} 是前来小镇闲逛、想和大家聊天的访客。`,
      tokenIdentifier: DEFAULT_NAME,
    });
  },
});

export const leaveWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const existingPlayer = world.players.find((p) => p.human === DEFAULT_NAME);
    if (!existingPlayer) {
      return;
    }
    await insertInput(ctx, world._id, 'leave', {
      playerId: existingPlayer.id,
    });
  },
});

export const sendWorldInput = mutation({
  args: {
    engineId: v.id('engines'),
    name: v.string(),
    args: v.any(),
  },
  handler: async (ctx, args) => {
    // const identity = await ctx.auth.getUserIdentity();
    // if (!identity) {
    //   throw new Error(`Not logged in`);
    // }
    return await engineInsertInput(ctx, args.engineId, args.name as any, args.args);
  },
});

export const worldState = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const started = Date.now();
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', world._id))
      .unique();
    if (!worldStatus) {
      throw new Error(`Invalid world status ID: ${world._id}`);
    }
    const engine = await ctx.db.get(worldStatus.engineId);
    if (!engine) {
      throw new Error(`Invalid engine ID: ${worldStatus.engineId}`);
    }
    // Re-runs ~every engine step; only log when slow to avoid drowning the backend.
    logTimingSlowOnly('world.worldState', started, {
      worldId: String(args.worldId),
      players: world.players.length,
      agents: world.agents.length,
      conversations: world.conversations.length,
      engineRunning: engine.running,
    });
    return { world, engine };
  },
});

export const gameDescriptions = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const started = Date.now();
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const agentDescriptions = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const worldMap = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .first();
    if (!worldMap) {
      throw new Error(`No map for world: ${args.worldId}`);
    }
    logTimingSlowOnly('world.gameDescriptions', started, {
      worldId: String(args.worldId),
      players: playerDescriptions.length,
      agents: agentDescriptions.length,
      map: `${worldMap.width}x${worldMap.height}`,
    });
    return { worldMap, playerDescriptions, agentDescriptions };
  },
});

/** One-shot probe: `npx convex run world:backendDiagnostics` */
export const backendDiagnostics = query({
  args: {},
  handler: async (ctx) => {
    const started = Date.now();
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('isDefault', (q) => q.eq('isDefault', true))
      .first();
    if (!worldStatus) {
      return { ok: false as const, reason: 'no default world', totalMs: Date.now() - started };
    }
    const world = await ctx.db.get(worldStatus.worldId);
    const engine = await ctx.db.get(worldStatus.engineId);
    const maps = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .collect();
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .collect();
    const result = {
      ok: true as const,
      worldId: worldStatus.worldId,
      engineId: worldStatus.engineId,
      worldStatus: worldStatus.status,
      engineRunning: engine?.running ?? null,
      engineCurrentTime: engine?.currentTime ?? null,
      players: world?.players.length ?? 0,
      agents: world?.agents.length ?? 0,
      conversations: world?.conversations.length ?? 0,
      playerDescriptions: playerDescriptions.length,
      maps: maps.length,
      engineActionDurationMs: ENGINE_ACTION_DURATION,
      totalMs: Date.now() - started,
    };
    logTiming('world.backendDiagnostics', started, result as unknown as Record<string, unknown>);
    return result;
  },
});

export const previousConversation = query({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    // Walk the player's history in descending order, looking for a nonempty
    // conversation.
    const members = ctx.db
      .query('participatedTogether')
      .withIndex('playerHistory', (q) => q.eq('worldId', args.worldId).eq('player1', args.playerId))
      .order('desc');

    for await (const member of members) {
      const conversation = await ctx.db
        .query('archivedConversations')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', member.conversationId))
        .unique();
      if (!conversation) {
        throw new Error(`Invalid conversation ID: ${member.conversationId}`);
      }
      if (conversation.numMessages > 0) {
        return conversation;
      }
    }
    return null;
  },
});

const HISTORY_CONVERSATION_LIMIT = 20;
const HISTORY_MESSAGES_PER_CONVERSATION = 40;

async function loadPlayerNameMap(ctx: QueryCtx, worldId: Id<'worlds'>) {
  const descriptions = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();
  const names = new Map<string, string>();
  for (const description of descriptions) {
    names.set(description.playerId, description.name);
  }
  names.set(HUMAN_CHAT_AUTHOR_ID, DEFAULT_NAME);
  names.set(DEFAULT_NAME, DEFAULT_NAME);
  return names;
}

export const playerConversationHistory = query({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    const started = Date.now();

    // Use the player edge index instead of scanning every archived conversation.
    const edgeStarted = Date.now();
    const seen = new Set<string>();
    const conversationIds: string[] = [];
    const edges = ctx.db
      .query('participatedTogether')
      .withIndex('playerHistory', (q) =>
        q.eq('worldId', args.worldId).eq('player1', args.playerId),
      )
      .order('desc');
    for await (const edge of edges) {
      if (seen.has(edge.conversationId)) {
        continue;
      }
      seen.add(edge.conversationId);
      conversationIds.push(edge.conversationId);
      if (conversationIds.length >= HISTORY_CONVERSATION_LIMIT) {
        break;
      }
    }
    const edgeMs = Date.now() - edgeStarted;

    const nameStarted = Date.now();
    const names = await loadPlayerNameMap(ctx, args.worldId);
    const nameMs = Date.now() - nameStarted;

    const conversations = [];
    let messageRows = 0;
    const hydrateStarted = Date.now();
    for (const conversationIdValue of conversationIds) {
      const conversation = await ctx.db
        .query('archivedConversations')
        .withIndex('worldId', (q) =>
          q.eq('worldId', args.worldId).eq('id', conversationIdValue),
        )
        .unique();
      if (!conversation || conversation.numMessages <= 0) {
        continue;
      }

      const otherPlayerIds = conversation.participants.filter((id) => id !== args.playerId);
      const others = otherPlayerIds.map((id) => ({
        playerId: id,
        name: names.get(id) ?? id,
      }));

      const messages = await ctx.db
        .query('messages')
        .withIndex('conversationId', (q) =>
          q.eq('worldId', args.worldId).eq('conversationId', conversation.id),
        )
        .collect();
      const sorted = [...messages].sort((a, b) => a._creationTime - b._creationTime);
      const clipped =
        sorted.length > HISTORY_MESSAGES_PER_CONVERSATION
          ? sorted.slice(-HISTORY_MESSAGES_PER_CONVERSATION)
          : sorted;
      messageRows += clipped.length;

      conversations.push({
        conversationId: conversation.id,
        created: conversation.created,
        ended: conversation.ended,
        others,
        messages: clipped.map((message) => ({
          _id: message._id,
          author: message.author,
          authorName:
            names.get(message.author) ??
            (message.author.startsWith('hc:') ? DEFAULT_NAME : message.author),
          text: message.text,
          _creationTime: message._creationTime,
        })),
      });
    }

    logTiming('world.playerConversationHistory', started, {
      edges: conversationIds.length,
      conversations: conversations.length,
      messageRows,
      edgeMs,
      nameMs,
      hydrateMs: Date.now() - hydrateStarted,
      totalMs: Date.now() - started,
    });
    return conversations;
  },
});

const MEMORY_TYPE_LABELS = {
  conversation: '对话回忆',
  reflection: '自我反思',
  relationship: '关系印象',
} as const;

/** 角色 / agent 的记忆流动作回顾（对话总结、反思、关系印象）。 */
export const playerActionHistory = query({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    const started = Date.now();
    // Avoid reading the hot `worlds` document (contended with saveWorld).
    // Agent identity/plan/in-progress come from the live client game state.
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    const descMs = Date.now() - started;

    const memStarted = Date.now();
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .order('desc')
      .take(40);
    const memoriesMs = Date.now() - memStarted;

    logTiming('world.playerActionHistory', started, {
      descMs,
      memoriesMs,
      memories: memories.length,
      totalMs: Date.now() - started,
    });

    return {
      playerName: playerDescription?.name ?? args.playerId,
      // Kept for API compatibility; UI should prefer live game descriptions.
      agent: null,
      actions: memories.map((memory) => ({
        _id: memory._id,
        description: memory.description,
        importance: memory.importance,
        lastAccess: memory.lastAccess,
        created: memory._creationTime,
        type: memory.data.type,
        typeLabel: MEMORY_TYPE_LABELS[memory.data.type],
      })),
    };
  },
});
