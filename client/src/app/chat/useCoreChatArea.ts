import { s } from '@hashbrownai/core';
import { exposeComponent } from '@hashbrownai/react';
import { CardComponent } from '../shared/CardComponent';
import { MarkdownComponent } from '../shared/MarkdownComponent';
import type { ChatArea } from './chat-area';
import { section } from './prompt-sections';

/** Who the assistant is, and the components every area can render. */
export function useCoreChatArea(): ChatArea {
  return {
    components: [
      exposeComponent(MarkdownComponent, {
        name: 'Markdown',
        description: 'Show markdown content to the user',
        children: 'text',
      }),
      exposeComponent(CardComponent, {
        name: 'Card',
        description: 'Show a card with children components to the user',
        children: 'any',
        props: {
          title: s.string('The title of the card'),
          description: s.streaming.string('The description of the card'),
        },
      }),
    ],
    prompt: section`
      You are the assistant for the Emoji app: badge games, language learning
      (YALLA) and a smart-home demo. Each section below covers one part of the app.
      You should not stringify (aka escape) function arguments.

      ### IMPORTANT: Use Tools for Actions
      When the user asks you to perform an action (delete, update, control), **always use the appropriate tool** to perform the action directly. Never show buttons for actions you can perform with tools.
    `,
  };
}
