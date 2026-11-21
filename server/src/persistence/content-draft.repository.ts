import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { DraftProblem, DraftSettings } from '../content/game-draft';
import { ContentDraftStatus, ContentDraftType } from './domain-types';
import { MongoService } from './mongo.service';
import { asObjectId } from './models';

export type LanguagePair = { target: string; native: string };

/** A chapter of a book, with its revision when copied or opened for editing. */
export type ChapterRefRecord = { book: string; chapter: string; revision: number | null };

export type ContentSourceRecord = {
  id: string;
  ownerUserId: string;
  language: LanguagePair;
  title: string;
  raw: string;
  createdAt: string;
};

export type ContentDraftRecord = {
  id: string;
  ownerUserId: string;
  type: ContentDraftType;
  sourceId: string | null;
  title: string;
  payload: unknown;
  settings: DraftSettings;
  problems: DraftProblem[];
  status: ContentDraftStatus;
  shared: boolean;
  lastEditedByUserId: string;
  resultGameId: string | null;
  remixedFromGameId: string | null;
  /** Chapter drafts: the chapter published from it. */
  resultChapter: ChapterRefRecord | null;
  remixedFromChapter: ChapterRefRecord | null;
  /** Chapter drafts: the owner's published chapter it changes (G8). */
  editsChapter: ChapterRefRecord | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** A row in the drafts list: no payload or source text. */
export type ContentDraftSummary = Pick<
  ContentDraftRecord,
  'id' | 'type' | 'title' | 'status' | 'shared' | 'resultGameId' | 'resultChapter' | 'editsChapter' | 'revision' | 'updatedAt'
> & { questionCount: number; vocabularyCount: number; problemCount: number; mine: boolean };

/** The fields a draft write may change. */
export type ContentDraftChanges = Partial<
  Pick<ContentDraftRecord, 'sourceId' | 'title' | 'payload' | 'settings' | 'problems' | 'shared'>
> & { status?: 'accepted'; resultGameId?: string; resultChapter?: ChapterRefRecord };

export function sourceChecksum(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

type LeanDraft = {
  _id: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  type: string;
  sourceId?: Types.ObjectId | null;
  title?: string | null;
  payload?: unknown;
  settings: DraftSettings;
  problems?: DraftProblem[] | null;
  status: string;
  shared: boolean;
  lastEditedByUserId: Types.ObjectId;
  resultGameId?: Types.ObjectId | null;
  remixedFromGameId?: Types.ObjectId | null;
  resultChapter?: ChapterRefRecord | null;
  remixedFromChapter?: ChapterRefRecord | null;
  editsChapter?: ChapterRefRecord | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

function chapterRef(ref: ChapterRefRecord | null | undefined): ChapterRefRecord | null {
  return ref ? { book: ref.book, chapter: ref.chapter, revision: ref.revision ?? null } : null;
}

function toDraftRecord(draft: LeanDraft): ContentDraftRecord {
  return {
    id: draft._id.toString(),
    ownerUserId: draft.ownerUserId.toString(),
    type: draft.type as ContentDraftType,
    sourceId: draft.sourceId ? draft.sourceId.toString() : null,
    title: draft.title ?? '',
    payload: draft.payload ?? null,
    settings: {
      mix: draft.settings.mix,
      questionCount: draft.settings.questionCount,
      optionsPerQuestion: draft.settings.optionsPerQuestion,
    },
    problems: (draft.problems ?? []).map(({ path, message }) => ({ path, message })),
    status: draft.status as ContentDraftStatus,
    shared: draft.shared,
    lastEditedByUserId: draft.lastEditedByUserId.toString(),
    resultGameId: draft.resultGameId ? draft.resultGameId.toString() : null,
    remixedFromGameId: draft.remixedFromGameId ? draft.remixedFromGameId.toString() : null,
    resultChapter: chapterRef(draft.resultChapter),
    remixedFromChapter: chapterRef(draft.remixedFromChapter),
    editsChapter: chapterRef(draft.editsChapter),
    revision: draft.revision,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function countOf(payload: unknown, key: 'questions' | 'vocabulary'): number {
  const items = (payload as Record<string, unknown> | null)?.[key];
  return Array.isArray(items) ? items.length : 0;
}

/**
 * Content sources and drafts for AI game creation
 * (docs/hashbrown/creating-games-with-hashbrown.md → Server). Access rules
 * (owner, shared) are the controller's; this only stores.
 */
@Injectable()
export class ContentDraftRepository {
  constructor(private readonly mongoService: MongoService) {}

  /** The owner's source for this text, made the first time it's pasted. */
  async ensureSource(input: { ownerUserId: string; raw: string; language: LanguagePair; title?: string }): Promise<string> {
    const { ContentSource } = this.mongoService.getModels();
    const ownerUserId = asObjectId(input.ownerUserId);
    const checksum = sourceChecksum(input.raw);
    const source = await ContentSource.findOneAndUpdate(
      { ownerUserId, checksum },
      {
        $setOnInsert: {
          ownerUserId,
          checksum,
          raw: input.raw,
          format: 'freeform-ai',
          language: input.language,
          title: input.title ?? '',
        },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    if (!source) {
      throw new Error('Could not save the content source');
    }
    return (source._id as Types.ObjectId).toString();
  }

  async getSource(sourceId: string): Promise<ContentSourceRecord | null> {
    const { ContentSource } = this.mongoService.getModels();
    const source = await ContentSource.findById(asObjectId(sourceId)).lean();
    if (!source) return null;
    return {
      id: (source._id as Types.ObjectId).toString(),
      ownerUserId: (source.ownerUserId as Types.ObjectId).toString(),
      language: { target: source.language.target, native: source.language.native },
      title: source.title ?? '',
      raw: source.raw,
      createdAt: (source as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }

  async createDraft(input: {
    ownerUserId: string;
    type: ContentDraftType;
    sourceId: string | null;
    title: string;
    payload: unknown;
    settings: DraftSettings;
    problems: DraftProblem[];
    remixedFromGameId?: string | null;
    remixedFromChapter?: ChapterRefRecord | null;
    editsChapter?: ChapterRefRecord | null;
  }): Promise<ContentDraftRecord> {
    const { ContentDraft } = this.mongoService.getModels();
    const created = await ContentDraft.create({
      ownerUserId: asObjectId(input.ownerUserId),
      type: input.type,
      sourceId: input.sourceId ? asObjectId(input.sourceId) : null,
      title: input.title,
      payload: input.payload,
      settings: input.settings,
      problems: input.problems,
      lastEditedByUserId: asObjectId(input.ownerUserId),
      remixedFromGameId: input.remixedFromGameId ? asObjectId(input.remixedFromGameId) : null,
      remixedFromChapter: input.remixedFromChapter ?? null,
      editsChapter: input.editsChapter ?? null,
    });
    return toDraftRecord(created.toObject() as unknown as LeanDraft);
  }

  async getDraft(draftId: string): Promise<ContentDraftRecord | null> {
    const { ContentDraft } = this.mongoService.getModels();
    const draft = await ContentDraft.findById(asObjectId(draftId)).lean();
    return draft ? toDraftRecord(draft as unknown as LeanDraft) : null;
  }

  /** The user's own drafts, or (`shared`) everyone else's shared drafts. Newest first. */
  async listDrafts(input: { userId: string; shared: boolean }): Promise<ContentDraftSummary[]> {
    const { ContentDraft } = this.mongoService.getModels();
    const userId = asObjectId(input.userId);
    const filter = input.shared ? { shared: true, ownerUserId: { $ne: userId } } : { ownerUserId: userId };
    const drafts = await ContentDraft.find(filter, { sourceId: 0 }).sort({ updatedAt: -1 }).limit(200).lean();
    return drafts.map((row) => {
      const draft = toDraftRecord(row as unknown as LeanDraft);
      return {
        id: draft.id,
        type: draft.type,
        title: draft.title,
        status: draft.status,
        shared: draft.shared,
        resultGameId: draft.resultGameId,
        resultChapter: draft.resultChapter,
        editsChapter: draft.editsChapter,
        revision: draft.revision,
        updatedAt: draft.updatedAt,
        questionCount: countOf(draft.payload, 'questions'),
        vocabularyCount: countOf(draft.payload, 'vocabulary'),
        problemCount: draft.problems.length,
        mine: draft.ownerUserId === input.userId,
      };
    });
  }

  /**
   * Applies `changes` only if the draft is still at `revision` and not
   * accepted, and bumps the revision. `null` means someone else wrote first
   * (or it was accepted or deleted): reload and try again.
   */
  async updateDraft(input: {
    draftId: string;
    revision: number;
    editorUserId: string;
    changes: ContentDraftChanges;
  }): Promise<ContentDraftRecord | null> {
    const { ContentDraft } = this.mongoService.getModels();
    const { sourceId, resultGameId, ...rest } = input.changes;
    const $set: Record<string, unknown> = { ...rest, lastEditedByUserId: asObjectId(input.editorUserId) };
    if (sourceId !== undefined) $set['sourceId'] = sourceId ? asObjectId(sourceId) : null;
    if (resultGameId !== undefined) $set['resultGameId'] = asObjectId(resultGameId);
    const draft = await ContentDraft.findOneAndUpdate(
      { _id: asObjectId(input.draftId), revision: input.revision, status: 'draft' },
      { $set, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    ).lean();
    return draft ? toDraftRecord(draft as unknown as LeanDraft) : null;
  }

  async deleteDraft(draftId: string): Promise<void> {
    const { ContentDraft } = this.mongoService.getModels();
    await ContentDraft.deleteOne({ _id: asObjectId(draftId) });
  }
}
