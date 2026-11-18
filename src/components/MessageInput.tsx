import clsx from 'clsx';
import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { DEFAULT_NAME } from '../../convex/constants';

export function MessageInput({
  humanName,
  disabled,
  autoFocus = false,
  onSend,
}: {
  humanName?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onSend: (text: string) => Promise<unknown>;
}) {
  const resolvedName = humanName ?? DEFAULT_NAME;
  const inputRef = useRef<HTMLParagraphElement>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!autoFocus || disabled || sending) {
      return;
    }
    const el = inputRef.current;
    if (!el) {
      return;
    }
    // Defer until after layout so focus sticks when the chat panel mounts.
    const id = requestAnimationFrame(() => {
      el.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus, disabled, sending]);

  const onKeyDown = async (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key !== 'Enter') {
      return;
    }
    e.preventDefault();
    if (!inputRef.current || sending || disabled) {
      return;
    }
    const text = inputRef.current.innerText.trim();
    inputRef.current.innerText = '';
    if (!text) {
      return;
    }
    setSending(true);
    const started = performance.now();
    try {
      await onSend(text);
      console.log(
        `[timing] ui.sendMessage.total: ${Math.round(performance.now() - started)}ms`,
      );
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } catch (err: any) {
      console.log(
        `[timing] ui.sendMessage.failed: ${Math.round(performance.now() - started)}ms`,
      );
      toast.error(err?.message ?? '发送失败');
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="leading-tight">
      <div className="flex gap-4">
        <span className="uppercase flex-grow">{resolvedName}</span>
        {sending && <span className="text-brown-700">发送中…</span>}
      </div>
      <div className={clsx('bubble', 'bubble-mine')}>
        <p
          className="bg-white -mx-3 -my-1"
          ref={inputRef}
          contentEditable={!sending && !disabled}
          style={{ outline: 'none' }}
          tabIndex={0}
          placeholder="输入消息，按 Enter 发送"
          onKeyDown={(e) => void onKeyDown(e)}
        />
      </div>
    </div>
  );
}
