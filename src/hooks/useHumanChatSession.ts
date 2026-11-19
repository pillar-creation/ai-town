import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { HUMAN_CHAT_AUTHOR_ID, DEFAULT_NAME } from '../../convex/constants';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from './serverGame';
import { reportMetric } from '../utils/metrics.ts';

export type LocalChatMessage = {
  messageUuid: string;
  author: string;
  authorName: string;
  text: string;
  _creationTime: number;
};

export type LocalHumanChat = {
  conversationId: string;
  playerId: GameId<'players'>;
  humanPlayerId: string;
  messages: LocalChatMessage[];
};

type NpcPrompt = {
  playerId?: string;
  npcName: string;
  identity?: string;
  description?: string;
  plan?: string;
  agentHistorySummaries: string[];
  humanHistorySummaries: string[];
};

function chatApiBase() {
  const fromEnv = import.meta.env.VITE_CHAT_API_URL as string | undefined;
  return (fromEnv?.replace(/\/$/, '') || '/chat-api');
}

function newConversationId() {
  return `hc:${crypto.randomUUID()}`;
}

type PersistArgs = {
  worldId: Id<'worlds'>;
  conversationId: string;
  author: string;
  text: string;
  messageUuid: string;
};

async function persistWithRetry(
  persist: (args: PersistArgs) => Promise<unknown>,
  getArgs: () => PersistArgs,
  attempts = 6,
) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      // Re-read args each attempt so an adopted conversationId is picked up.
      await persist(getArgs());
      return;
    } catch (err) {
      lastError = err;
      // startChat may still be queued / id may still be syncing; back off and retry.
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  console.warn('[timing] ui.persistMessage.failed', lastError);
}

