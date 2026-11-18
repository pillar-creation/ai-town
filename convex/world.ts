import { ConvexError, v } from 'convex/values';
import { QueryCtx, internalMutation, mutation, query } from './_generated/server';
import { Id } from './_generated/dataModel';
import { characters } from '../data/characters';
import { insertInput } from './aiTown/insertInput';
import {
  DEFAULT_NAME,
  ENGINE_ACTION_DURATION,
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

export const restartDeadWorlds = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    // Restart an engine if it hasn't run for 2x its action duration.
    const engineTimeout = now - ENGINE_ACTION_DURATION * 2;
    const worlds = await ctx.db.query('worldStatus').collect();
    for (const worldStatus of worlds) {
      if (worldStatus.status !== 'running') {
        continue;
      }
      const engine = await ctx.db.get(worldStatus.engineId);
      if (!engine) {
        throw new Error(`Invalid engine ID: ${worldStatus.engineId}`);
      }
      if (engine.currentTime && engine.currentTime < engineTimeout) {
        console.warn(`Restarting dead engine ${engine._id}...`);
        await kickEngine(ctx, worldStatus.worldId);
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

async function playerName(ctx: QueryCtx, worldId: Id<'worlds'>, id: string): Promise<string> {
  const description = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId).eq('playerId', id))
    .first();
  return description?.name ?? id;
}

export const playerConversationHistory = query({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    const archived = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();

    const mine = archived
      .filter(
        (conversation) =>
          conversation.participants.includes(args.playerId) && conversation.numMessages > 0,
      )
      .sort((a, b) => b.created - a.created)
      .slice(0, 30);

    const conversations = [];
    for (const conversation of mine) {
      const otherPlayerIds = conversation.participants.filter((id) => id !== args.playerId);
      const others = await Promise.all(
        otherPlayerIds.map(async (id) => ({
          playerId: id,
          name: await playerName(ctx, args.worldId, id),
        })),
      );

      const messages = await ctx.db
        .query('messages')
        .withIndex('conversationId', (q) =>
          q.eq('worldId', args.worldId).eq('conversationId', conversation.id),
        )
        .collect();

      conversations.push({
        conversationId: conversation.id,
        created: conversation.created,
        ended: conversation.ended,
        others,
        messages: await Promise.all(
          [...messages]
            .sort((a, b) => a._creationTime - b._creationTime)
            .map(async (message) => ({
              _id: message._id,
              author: message.author,
              authorName: await playerName(ctx, args.worldId, message.author),
              text: message.text,
              _creationTime: message._creationTime,
            })),
        ),
      });
    }
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
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }

    const agent = world.agents.find((a) => a.playerId === args.playerId);
    const agentDescription = agent
      ? await ctx.db
          .query('agentDescriptions')
          .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
          .unique()
      : null;

    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();

    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .order('desc')
      .take(50);

    return {
      playerName: playerDescription?.name ?? args.playerId,
      agent: agent
        ? {
            agentId: agent.id,
            identity: agentDescription?.identity ?? '',
            plan: agentDescription?.plan ?? '',
            inProgressOperation: agent.inProgressOperation
              ? {
                  name: agent.inProgressOperation.name,
                  started: agent.inProgressOperation.started,
                }
              : null,
          }
        : null,
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
