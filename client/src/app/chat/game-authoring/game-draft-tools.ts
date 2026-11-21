import type { DraftQuestion, GameDraftContent } from '../../game-authoring/drafts-api';
import { GAME_LIMITS } from '../../game-authoring/game-limits';
import { findMix, questionFocusValues, scaleMix, type MixCounts } from '../../game-authoring/question-mixes';

export type PassageMatch =
  | { ok: true; text: string }
  | { ok: false; reason: string };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The pasted passage, found in the user's messages from where `start` begins
 * (G13: the source is always kept). The model only copies the first words,
 * so the passage isn't sent back through the tool call. Newest message first;
 * whitespace may differ.
 */
export function findPassage(start: string, userTexts: readonly string[]): PassageMatch {
  const words = start.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { ok: false, reason: 'passageStart was empty' };
  }
  const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'));
  for (const text of [...userTexts].reverse()) {
    const at = text.search(pattern);
    if (at < 0) continue;
    const passage = text.slice(at).trim();
    if (passage.length > GAME_LIMITS.maxSourceLength) {
      return {
        ok: false,
        reason: `the passage is ${passage.length.toLocaleString()} characters, over the ${GAME_LIMITS.maxSourceLength.toLocaleString()} that can be kept`,
      };
    }
    return { ok: true, text: passage };
  }
  return { ok: false, reason: `no message of the user's starts a passage with "${start.trim().slice(0, 40)}"` };
}

/**
 * How the questions miss their preset, as the exact replacements for the
 * model to make, or null. Models often read "a comprehension game" as all
 * comprehension, and the prompt alone doesn't stop it. `custom` isn't checked.
 */
export function mixMismatch(mix: string, questions: readonly DraftQuestion[]): string | null {
  const preset = findMix(mix);
  if (!preset || questions.length === 0) return null;
  const want = scaleMix(preset.counts, questions.length);
  const have: MixCounts = { comprehension: 0, vocabulary: 0, grammar: 0 };
  for (const question of questions) have[question.focus ?? 'vocabulary'] += 1;
  if (questionFocusValues.every((focus) => have[focus] === want[focus])) return null;
  const list = (counts: MixCounts) => questionFocusValues.map((focus) => `${counts[focus]} ${focus}`).join(', ');
  // The last questions of each kind there are too many of, to become the kinds there are too few of.
  const spare: number[] = [];
  for (const focus of questionFocusValues) {
    const numbers = questions.flatMap((question, i) => ((question.focus ?? 'vocabulary') === focus ? [i + 1] : []));
    spare.push(...numbers.slice(want[focus]));
  }
  spare.sort((a, b) => a - b);
  const needed = questionFocusValues.flatMap((focus) => Array<string>(Math.max(0, want[focus] - have[focus])).fill(focus));
  const plan = spare.map((number, i) => `question ${number} with a ${needed[i]} question`).join(', ');
  return (
    `Not finished: the ${preset.id} mix for ${questions.length} questions is ${list(want)}, but the draft has ${list(have)}. ` +
    `Call reviseGameDraft now to replace ${plan}. Don't show the draft until you have.`
  );
}

export type DraftRevision = {
  title: string;
  replace: Array<{ number: number; question: DraftQuestion }>;
  remove: number[];
  add: DraftQuestion[];
};

/**
 * Applies a `reviseGameDraft` call: replacements and removals by the numbers
 * the questions have now (1-based), then additions at the end. Throws a
 * message the model can act on when a number doesn't exist.
 */
export function applyRevision(content: GameDraftContent, revision: DraftRevision): GameDraftContent {
  const count = content.questions.length;
  const bad = [...revision.replace.map((change) => change.number), ...revision.remove].filter(
    (number) => !Number.isInteger(number) || number < 1 || number > count,
  );
  if (bad.length > 0) {
    throw new Error(
      `The draft has questions 1–${count}; there is no question ${bad.join(', ')}. Call getGameDraft to see the questions now.`,
    );
  }
  const questions: Array<DraftQuestion | null> = [...content.questions];
  for (const { number, question } of revision.replace) {
    questions[number - 1] = question;
  }
  for (const number of revision.remove) {
    questions[number - 1] = null;
  }
  const kept = questions.filter((question): question is DraftQuestion => question !== null);
  const next = [...kept, ...revision.add];
  if (next.length > GAME_LIMITS.maxQuestions) {
    throw new Error(`A game can have at most ${GAME_LIMITS.maxQuestions} questions; this would make ${next.length}.`);
  }
  return {
    ...content,
    title: revision.title.trim() ? revision.title.trim() : content.title,
    questions: next,
  };
}
