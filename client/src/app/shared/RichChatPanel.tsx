import { Chat } from '@hashbrownai/core';
import { useRuntime, useToolJavaScript, useUiChat } from '@hashbrownai/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_MODEL } from '../chat/chat-config';
import { useChatSessionId } from '../chat/ChatSessionProvider';
import { ContextMeter } from '../chat/ContextMeter';
import { composePrompt, type PromptSection } from '../chat/prompt-sections';
import { useSmartHomeChatArea } from '../chat/smart-home/useSmartHomeChatArea';
import { useCoreChatArea } from '../chat/useCoreChatArea';
import { useGameAuthoringChatArea } from '../chat/game-authoring/useGameAuthoringChatArea';
import { useLibraryChatArea } from '../chat/library/useLibraryChatArea';
import { useChatContextUsage } from '../chat/useChatContextUsage';
import { useDomChatArea } from '../chat/useDomChatArea';
import { Button } from './button';
import { RichMessage } from './RichMessage';
import { ScrollArea } from './scrollarea';
import { Textarea } from './textarea';

export const RichChatPanel = () => {
  // What the user typed, for tools that keep the pasted text (proposeGame).
  const userTextsRef = useRef<string[]>([]);

  // Each area adds its tools, components and prompt section, in this order.
  const areas = [
    useCoreChatArea(),
    useGameAuthoringChatArea(() => userTextsRef.current),
    useLibraryChatArea(() => userTextsRef.current),
    useSmartHomeChatArea(),
    useDomChatArea(),
  ];

  const runtime = useRuntime({
    functions: areas.flatMap((area) => area.runtimeFunctions ?? []),
  });
  const toolJavaScript = useToolJavaScript({
    runtime,
  });

  const {
    messages,
    sendMessage,
    resendMessages,
    isSending,
    isReceiving,
    isRunningToolCalls,
    stop,
  } = useUiChat({
    model: CHAT_MODEL,
    debugName: 'RichChatPanel',
    system: composePrompt(areas.flatMap((area): PromptSection[] => (area.prompt ? [area.prompt] : []))),
    tools: [...areas.flatMap((area) => area.tools ?? []), toolJavaScript],
    components: areas.flatMap((area) => area.components ?? []),
  });

  userTextsRef.current = messages.flatMap((message) =>
    message.role === 'user' && typeof message.content === 'string' ? [message.content] : [],
  );

  const isWorking = useMemo(() => {
    return isSending || isReceiving || isRunningToolCalls;
  }, [isSending, isReceiving, isRunningToolCalls]);

  const contextReading = useChatContextUsage(useChatSessionId(), isWorking);

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Add state for the textarea input
  const [inputValue, setInputValue] = useState('');

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]',
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  // useEffect(() => {
  //   console.log(messages);
  // }, [messages]);

  const onSubmit = useCallback(() => {
    // Only submit if there's text
    if (!inputValue.trim()) return;

    // Add the user message to the messages list
    const newUserMessage: Chat.UserMessage = {
      role: 'user',
      content: inputValue,
    };

    setInputValue('');

    sendMessage(newUserMessage);
  }, [inputValue, sendMessage, setInputValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Enter (but not on Shift+Enter)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent default behavior (new line)
        onSubmit();
      }
    },
    [onSubmit],
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
    },
    [],
  );

  const onRetry = useCallback(() => {
    resendMessages();
  }, [resendMessages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-col lg:flex-1">
        <ScrollArea className="max-h-48 lg:flex-1" ref={scrollAreaRef}>
          <div className="flex flex-col gap-2 px-2">
            {messages.map((message, index, array) => (
              <RichMessage
                key={index}
                message={message}
                onRetry={onRetry}
                isLast={index === array.length - 1}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
      <div className="flex flex-col text-sm text-foreground/50 gap-2 h-6 justify-end px-2">
        {isWorking && <p>Thinking...</p>}
      </div>
      <div className="flex flex-col gap-2 border-border px-2 max-lg:border-t max-lg:pt-2">
        <Textarea
          value={inputValue}
          onChange={onInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
        />
        {!isWorking ? (
          <Button onClick={onSubmit}>Send</Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              stop();
            }}
          >
            Stop
          </Button>
        )}
        <ContextMeter reading={contextReading} />
      </div>
    </div>
  );
};
