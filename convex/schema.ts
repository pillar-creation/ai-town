import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { agentTables } from './agent/schema';
import { aiTownTables } from './aiTown/schema';
import { conversationId, playerId } from './aiTown/ids';
import { engineTables } from './engine/schema';

export default defineSchema({
  messages: defineTable({
    conversationId,
    messageUuid: v.string(),
    author: playerId,
    text: v.string(),
    worldId: v.optional(v.id('worlds')),
  })
    .index('conversationId', ['worldId', 'conversationId'])
    .index('messageUuid', ['conversationId', 'messageUuid']),

  // Side-channel chats between a human and an NPC. Completely outside world.conversations
  // so they never interrupt agent simulation.
  humanConversations: defineTable({
    worldId: v.id('worlds'),
    human: v.string(),
    playerId,
    humanPlayerId: playerId,
    conversationId,
    created: v.number(),
    status: v.union(v.literal('active'), v.literal('ended')),
  })
    .index('world_human_status', ['worldId', 'human', 'status'])
    .index('conversationId', ['conversationId']),

  // Local-dev timing samples for /ai-town/monitor (not for production analytics).
  monitorEvents: defineTable({
    source: v.string(),
    label: v.string(),
    ms: v.number(),
    at: v.number(),
    extra: v.optional(v.string()),
  }).index('by_at', ['at']),

  ...agentTables,
  ...aiTownTables,
  ...engineTables,
});
