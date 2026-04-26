import { Types } from 'mongoose';

export const gameStateValues = [
  'draft',
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
export const questionModeValues = ['standard', 'cut-throat', 'mixed'] as const;
export const questionStateValues = ['draft', 'open', 'closed', 'scored', 'archived'] as const;
export const nfcCardStatusValues = ['active', 'retired', 'lost'] as const;
export const nfcCardGroupStatusValues = ['active', 'inactive', 'archived'] as const;
export const gameNfcCardGroupAssignmentStatusValues = ['active', 'superseded', 'removed'] as const;
export const slotLabelValues = ['A', 'B', 'C', 'D', 'E'] as const;

export type GameState = (typeof gameStateValues)[number];
export type ParticipantRole = (typeof participantRoleValues)[number];
export type PlayMode = (typeof playModeValues)[number];
export type ParticipantStatus = (typeof participantStatusValues)[number];
export type BadgeStatus = (typeof badgeStatusValues)[number];
export type AssignmentReason = (typeof assignmentReasonValues)[number];
export type QuestionMode = (typeof questionModeValues)[number];
export type QuestionState = (typeof questionStateValues)[number];
export type NfcCardStatus = (typeof nfcCardStatusValues)[number];
export type NfcCardGroupStatus = (typeof nfcCardGroupStatusValues)[number];
export type GameNfcCardGroupAssignmentStatus = (typeof gameNfcCardGroupAssignmentStatusValues)[number];
export type SlotLabel = (typeof slotLabelValues)[number];

export type ObjectId = Types.ObjectId;
