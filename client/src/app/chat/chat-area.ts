import type { Chat, RuntimeFunctionRef } from '@hashbrownai/core';
import type { ExposedComponent } from '@hashbrownai/react';
import type { PromptSection } from './prompt-sections';

/**
 * What one part of the app gives the chat (docs/hashbrown/creating-games-with-hashbrown.md
 * → Chat panel changes). `RichChatPanel` combines the areas, in order.
 */
export type ChatArea = {
  tools?: Chat.AnyTool[];
  /** Functions for the javascript tool's runtime. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as useRuntime's `functions`
  runtimeFunctions?: RuntimeFunctionRef<any, any>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as useUiChat's `components`
  components?: ExposedComponent<any>[];
  prompt?: PromptSection;
};
