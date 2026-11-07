import type { LearningTag } from './learning-object';

/**
 * Evidence about one learning object from one response
 * (docs/xAPI/learning-objects.md → Scoring and attribution). Each becomes an
 * `assessed` statement, and the Leitner fold reads only those (A2).
 */
export type Observation = {
  learningObjectId: string;
  aspect: string;
  success: boolean;
  /** The thing asked for, or a component of it. */
  role: 'whole' | 'part';
  /** direct: the item asked for this; indirect: inferred as a part. */
  strength: 'direct' | 'indirect';
};

/**
 * Multiple choice with one tagged learning object and no option diagnosis:
 * the answer is direct evidence about the whole, and nothing else. Bump the
 * version whenever the observations it gives for the same input change.
 */
export const CHOICE_WHOLE_SCORER = 'choice-whole@1';

export function scoreChoiceWhole(learning: LearningTag, success: boolean): Observation[] {
  return [{ learningObjectId: learning.learningObjectId, aspect: learning.aspect, success, role: 'whole', strength: 'direct' }];
}
