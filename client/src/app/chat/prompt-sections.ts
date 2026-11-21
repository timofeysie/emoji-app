import { prompt, type SystemPrompt } from '@hashbrownai/core';

/**
 * One area's part of the system prompt. Kept as template parts rather than a
 * string, so `${…}` values (e.g. arrays in `<ui>` examples) reach `prompt`
 * as real values.
 */
export type PromptSection = {
  strings: readonly string[];
  exprs: readonly unknown[];
};

/** Tag for a prompt section: section`### Lights … ${ids}`. */
export function section(strings: TemplateStringsArray, ...exprs: unknown[]): PromptSection {
  return { strings: [...strings], exprs };
}

/** Joins sections, in order, into one `prompt` call. */
export function composePrompt(sections: readonly PromptSection[]): SystemPrompt {
  const strings: string[] = [];
  const exprs: unknown[] = [];
  for (const part of sections) {
    if (strings.length === 0) {
      strings.push(...part.strings);
    } else {
      strings[strings.length - 1] += `\n${part.strings[0]}`;
      strings.push(...part.strings.slice(1));
    }
    exprs.push(...part.exprs);
  }
  return prompt(Object.assign([...strings], { raw: [...strings] }), ...exprs);
}
