import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import { SelectElement } from './Player';
import { Messages } from './Messages';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';
import { Player } from '../../convex/aiTown/player';
import { toast } from 'react-toastify';
import { DEFAULT_NAME } from '../../convex/constants';
import { useHumanChatSession } from '../hooks/useHumanChatSession';

type PlayerPanel = 'plan' | 'history' | 'chat';

const ACTIVITY_LABELS: Record<string, string> = {
  'reading a book': '读书',
  daydreaming: '发呆',
  gardening: '园艺',
};

const OPERATION_LABELS: Record<string, string> = {
  agentDoSomething: '正在思考接下来做什么',
  agentGenerateMessage: '正在组织接下来要说的话',
  agentRememberConversation: '正在回忆刚才的对话',
};

const MEMORY_TYPE_LABELS: Record<string, string> = {
  conversation: '对话回忆',
  reflection: '自我反思',
  relationship: '关系印象',
};

function describeActivity(description: string, emoji?: string) {
  const label = ACTIVITY_LABELS[description] ?? description;
  return emoji ? `${emoji} ${label}` : label;
}

function upcomingPlan(args: {
  player: Player;
  isMe: boolean;
  game: ServerGame;
  agent?: { inProgressOperation?: { name: string } };
  agentPlan?: string;
}) {
  const { player, isMe, game, agent, agentPlan } = args;
  const items: string[] = [];
  const conversation = game.world.playerConversation(player);

  if (agentPlan) {
    items.push(`长期目标：${agentPlan}`);
  }
  if (agent?.inProgressOperation) {
    items.push(
      OPERATION_LABELS[agent.inProgressOperation.name] ??
        `接下来：${agent.inProgressOperation.name}`,
    );
  }
  if (player.activity && player.activity.until > Date.now()) {
    items.push(`当前：${describeActivity(player.activity.description, player.activity.emoji)}`);
  }
  if (conversation) {
    const otherIds = [...conversation.participants.keys()].filter((id) => id !== player.id);
    const names = otherIds.map((id) => game.playerDescriptions.get(id)?.name ?? '某人');
    const status = conversation.participants.get(player.id)?.status.kind;
    if (status === 'invited') {
      items.push(`接下来：考虑是否接受 ${names.join('、')} 的对话邀请`);
    } else if (status === 'walkingOver') {
      items.push(`接下来：走向 ${names.join('、')}，准备开始对话`);
    } else {
      items.push(`接下来：继续和 ${names.join('、')} 聊天`);
    }
  } else if (player.pathfinding) {
    const dest = player.pathfinding.destination;
    items.push(`接下来：前往 (${Math.floor(dest.x)}, ${Math.floor(dest.y)})`);
  }
  if (items.length === 0) {
    items.push(isMe ? '接下来：在镇子里自由行动，或找人聊天' : '接下来：在镇子里闲逛，寻找下一个目标');
  }
  return items;
}