export function useHumanChatSession(args: {
  worldId: Id<'worlds'>;
  game: ServerGame;
}) {
  const { worldId, game } = args;
  const convex = useConvex();
  const remoteActive = useQuery(api.humanChat.activeChat, { worldId });
  const startChat = useMutation(api.humanChat.startChat);
  const endChatMutation = useMutation(api.humanChat.endChat);
  const persistMessage = useMutation(api.humanChat.persistMessage);

  const [localChat, setLocalChat] = useState<LocalHumanChat | null>(null);
  const [npcTyping, setNpcTyping] = useState(false);
  const localChatRef = useRef(localChat);
  localChatRef.current = localChat;
  const greetingStartedRef = useRef(new Set<string>());

  // One-shot cache: loaded when a chat opens, not via reactive useQuery
  // (failed/timeout queries throw during render and crash PlayerDetails).
  const promptContextRef = useRef<NpcPrompt | null>(null);
  const promptLoadPromiseRef = useRef<Promise<NpcPrompt | null> | null>(null);
  const promptLoadPlayerRef = useRef<string | null>(null);

  const remoteMessages = useQuery(
    api.messages.listMessages,
    localChat
      ? { worldId, conversationId: localChat.conversationId }
      : remoteActive
        ? { worldId, conversationId: remoteActive.conversationId }
        : 'skip',
  );

  const localNpcPrompt = useCallback(
    (playerId: GameId<'players'>): NpcPrompt => {
      const desc = game.playerDescriptions.get(playerId);
      const agent = [...game.world.agents.values()].find((a) => a.playerId === playerId);
      const agentDesc = agent ? game.agentDescriptions.get(agent.id) : undefined;
      return {
        playerId,
        npcName: desc?.name ?? 'NPC',
        description: desc?.description,
        identity: agentDesc?.identity,
        plan: agentDesc?.plan,
        agentHistorySummaries: [],
        humanHistorySummaries: [],
      };
    },
    [game],
  );

  const clearPromptCache = useCallback(() => {
    promptContextRef.current = null;
    promptLoadPromiseRef.current = null;
    promptLoadPlayerRef.current = null;
  }, []);

  const prefetchPromptContext = useCallback(
    (playerId: GameId<'players'>) => {
      if (promptContextRef.current?.playerId === playerId) {
        return;
      }
      if (promptLoadPlayerRef.current === playerId && promptLoadPromiseRef.current) {
        return;
      }

      promptLoadPlayerRef.current = playerId;
      const started = performance.now();
      const promise = convex
        .query(api.humanChat.promptContext, { worldId, playerId })
        .then((remote) => {
          if (promptLoadPlayerRef.current !== playerId) {
            return null;
          }
          const prompt: NpcPrompt = {
            playerId,
            npcName: remote.npcName || localNpcPrompt(playerId).npcName,
            identity: remote.identity,
            description: remote.description,
            plan: remote.plan,
            agentHistorySummaries: remote.agentHistorySummaries ?? [],
            humanHistorySummaries: remote.humanHistorySummaries ?? [],
          };
          promptContextRef.current = prompt;
          const promptMs = Math.round(performance.now() - started);
          console.log(
            `[timing] ui.promptContext.once: ${promptMs}ms ` +
              `npc=${prompt.npcName} agentHist=${prompt.agentHistorySummaries.length} ` +
              `humanHist=${prompt.humanHistorySummaries.length}`,
          );
          reportMetric('ui.promptContext.once', promptMs, {
            npc: prompt.npcName,
            agentHist: prompt.agentHistorySummaries.length,
            humanHist: prompt.humanHistorySummaries.length,
          });
          return prompt;
        })
        .catch((err) => {
          if (promptLoadPlayerRef.current === playerId) {
            console.warn('[timing] ui.promptContext.once.failed, using local fallback', err);
          }
          return null;
        })
        .finally(() => {
          if (promptLoadPlayerRef.current === playerId) {
            promptLoadPromiseRef.current = null;
          }
        });
      promptLoadPromiseRef.current = promise;
    },
    [convex, localNpcPrompt, worldId],
  );

  const resolveNpcPrompt = useCallback(
    async (playerId: GameId<'players'>): Promise<NpcPrompt> => {
      const cached = promptContextRef.current;
      if (cached?.playerId === playerId) {
        return cached;
      }
      if (promptLoadPlayerRef.current === playerId && promptLoadPromiseRef.current) {
        const loaded = await promptLoadPromiseRef.current;
        if (loaded?.playerId === playerId) {
          return loaded;
        }
      }
      return localNpcPrompt(playerId);
    },
    [localNpcPrompt],
  );

  // Hydrate from Convex after refresh when we have no local session.
  useEffect(() => {
    if (localChatRef.current || !remoteActive) {
      return;
    }
    const playerId = remoteActive.playerId as GameId<'players'>;
    setLocalChat({
      conversationId: remoteActive.conversationId,
      playerId,
      humanPlayerId: remoteActive.humanPlayerId,
      messages: [],
    });
    prefetchPromptContext(playerId);
  }, [prefetchPromptContext, remoteActive]);

  // Merge remote messages into local (local wins on uuid collision).
  useEffect(() => {
    if (!remoteMessages || !localChatRef.current) {
      return;
    }
    setLocalChat((current) => {
      if (!current) return current;
      const byUuid = new Map(current.messages.map((m) => [m.messageUuid, m]));
      let changed = false;
      for (const m of remoteMessages) {
        if (!byUuid.has(m.messageUuid)) {
          byUuid.set(m.messageUuid, {
            messageUuid: m.messageUuid,
            author: m.author,
            authorName: m.authorName,
            text: m.text,
            _creationTime: m._creationTime,
          });
          changed = true;
        }
      }
      if (!changed) return current;
      const merged = [...byUuid.values()].sort((a, b) => a._creationTime - b._creationTime);
      return { ...current, messages: merged };
    });
  }, [remoteMessages]);

  const requestNpcOpening = useCallback(
    async (chat: LocalHumanChat) => {
      if (chat.messages.length > 0) return;
      // Dedupe by NPC — conversationId can change when startChat adopts a server id.
      if (greetingStartedRef.current.has(chat.playerId)) return;
      greetingStartedRef.current.add(chat.playerId);

      setNpcTyping(true);
      const started = performance.now();
      try {
        const prompt = await resolveNpcPrompt(chat.playerId);
        const response = await fetch(`${chatApiBase()}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: chat.conversationId,
            mode: 'greet',
            npcName: prompt.npcName,
            identity: prompt.identity,
            description: prompt.description,
            plan: prompt.plan,
            agentHistorySummaries: prompt.agentHistorySummaries,
            humanHistorySummaries: prompt.humanHistorySummaries,
            humanName: DEFAULT_NAME,
            history: [],
          }),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail?.error ?? `聊天服务错误 ${response.status}`);
        }
        const data = (await response.json()) as { reply: string; ms?: number };
        console.log(
          `[timing] ui.openChat.npcGreeting: ${Math.round(performance.now() - started)}ms ` +
            `(server=${data.ms ?? '?'}ms npc=${prompt.npcName})`,
        );

        // Apply to the current chat with this NPC even if conversationId was adopted.
        const current = localChatRef.current;
        if (!current || current.playerId !== chat.playerId) return;
        if (current.messages.length > 0) return;

        const replyUuid = crypto.randomUUID();
        const replyMsg: LocalChatMessage = {
          messageUuid: replyUuid,
          author: chat.playerId,
          authorName: prompt.npcName,
          text: data.reply || '……',
          _creationTime: Date.now(),
        };
        setLocalChat((prev) =>
          prev && prev.playerId === chat.playerId
            ? { ...prev, messages: [...prev.messages, replyMsg] }
            : prev,
        );

        void persistWithRetry(persistMessage, () => ({
          worldId,
          conversationId: localChatRef.current?.conversationId ?? chat.conversationId,
          author: chat.playerId,
          text: replyMsg.text,
          messageUuid: replyUuid,
        }));
      } catch (err) {
        greetingStartedRef.current.delete(chat.playerId);
        console.warn('[timing] ui.openChat.npcGreeting failed', err);
      } finally {
        setNpcTyping(false);
      }
    },
    [persistMessage, resolveNpcPrompt, worldId],
  );

  const openChat = useCallback(
    (playerId: GameId<'players'>) => {
      const existing = localChatRef.current;
      if (existing && existing.playerId === playerId) {
        console.log(`[timing] ui.openChat.reuseLocal conversationId=${existing.conversationId}`);
        prefetchPromptContext(playerId);
        // Still ensure NPC opens if this chat never got a first line.
        if (existing.messages.length === 0) {
          void requestNpcOpening(existing);
        }
        return existing;
      }

      if (promptContextRef.current?.playerId !== playerId) {
        clearPromptCache();
      }
      greetingStartedRef.current.delete(playerId);

      // Always start a fresh local conversation so NPC can speak first.
      // startChat(forceNew) ends empty/stale active rows for this NPC.
      const conversationId = newConversationId();
      const next: LocalHumanChat = {
        conversationId,
        playerId,
        humanPlayerId: HUMAN_CHAT_AUTHOR_ID,
        messages: [],
      };
      setLocalChat(next);
      prefetchPromptContext(playerId);
      console.log(
        `[timing] ui.openChat.localReady conversationId=${conversationId} target=${playerId}`,
      );

      void startChat({
        worldId,
        playerId,
        conversationId,
        forceNew: true,
      })
        .then((result) => {
          if (!result?.conversationId) return;
          setLocalChat((current) => {
            if (!current || current.playerId !== playerId) return current;
            if (current.conversationId === result.conversationId) return current;
            console.log(
              `[timing] ui.openChat.adoptServerId ${current.conversationId} -> ${result.conversationId}`,
            );
            return { ...current, conversationId: result.conversationId };
          });
        })
        .catch((err) => {
          console.warn('[timing] ui.openChat.persistStart failed', err);
        });

      // NPC speaks the first line — never auto-send a human "hi".
      void requestNpcOpening(next);

      return next;
    },
    [clearPromptCache, prefetchPromptContext, requestNpcOpening, startChat, worldId],
  );

  const endChat = useCallback(() => {
    const playerId = localChatRef.current?.playerId;
    if (playerId) {
      greetingStartedRef.current.delete(playerId);
    }
    setLocalChat(null);
    setNpcTyping(false);
    clearPromptCache();
    void endChatMutation({ worldId }).catch((err) => {
      console.warn('[timing] ui.endChat.persist failed', err);
    });
  }, [clearPromptCache, endChatMutation, worldId]);

  const sendMessage = useCallback(
    async (text: string) => {
      const chat = localChatRef.current;
      if (!chat) {
        throw new Error('没有进行中的对话');
      }
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error('消息不能为空');
      }

      const humanUuid = crypto.randomUUID();
      const humanMsg: LocalChatMessage = {
        messageUuid: humanUuid,
        author: chat.humanPlayerId,
        authorName: DEFAULT_NAME,
        text: trimmed,
        _creationTime: Date.now(),
      };
      setLocalChat((current) =>
        current ? { ...current, messages: [...current.messages, humanMsg] } : current,
      );

      const latestConversationId = () =>
        localChatRef.current?.conversationId ?? chat.conversationId;

      void persistWithRetry(persistMessage, () => ({
        worldId,
        conversationId: latestConversationId(),
        author: chat.humanPlayerId,
        text: trimmed,
        messageUuid: humanUuid,
      }));

      const history = chat.messages.map((m) => ({
        author: (m.author === chat.playerId ? 'npc' : 'human') as 'npc' | 'human',
        text: m.text,
      }));

      // Use the one-shot cache from openChat (await in-flight fetch if needed).
      // Never re-subscribe or re-query on every turn — timeouts must not crash the UI.
      const prompt = await resolveNpcPrompt(chat.playerId);
      console.log(
        `[timing] ui.sendMessage.promptContext npc=${prompt.npcName} ` +
          `agentHist=${prompt.agentHistorySummaries.length} ` +
          `humanHist=${prompt.humanHistorySummaries.length}`,
      );

      const started = performance.now();
      const response = await fetch(`${chatApiBase()}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: latestConversationId(),
          npcName: prompt.npcName,
          identity: prompt.identity,
          description: prompt.description,
          plan: prompt.plan,
          agentHistorySummaries: prompt.agentHistorySummaries,
          humanHistorySummaries: prompt.humanHistorySummaries,
          humanName: DEFAULT_NAME,
          history,
          text: trimmed,
        }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail?.error ?? `聊天服务错误 ${response.status}`);
      }
      const data = (await response.json()) as { reply: string; ms?: number };
      const chatServerMs = Math.round(performance.now() - started);
      console.log(
        `[timing] ui.sendMessage.chatServer: ${chatServerMs}ms ` +
          `(server=${data.ms ?? '?'}ms)`,
      );
      reportMetric('ui.sendMessage.chatServer', chatServerMs, {
        serverMs: data.ms ?? null,
        npc: prompt.npcName,
      });

      const replyUuid = crypto.randomUUID();
      const replyMsg: LocalChatMessage = {
        messageUuid: replyUuid,
        author: chat.playerId,
        authorName: prompt.npcName,
        text: data.reply || '……',
        _creationTime: Date.now(),
      };
      setLocalChat((current) =>
        current ? { ...current, messages: [...current.messages, replyMsg] } : current,
      );

      void persistWithRetry(persistMessage, () => ({
        worldId,
        conversationId: latestConversationId(),
        author: chat.playerId,
        text: replyMsg.text,
        messageUuid: replyUuid,
      }));

      return replyMsg;
    },
    [persistMessage, resolveNpcPrompt, worldId],
  );

  const active = useMemo(() => localChat, [localChat]);

  return {
    active,
    openChat,
    endChat,
    sendMessage,
    npcTyping,
  };
}
