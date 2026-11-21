import { Types } from 'mongoose';

export const gameStateValues = [
  'draft',
  'ready',
  'lobby',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;

export const participantRoleValues = ['player', 'referee', 'spectator'] as const;
export const playModeValues = ['standard', 'cut-throat'] as const;
export const participantStatusValues = ['active', 'removed', 'disconnected'] as const;
export const badgeStatusValues = ['active', 'inactive', 'broken', 'retired'] as const;
export const assignmentReasonValues = [
  'initial',
  'swap',
  'replacement',
  'recovery',
  'admin_override',
] as const;
/** Why a badge → player binding was made (subset of `assignmentReasonValues`). */
export const playerBindingReasonValues = ['initial', 'swap', 'replacement'] as const;
/** `class`: today's games. `leitner-solo`: one student's single-use Leitner game (docs/xAPI/leitner-method.md). */
export const gameKindValues = ['class', 'leitner-solo'] as const;
export const leitnerScopeValues = ['chapter', 'review'] as const;
export const leitnerPickReasonValues = ['overdue', 'new', 'practice', 'review'] as const;
export const questionModeValues = ['standard', 'cut-throat', 'mixed'] as const;
export const questionStateValues = ['draft', 'open', 'closed', 'scored', 'archived'] as const;
export const nfcCardStatusValues = ['active', 'retired', 'lost'] as const;
export const nfcCardGroupStatusValues = ['active', 'inactive', 'archived'] as const;
export const gameNfcCardGroupAssignmentStatusValues = ['active', 'superseded', 'removed'] as const;
export const slotLabelValues = ['A', 'B', 'C', 'D', 'E'] as const;
/** Pasted text kept for AI drafting (docs/hashbrown/creating-games-with-hashbrown.md, G13). */
export const contentSourceFormatValues = ['freeform-ai'] as const;
/** `chapter` drafts come with H2. */
export const contentDraftTypeValues = ['game', 'chapter'] as const;
export const contentDraftStatusValues = ['draft', 'accepted'] as const;
/** How a game was made, when not by hand. */
export const gameOriginKindValues = ['ai-draft'] as const;

export type GameState = (typeof gameStateValues)[number];
export type ParticipantRole = (typeof participantRoleValues)[number];
export type PlayMode = (typeof playModeValues)[number];
export type ParticipantStatus = (typeof participantStatusValues)[number];
export type BadgeStatus = (typeof badgeStatusValues)[number];
export type AssignmentReason = (typeof assignmentReasonValues)[number];
export type PlayerBindingReason = (typeof playerBindingReasonValues)[number];
export type GameKind = (typeof gameKindValues)[number];
export type LeitnerScope = (typeof leitnerScopeValues)[number];
export type LeitnerPickReason = (typeof leitnerPickReasonValues)[number];
export type QuestionMode = (typeof questionModeValues)[number];
export type QuestionState = (typeof questionStateValues)[number];
export type NfcCardStatus = (typeof nfcCardStatusValues)[number];
export type NfcCardGroupStatus = (typeof nfcCardGroupStatusValues)[number];
export type GameNfcCardGroupAssignmentStatus = (typeof gameNfcCardGroupAssignmentStatusValues)[number];
export type SlotLabel = (typeof slotLabelValues)[number];
export type ContentSourceFormat = (typeof contentSourceFormatValues)[number];
export type ContentDraftType = (typeof contentDraftTypeValues)[number];
export type ContentDraftStatus = (typeof contentDraftStatusValues)[number];

export type ObjectId = Types.ObjectId;
