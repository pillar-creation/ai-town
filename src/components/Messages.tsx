import clsx from 'clsx';
import { MessageInput } from './MessageInput';
import { useEffect, useRef } from 'react';
import { LocalChatMessage } from '../hooks/useHumanChatSession';

export function Messages({
  humanPlayerId,
  humanName,
  npcTypingName,
  isTyping,
  canSend,
  messages,
  onSend,
}: {
  humanPlayerId: string;
  humanName?: string;
  npcTypingName?: string;
  isTyping?: boolean;
  canSend: boolean;
  messages: LocalChatMessage[];
  onSend: (text: string) => Promise<unknown>;
}) {
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottom = useRef(true);

  useEffect(() => {
    const scrollView = messagesScrollRef.current;
    if (!scrollView) return undefined;

    const onScroll = () => {
      isScrolledToBottom.current = !!(
        scrollView && scrollView.scrollHeight - scrollView.scrollTop - 50 <= scrollView.clientHeight
      );
    };
    scrollView.addEventListener('scroll', onScroll);
    return () => scrollView.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (isScrolledToBottom.current) {
      messagesScrollRef.current?.scrollTo({
        top: messagesScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, isTyping]);

  return (
    <div className="chats text-base sm:text-sm flex flex-col flex-1 min-h-0">
      <div
        ref={messagesScrollRef}
        className="bg-brown-200 text-black p-2 flex-1 min-h-0 overflow-y-auto"
      >
        {messages.length === 0 && !isTyping && (
          <div className="leading-tight mb-6">
            <p className="text-brown-700 text-center">对话已开启，对方马上开口…</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={`text-${m.messageUuid}`} className="leading-tight mb-6">
            <div className="flex gap-4">
              <span className="uppercase flex-grow">{m.authorName}</span>
              <time dateTime={m._creationTime.toString()}>
                {new Date(m._creationTime).toLocaleString()}
              </time>
            </div>
            <div className={clsx('bubble', m.author === humanPlayerId && 'bubble-mine')}>
              <p className="bg-white -mx-3 -my-1">{m.text}</p>
            </div>
          </div>
        ))}
        {isTyping && (
          <div key="typing" className="leading-tight mb-6">
            <div className="flex gap-4">
              <span className="uppercase flex-grow">{npcTypingName ?? '…'}</span>
            </div>
            <div className={clsx('bubble')}>
              <p className="bg-white -mx-3 -my-1">
                <i>typing...</i>
              </p>
            </div>
          </div>
        )}
      </div>
      {canSend && (
        <div className="bg-brown-200 text-black px-2 pb-2 shrink-0 border-t border-brown-700/20">
          <MessageInput humanName={humanName} onSend={onSend} autoFocus />
        </div>
      )}
    </div>
  );
}