export default function PlayerDetails({
  worldId,
  engineId,
  game,
  playerId: selectedPlayerId,
  setSelectedElement,
  scrollViewRef,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  playerId?: GameId<'players'>;
  setSelectedElement: SelectElement;
  scrollViewRef: React.RefObject<HTMLDivElement>;
}) {
  // Auth disabled: same constant as world.userStatus, without a timeout-prone query.
  const players = [...game.world.players.values()];
  const humanPlayer = players.find((p) => p.human === DEFAULT_NAME);

  const [panel, setPanel] = useState<PlayerPanel | null>(null);

  const firstPlayerId = players[0]?.id;
  const detailsPlayerId = selectedPlayerId ?? humanPlayer?.id ?? firstPlayerId;
  const protagonist = detailsPlayerId ? game.world.players.get(detailsPlayerId) : undefined;
  const protagonistId = protagonist?.id;
  const playerId = detailsPlayerId;

  const player = playerId && game.world.players.get(playerId);
  const playerConversation = player && game.world.playerConversation(player);
  const protagonistConversation = protagonist && game.world.playerConversation(protagonist);

  const {
    active: localHumanChat,
    openChat,
    endChat,
    sendMessage,
    npcTyping,
  } = useHumanChatSession({ worldId, game });

  const actionHistory = useQuery(
    api.world.playerActionHistory,
    panel === 'history' && protagonistId ? { worldId, playerId: protagonistId } : 'skip',
  );
  const conversationHistory = useQuery(
    api.world.playerConversationHistory,
    panel === 'history' && protagonistId ? { worldId, playerId: protagonistId } : 'skip',
  );
  const activeHistoryMessages = useQuery(
    api.messages.listMessages,
    panel === 'history' && protagonistConversation
      ? { worldId, conversationId: protagonistConversation.id }
      : 'skip',
  );

  const playerDescription = playerId && game.playerDescriptions.get(playerId);
  const protagonistDescription = protagonistId && game.playerDescriptions.get(protagonistId);
  const protagonistAgent = protagonistId
    ? [...game.world.agents.values()].find((a) => a.playerId === protagonistId)
    : undefined;
  const protagonistAgentDescription =
    protagonistAgent && game.agentDescriptions.get(protagonistAgent.id);

  // Keep the active tab when switching agents. If already on chat, switch
  // the conversation to the newly selected agent instead of leaving the tab.
  useEffect(() => {
    if (panel !== 'chat' || !selectedPlayerId) {
      return;
    }
    const targetPlayer = game.world.players.get(selectedPlayerId);
    if (!targetPlayer || targetPlayer.human) {
      return;
    }
    if (localHumanChat?.playerId === selectedPlayerId) {
      return;
    }
    openChat(selectedPlayerId);
  }, [selectedPlayerId, panel, game.world.players, localHumanChat?.playerId, openChat]);

  const historyByAgent = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        names: string;
        conversations: NonNullable<typeof conversationHistory>;
      }
    >();
    for (const conversation of conversationHistory ?? []) {
      const key =
        conversation.others
          .map((other) => other.playerId)
          .sort()
          .join(',') || 'unknown';
      const names = conversation.others.map((other) => other.name).join('、') || '其他人';
      const existing = groups.get(key);
      if (existing) {
        existing.conversations.push(conversation);
      } else {
        groups.set(key, { key, names, conversations: [conversation] });
      }
    }
    return [...groups.values()];
  }, [conversationHistory]);

  if (!playerId || !player || !protagonist || !protagonistId) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        点击地图上的角色，查看计划、历史回顾和聊天。
      </div>
    );
  }
  const isMe = humanPlayer && player.id === humanPlayer.id;
  const isProtagonistMe = !!(humanPlayer && protagonist.id === humanPlayer.id);
  const chattingWithSelected =
    !!(localHumanChat && playerId && localHumanChat.playerId === playerId);
  const showingChatMessages = panel === 'chat' && chattingWithSelected;

  const onLeaveConversation = () => {
    try {
      endChat();
    } catch (e: any) {
      toast.error(e?.message ?? '结束对话失败');
    }
  };

  const planItems = upcomingPlan({
    player: protagonist,
    isMe: isProtagonistMe,
    game,
    agent: protagonistAgent,
    agentPlan: protagonistAgentDescription?.plan,
  });

  const openPanel = (next: PlayerPanel) => {
    setPanel(next);
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ top: 0 });
    });
  };

  const onOpenChat = () => {
    const clickAt = performance.now();
    openPanel('chat');
    const chatTargetId = selectedPlayerId ?? protagonistId;
    if (!chatTargetId) {
      toast.error('请先点击地图上的角色');
      return;
    }
    const targetPlayer = game.world.players.get(chatTargetId);
    if (!targetPlayer) {
      toast.error('找不到要聊天的角色');
      return;
    }
    if (targetPlayer.human) {
      toast.error('不能和真人角色聊天');
      return;
    }
    openChat(chatTargetId);
    console.log(
      `[timing] ui.openChat.instant: ${Math.round(performance.now() - clickAt)}ms target=${chatTargetId}`,
    );
  };

  const panelButtonClass = (active: boolean) =>
    'button flex-1 min-w-0 text-white shadow-solid text-sm sm:text-base cursor-pointer pointer-events-auto' +
    (active ? ' button-selected' : '');

  const activeOtherNames = protagonistConversation
    ? [...protagonistConversation.participants.keys()]
        .filter((id) => id !== protagonist.id)
        .map((id) => game.playerDescriptions.get(id)?.name ?? '某人')
        .join('、')
    : '';

  const protagonistName = protagonistDescription?.name ?? '主角';
  const hasActionHistory = !!(actionHistory && actionHistory.actions.length > 0);
  const hasConversationHistory =
    (conversationHistory && conversationHistory.length > 0) ||
    (activeHistoryMessages && activeHistoryMessages.length > 0);
  const historyLoading = actionHistory === undefined && conversationHistory === undefined;
  const historyEmpty =
    actionHistory !== undefined &&
    conversationHistory !== undefined &&
    !hasActionHistory &&
    !hasConversationHistory;

  return (
    <div className="details-panel">
      <div className="flex gap-4 shrink-0">
        <div className="box w-3/4 sm:w-full mr-auto">
          <h2 className="bg-brown-700 p-2 font-display text-2xl sm:text-4xl tracking-wider shadow-solid text-center">
            {panel === 'plan'
              ? '主角计划'
              : panel === 'history'
                ? protagonistName
                : playerDescription?.name}
          </h2>
        </div>
        <a
          className="button text-white shadow-solid text-2xl cursor-pointer pointer-events-auto"
          onClick={() => {
            setPanel(null);
            setSelectedElement(undefined);
          }}
        >
          <h2 className="h-full bg-clay-700">
            <img className="w-4 h-4 sm:w-5 sm:h-5" src={closeImg} />
          </h2>
        </a>
      </div>
      <div
        className={
          panel === 'chat' && showingChatMessages
            ? 'details-panel-body details-panel-body-chat'
            : 'details-panel-body'
        }
        ref={scrollViewRef}
      >
        {localHumanChat && panel === 'chat' && chattingWithSelected && (
          <a
            className="mb-4 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto shrink-0"
            onClick={() => {
              onLeaveConversation();
            }}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>结束对话</span>
            </div>
          </a>
        )}
        {panel === null && (
          <>
            {!playerConversation && player.activity && player.activity.until > Date.now() && (
              <div className="box mb-4">
                <h2 className="bg-brown-700 text-base sm:text-lg text-center">
                  {describeActivity(player.activity.description, player.activity.emoji)}
                </h2>
              </div>
            )}
            <div className="desc">
              <p className="leading-tight -m-4 bg-brown-700 text-base sm:text-sm">
                {!isMe && playerDescription?.description}
                {isMe && <i>This is you!</i>}
                {!isMe && chattingWithSelected && (
                  <>
                    <br />
                    <br />
                    <i>正在和你聊天</i>
                  </>
                )}
              </p>
            </div>
          </>
        )}
        {panel === 'plan' && (
          <div className="box min-h-[12rem]">
            <h2 className="bg-brown-700 text-base sm:text-lg text-center">主角计划</h2>
            <div className="bg-brown-200 text-black p-3 text-base sm:text-sm leading-tight">
              <p className="mb-3 font-bold tracking-wide">
                {protagonistName}接下来的计划
              </p>
              <ol className="list-decimal pl-5 space-y-3">
                {planItems.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ol>
            </div>
          </div>
        )}
        {panel === 'history' && historyLoading && (
          <div className="box">
            <h2 className="bg-brown-700 text-base sm:text-lg text-center">加载历史回顾…</h2>
          </div>
        )}
        {panel === 'history' && !historyLoading && (
          <div className="chats text-base sm:text-sm space-y-4">
            {actionHistory && (
              <div className="space-y-3">
                <div className="box">
                  <h2 className="bg-brown-700 text-base sm:text-lg text-center">
                    {protagonistName} 的动作回顾
                  </h2>
                </div>
                {(protagonistAgentDescription || protagonistAgent?.inProgressOperation) && (
                  <div className="bg-brown-200 text-black p-3 leading-tight space-y-2">
                    <p>
                      <span className="font-bold">Agent 身份：</span>
                      {protagonistAgentDescription?.identity || '尚未设定'}
                    </p>
                    <p>
                      <span className="font-bold">当前计划：</span>
                      {protagonistAgentDescription?.plan || '暂无长期目标'}
                    </p>
                    {protagonistAgent?.inProgressOperation && (
                      <p>
                        <span className="font-bold">正在执行：</span>
                        {OPERATION_LABELS[protagonistAgent.inProgressOperation.name] ??
                          protagonistAgent.inProgressOperation.name}
                      </p>
                    )}
                  </div>
                )}
                {hasActionHistory ? (
                  actionHistory.actions.map((action) => (
                    <div key={action._id} className="bg-brown-200 text-black p-3 leading-tight">
                      <div className="flex gap-4 mb-2 uppercase text-xs sm:text-sm">
                        <span className="flex-grow">
                          {MEMORY_TYPE_LABELS[action.type] ?? action.typeLabel}
                          {action.importance >= 7 ? ' · 重要' : ''}
                        </span>
                        <time dateTime={new Date(action.created).toISOString()}>
                          {new Date(action.created).toLocaleString()}
                        </time>
                      </div>
                      <p>{action.description}</p>
                    </div>
                  ))
                ) : conversationHistory !== undefined && hasConversationHistory ? (
                  <div className="bg-brown-200 text-black p-3 text-center">
                    暂无记忆流记录，对话结束后 Agent 会自动写入回顾
                  </div>
                ) : null}
              </div>
            )}
            {actionHistory === undefined && (
              <div className="box">
                <h2 className="bg-brown-700 text-base sm:text-lg text-center">加载动作回顾…</h2>
              </div>
            )}
            {activeHistoryMessages && activeHistoryMessages.length > 0 && (
              <div className="bg-brown-200 text-black p-2">
                <div className="flex gap-4 mb-4 uppercase">
                  <span className="flex-grow">
                    {protagonistName} 正在与 {activeOtherNames || '其他人'} 聊天
                  </span>
                  <span>进行中</span>
                </div>
                {activeHistoryMessages.map((m) => (
                  <div key={m._id} className="leading-tight mb-6">
                    <div className="flex gap-4">
                      <span className="uppercase flex-grow">{m.authorName}</span>
                      <time dateTime={m._creationTime.toString()}>
                        {new Date(m._creationTime).toLocaleString()}
                      </time>
                    </div>
                    <div className={clsx('bubble', m.author === protagonistId && 'bubble-mine')}>
                      <p className="bg-white -mx-3 -my-1">{m.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {conversationHistory === undefined && (
              <div className="box">
                <h2 className="bg-brown-700 text-base sm:text-lg text-center">加载历史对话…</h2>
              </div>
            )}
            {historyByAgent.map((group) => (
              <div key={group.key} className="space-y-3">
                <div className="box">
                  <h2 className="bg-brown-700 text-base sm:text-lg text-center">
                    {protagonistName} 与 {group.names} 的历史聊天
                  </h2>
                </div>
                {group.conversations.map((conversation) => (
                  <div key={conversation.conversationId} className="bg-brown-200 text-black p-2">
                    <div className="flex gap-4 mb-4 uppercase">
                      <span className="flex-grow">对话记录</span>
                      <time dateTime={new Date(conversation.created).toISOString()}>
                        {new Date(conversation.created).toLocaleString()}
                      </time>
                    </div>
                    {conversation.messages.length === 0 && (
                      <p className="text-brown-700 text-center">这次对话没有留下消息</p>
                    )}
                    {conversation.messages.map((m) => (
                      <div key={m._id} className="leading-tight mb-6">
                        <div className="flex gap-4">
                          <span className="uppercase flex-grow">{m.authorName}</span>
                          <time dateTime={m._creationTime.toString()}>
                            {new Date(m._creationTime).toLocaleString()}
                          </time>
                        </div>
                        <div
                          className={clsx('bubble', m.author === protagonistId && 'bubble-mine')}
                        >
                          <p className="bg-white -mx-3 -my-1">{m.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            {historyEmpty && (
              <div className="bg-brown-200 text-black p-3 text-center">
                {protagonistName} 还没有留下动作或对话回顾
              </div>
            )}
          </div>
        )}
        {panel === 'chat' && showingChatMessages && localHumanChat && (
          <Messages
            humanPlayerId={localHumanChat.humanPlayerId}
            humanName={DEFAULT_NAME}
            npcTypingName={playerDescription?.name}
            isTyping={npcTyping}
            canSend={!npcTyping}
            messages={localHumanChat.messages}
            onSend={sendMessage}
          />
        )}
        {panel === 'chat' && !showingChatMessages && (
          <div className="box">
            <h2 className="bg-brown-700 text-base sm:text-lg text-center">
              {isMe ? '不能和自己聊天' : '选择角色后点击「聊天」开始对话'}
            </h2>
          </div>
        )}
      </div>
      <div className="relative z-20 flex flex-row items-stretch gap-2 mt-4 shrink-0">
        <button
          type="button"
          className={panelButtonClass(panel === 'plan')}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openPanel('plan');
          }}
        >
          <div className="h-full bg-clay-700 text-center whitespace-nowrap">
            <span>主角计划</span>
          </div>
        </button>
        <button
          type="button"
          className={panelButtonClass(panel === 'history')}
          onClick={() => openPanel('history')}
        >
          <div className="h-full bg-clay-700 text-center whitespace-nowrap">
            <span>历史回顾</span>
          </div>
        </button>
        <button
          type="button"
          className={panelButtonClass(panel === 'chat')}
          onClick={() => {
            onOpenChat();
          }}
        >
          <div className="h-full bg-clay-700 text-center whitespace-nowrap">
            <span>聊天</span>
          </div>
        </button>
      </div>
    </div>
  );
}
