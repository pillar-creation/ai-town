import { Id, TableNames } from './_generated/dataModel';
import { internal } from './_generated/api';
import { DatabaseReader, internalAction, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import schema from './schema';
import { DELETE_BATCH_SIZE } from './constants';
import { kickEngine } from './aiTown/main';
import { insertInput } from './aiTown/insertInput';
import { fetchEmbedding } from './util/llm';
import { chatCompletion } from './util/llm';
import { startConversationMessage } from './agent/conversation';
import { GameId } from './aiTown/ids';
import * as map from '../data/gentle';
import { Descriptions } from '../data/characters';

// Clear all of the tables except for the embeddings cache.
const excludedTables: Array<TableNames> = ['embeddingsCache'];

export const wipeAllTables = internalMutation({
  handler: async (ctx) => {
    for (const tableName of Object.keys(schema.tables)) {
      if (excludedTables.includes(tableName as TableNames)) {
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.testing.deletePage, { tableName, cursor: null });
    }
  },
});

export const deletePage = internalMutation({
  args: {
    tableName: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query(args.tableName as TableNames)
      .paginate({ cursor: args.cursor, numItems: DELETE_BATCH_SIZE });
    for (const row of results.page) {
      await ctx.db.delete(row._id);
    }
    if (!results.isDone) {
      await ctx.scheduler.runAfter(0, internal.testing.deletePage, {
        tableName: args.tableName,
        cursor: results.continueCursor,
      });
    }
  },
});

export const kick = internalMutation({
  handler: async (ctx) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    await kickEngine(ctx, worldStatus.worldId);
  },
});

export const archive = internalMutation({
  handler: async (ctx) => {
    const { worldStatus, engine } = await getDefaultWorld(ctx.db);
    if (engine.running) {
      throw new Error(`Engine ${engine._id} is still running!`);
    }
    console.log(`Archiving world ${worldStatus.worldId}...`);
    await ctx.db.patch(worldStatus._id, { isDefault: false });
  },
});

async function getDefaultWorld(db: DatabaseReader) {
  const worldStatus = await db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  if (!worldStatus) {
    throw new Error(
      'No default world found. Initialize one with `npx convex run init` (or `npm run predev`).',
    );
  }
  const engine = await db.get(worldStatus.engineId);
  if (!engine) {
    throw new Error(`Engine ${worldStatus.engineId} not found`);
  }
  return { worldStatus, engine };
}

export const debugCreatePlayers = internalMutation({
  args: {
    numPlayers: v.number(),
  },
  handler: async (ctx, args) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    for (let i = 0; i < args.numPlayers; i++) {
      const inputId = await insertInput(ctx, worldStatus.worldId, 'join', {
        name: `Robot${i}`,
        description: `This player is a robot.`,
        character: `f${1 + (i % 8)}`,
      });
    }
  },
});

export const randomPositions = internalMutation({
  handler: async (ctx) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    const worldMap = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .unique();
    if (!worldMap) {
      throw new Error(`No map for world ${worldStatus.worldId}`);
    }
    const world = await ctx.db.get(worldStatus.worldId);
    if (!world) {
      throw new Error(`No world for world ${worldStatus.worldId}`);
    }
    for (const player of world.players) {
      await insertInput(ctx, world._id, 'moveTo', {
        playerId: player.id,
        destination: {
          x: 1 + Math.floor(Math.random() * (worldMap.width - 2)),
          y: 1 + Math.floor(Math.random() * (worldMap.height - 2)),
        },
      });
    }
  },
});

/** Create any Descriptions entries not yet present as agents in the default world. */
export const ensureDescribedAgents = internalMutation({
  handler: async (ctx) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .collect();
    const existingNames = new Set(playerDescriptions.map((p) => p.name));
    const created: string[] = [];
    for (let i = 0; i < Descriptions.length; i++) {
      const description = Descriptions[i];
      if (existingNames.has(description.name)) {
        continue;
      }
      await insertInput(ctx, worldStatus.worldId, 'createAgent', {
        descriptionIndex: i,
      });
      created.push(description.name);
    }
    return { created, alreadyPresent: [...existingNames] };
  },
});

