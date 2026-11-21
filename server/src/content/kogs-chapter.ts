import { z } from 'zod';

/**
 * The `kogs.chapter.v1` shape (docs/hashbrown/creating-games-with-hashbrown.md,
 * G5): what the built-in `chapterNNData.json` files hold, and what a user
 * book's published chapter stores. One schema for both, so YALLA, the sense
 * registry and publishing read chapters the same way. Text has stray
 * whitespace collapsed; fields the app doesn't use (`index`,
 * `categoryMappingId`, …) are dropped.
 */

const text = z.string().transform((value) => value.replace(/\s+/g, ' ').trim());
const requiredText = text.pipe(z.string().min(1));
const optionalText = text.optional().default('');

export const kogsDialogLineSchema = z.object({
  speakerNameTarget: optionalText,
  speakerNameNative: optionalText,
  speechTarget: text,
  speechNative: optionalText,
});

export const kogsVocabularyEntrySchema = z.object({
  /** The entry's stable number: `sourceRef` is `chNN/vocabulary/{id}` (G8). Missing: its index. */
  id: z.number().int().optional(),
  targetLanguageText: requiredText,
  nativeLanguageText: requiredText,
});

export const kogsPatternSchema = z.object({
  patternTarget: text,
  patternNative: optionalText,
  type: text.optional(),
  exampleSentenceNativeTitle: optionalText,
  exampleSentenceTarget: optionalText,
  exampleSentenceNative: optionalText,
  sampleSentences: z.array(z.object({ targetText: text, nativeText: optionalText })).default([]),
  exercises: z.array(z.object({ exercise: text, answerKey: optionalText })).default([]),
  appliedPatterns: z
    .array(
      z.object({
        pattern: optionalText,
        patternTargetText: text,
        patternNativeText: optionalText,
        patternNote: text.optional(),
      }),
    )
    .default([]),
});

export const kogsChapterV1Schema = z.object({
  chapter: z.union([z.string(), z.number()]).transform(String),
  titleTarget: optionalText,
  titleNative: optionalText,
  dialog: z.array(kogsDialogLineSchema).default([]),
  vocabulary: z.array(kogsVocabularyEntrySchema),
  patterns: z.array(kogsPatternSchema).default([]),
});

export type KogsChapterV1 = z.infer<typeof kogsChapterV1Schema>;
export type KogsDialogLine = z.infer<typeof kogsDialogLineSchema>;
export type KogsPattern = z.infer<typeof kogsPatternSchema>;