/** Refresh identity/plan from data/characters.ts and optionally teleport home. */
export const syncAgentPersonas = internalMutation({
  handler: async (ctx) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    const world = await ctx.db.get(worldStatus.worldId);
    if (!world) {
      throw new Error(`No world ${worldStatus.worldId}`);
    }
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .collect();
    const agentDescriptions = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .collect();

    const updated: string[] = [];
    const teleported: Array<{ name: string; x: number; y: number }> = [];
    const players = world.players.map((p) => ({ ...p }));

    for (const description of Descriptions) {
      const playerDesc = playerDescriptions.find((p) => p.name === description.name);
      if (!playerDesc) continue;

      await ctx.db.patch(playerDesc._id, {
        description: description.identity,
      });

      const agent = world.agents.find((a) => a.playerId === playerDesc.playerId);
      if (agent) {
        const agentDesc = agentDescriptions.find((a) => a.agentId === agent.id);
        if (agentDesc) {
          await ctx.db.patch(agentDesc._id, {
            identity: description.identity,
            plan: description.plan,
          });
        }
      }

      if ('home' in description && description.home) {
        const idx = players.findIndex((p) => p.id === playerDesc.playerId);
        if (idx >= 0) {
          const { x, y } = description.home;
          players[idx] = {
            ...players[idx],
            position: { x, y },
            pathfinding: undefined,
            speed: 0,
          };
          teleported.push({ name: description.name, x, y });
        }
      }
      updated.push(description.name);
    }

    if (teleported.length > 0) {
      await ctx.db.patch(world._id, {
        players,
        historicalLocations: [],
      });
    }

    await kickEngine(ctx, worldStatus.worldId);
    return { updated, teleported };
  },
});

/** Replace the default world's map document with current data/gentle.js (keeps agents). */
export const reloadMap = internalMutation({
  handler: async (ctx) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    const existing = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .unique();
    const payload = {
      width: map.mapwidth,
      height: map.mapheight,
      tileSetUrl: map.tilesetpath,
      tileSetDimX: map.tilesetpxw,
      tileSetDimY: map.tilesetpxh,
      tileDim: map.tiledim,
      bgTiles: map.bgtiles,
      objectTiles: map.objmap,
      animatedSprites: map.animatedsprites,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { updated: existing._id, size: `${payload.width}x${payload.height}`, sprites: payload.animatedSprites.length };
    }
    const id = await ctx.db.insert('maps', { worldId: worldStatus.worldId, ...payload });
    return { inserted: id, size: `${payload.width}x${payload.height}`, sprites: payload.animatedSprites.length };
  },
});

export const testEmbedding = internalAction({
  args: { input: v.string() },
  handler: async (_ctx, args) => {
    return await fetchEmbedding(args.input);
  },
});

export const testCompletion = internalAction({
  args: {},
  handler: async (ctx, args) => {
    return await chatCompletion({
      messages: [
        { content: 'You are helpful', role: 'system' },
        { content: 'Where is pizza?', role: 'user' },
      ],
    });
  },
});

export const testConvo = internalAction({
  args: {},
  handler: async (ctx, args) => {
    const a: any = (await startConversationMessage(
      ctx,
      'm1707m46wmefpejw1k50rqz7856qw3ew' as Id<'worlds'>,
      'c:115' as GameId<'conversations'>,
      'p:0' as GameId<'players'>,
      'p:6' as GameId<'players'>,
    )) as any;
    return await a.readAll();
  },
});

/** Isolated timing probe for conversation-start bottlenecks (no world mutation). */
export const timeConversationBottlenecks = internalAction({
  args: {},
  handler: async (ctx) => {
    const totalStart = Date.now();

    const embStart = Date.now();
    const embedding = await fetchEmbedding('Alice 正在和 Bob 说话');
    const embeddingMs = Date.now() - embStart;

    const llmStart = Date.now();
    const completion = await chatCompletion({
      messages: [
        {
          role: 'system',
          content:
            '你是 Alice，刚刚开始和 Bob 聊天。始终使用简体中文回复。语气口语化。回复不超过 50 字。',
        },
        { role: 'user', content: 'Alice to Bob:' },
      ],
      max_tokens: 80,
    });
    const llmWallMs = Date.now() - llmStart;

    const result = {
      embeddingMs,
      embeddingReportedMs: (embedding as { ms?: number }).ms ?? null,
      llmWallMs,
      llmReportedMs: completion.ms,
      llmRetries: completion.retries,
      sampleReply: completion.content.slice(0, 80),
      totalMs: Date.now() - totalStart,
    };
    console.log('[timing] conversationBottlenecks', result);
    return result;
  },
});
