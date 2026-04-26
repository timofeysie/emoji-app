import {
  Connection,
  HydratedDocument,
  InferSchemaType,
  Model,
  Schema,
  Types,
} from 'mongoose';
import {
  assignmentReasonValues,
  badgeStatusValues,
  gameNfcCardGroupAssignmentStatusValues,
  gameStateValues,
  nfcCardGroupStatusValues,
  nfcCardStatusValues,
  participantRoleValues,
  participantStatusValues,
  playModeValues,
  questionModeValues,
  questionStateValues,
  slotLabelValues,
} from './domain-types';

const objectId = Schema.Types.ObjectId;

const userSchema = new Schema(
  {
    displayName: { type: String, required: true, trim: true },
    authProviderId: { type: String, required: true, immutable: true },
  },
  { timestamps: true, collection: 'users' },
);
userSchema.index({ authProviderId: 1 }, { unique: true });

const badgeSchema = new Schema(
  {
    externalBadgeId: { type: String, required: true, immutable: true },
    label: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: badgeStatusValues, default: 'active' },
  },
  { timestamps: true, collection: 'badges' },
);
badgeSchema.index({ externalBadgeId: 1 }, { unique: true });

const gameSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    state: { type: String, required: true, enum: gameStateValues, default: 'draft' },
    createdByUserId: { type: objectId, ref: 'User', required: true, immutable: true },
    startedAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true, collection: 'games' },
);
gameSchema.index({ state: 1, createdAt: -1 });

const gameParticipantSchema = new Schema(
  {
    gameId: { type: objectId, ref: 'Game', required: true, immutable: true },
    userId: { type: objectId, ref: 'User', required: true, immutable: true },
    role: { type: String, required: true, enum: participantRoleValues },
    playMode: { type: String, enum: playModeValues },
    joinedAt: { type: Date, required: true, default: () => new Date(), immutable: true },
    leftAt: { type: Date },
    status: { type: String, required: true, enum: participantStatusValues, default: 'active' },
  },
  { collection: 'gameParticipants' },
);
gameParticipantSchema.index({ gameId: 1, userId: 1 }, { unique: true });
gameParticipantSchema.index({ gameId: 1, role: 1, status: 1 });

const playerBadgeAssignmentSchema = new Schema(
  {
    gameId: { type: objectId, ref: 'Game', required: true, immutable: true },
    userId: { type: objectId, ref: 'User', required: true, immutable: true },
    badgeId: { type: objectId, ref: 'Badge', required: true, immutable: true },
    assignedAt: { type: Date, required: true, default: () => new Date(), immutable: true },
    unassignedAt: { type: Date, default: null },
    reason: { type: String, required: true, enum: assignmentReasonValues },
  },
  { collection: 'playerBadgeAssignments' },
);
playerBadgeAssignmentSchema.index({ gameId: 1, userId: 1, assignedAt: -1 });
playerBadgeAssignmentSchema.index(
  { gameId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { unassignedAt: null },
    name: 'uniq_active_assignment_per_player',
  },
);
playerBadgeAssignmentSchema.index(
  { gameId: 1, badgeId: 1 },
  {
    unique: true,
    partialFilterExpression: { unassignedAt: null },
    name: 'uniq_active_assignment_per_badge',
  },
);

const questionSchema = new Schema(
  {
    gameId: { type: objectId, ref: 'Game', required: true, immutable: true },
    text: { type: String, required: true },
    sequence: { type: Number, required: true, immutable: true },
    mode: { type: String, required: true, enum: questionModeValues },
    state: { type: String, required: true, enum: questionStateValues, default: 'draft' },
    openedAt: { type: Date },
    closedAt: { type: Date },
    createdByUserId: { type: objectId, ref: 'User', required: true, immutable: true },
  },
  { timestamps: true, collection: 'questions' },
);
questionSchema.index({ gameId: 1, sequence: 1 }, { unique: true });
questionSchema.index({ gameId: 1, state: 1, sequence: 1 });

const answerOptionSchema = new Schema(
  {
    questionId: { type: objectId, ref: 'Question', required: true, immutable: true },
    text: { type: String, required: true },
    sequence: { type: Number, required: true, immutable: true },
    slotLabel: { type: String, required: true, enum: slotLabelValues, immutable: true },
    isCorrect: { type: Boolean, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'answerOptions' },
);
answerOptionSchema.index({ questionId: 1, sequence: 1 }, { unique: true });
answerOptionSchema.index({ questionId: 1, slotLabel: 1 }, { unique: true });

const nfcCardGroupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    status: { type: String, required: true, enum: nfcCardGroupStatusValues, default: 'active' },
  },
  { timestamps: true, collection: 'nfcCardGroups' },
);

const nfcCardSchema = new Schema(
  {
    cardUid: { type: String, required: true, immutable: true },
    groupId: { type: objectId, ref: 'NfcCardGroup', required: true, immutable: true },
    slotLabel: { type: String, required: true, enum: slotLabelValues },
    displayName: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: nfcCardStatusValues, default: 'active' },
  },
  { timestamps: true, collection: 'nfcCards' },
);
nfcCardSchema.index({ cardUid: 1 }, { unique: true });
nfcCardSchema.index({ groupId: 1, slotLabel: 1 }, { unique: true });
nfcCardSchema.index({ groupId: 1, status: 1 });

const gameNfcCardGroupAssignmentSchema = new Schema(
  {
    gameId: { type: objectId, ref: 'Game', required: true, immutable: true },
    groupId: { type: objectId, ref: 'NfcCardGroup', required: true, immutable: true },
    assignedAt: { type: Date, required: true, default: () => new Date(), immutable: true },
    assignedByUserId: { type: objectId, ref: 'User', required: true, immutable: true },
    status: {
      type: String,
      required: true,
      enum: gameNfcCardGroupAssignmentStatusValues,
      default: 'active',
    },
    unassignedAt: { type: Date },
    reason: { type: String },
  },
  { collection: 'gameNfcCardGroupAssignments' },
);
gameNfcCardGroupAssignmentSchema.index({ gameId: 1, status: 1, assignedAt: -1 });
gameNfcCardGroupAssignmentSchema.index(
  { gameId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'uniq_active_nfc_group_per_game',
  },
);

const guessSchema = new Schema(
  {
    gameId: { type: objectId, ref: 'Game', required: true, immutable: true },
    questionId: { type: objectId, ref: 'Question', required: true, immutable: true },
    answerOptionId: { type: objectId, ref: 'AnswerOption', required: true, immutable: true },
    guesserUserId: { type: objectId, ref: 'User', required: true, immutable: true },
    badgeId: { type: objectId, ref: 'Badge' },
    cardUid: { type: String },
    slotLabel: { type: String, enum: slotLabelValues },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'guesses' },
);
guessSchema.index({ questionId: 1, guesserUserId: 1 }, { unique: true });
guessSchema.index({ gameId: 1, questionId: 1, createdAt: -1 });
guessSchema.index({ questionId: 1, createdAt: -1 });

export type User = InferSchemaType<typeof userSchema>;
export type Badge = InferSchemaType<typeof badgeSchema>;
export type Game = InferSchemaType<typeof gameSchema>;
export type GameParticipant = InferSchemaType<typeof gameParticipantSchema>;
export type PlayerBadgeAssignment = InferSchemaType<typeof playerBadgeAssignmentSchema>;
export type Question = InferSchemaType<typeof questionSchema>;
export type AnswerOption = InferSchemaType<typeof answerOptionSchema>;
export type NfcCardGroup = InferSchemaType<typeof nfcCardGroupSchema>;
export type NfcCard = InferSchemaType<typeof nfcCardSchema>;
export type GameNfcCardGroupAssignment = InferSchemaType<typeof gameNfcCardGroupAssignmentSchema>;
export type Guess = InferSchemaType<typeof guessSchema>;

export type UserDocument = HydratedDocument<User>;
export type BadgeDocument = HydratedDocument<Badge>;
export type GameDocument = HydratedDocument<Game>;
export type GameParticipantDocument = HydratedDocument<GameParticipant>;
export type PlayerBadgeAssignmentDocument = HydratedDocument<PlayerBadgeAssignment>;
export type QuestionDocument = HydratedDocument<Question>;
export type AnswerOptionDocument = HydratedDocument<AnswerOption>;
export type NfcCardGroupDocument = HydratedDocument<NfcCardGroup>;
export type NfcCardDocument = HydratedDocument<NfcCard>;
export type GameNfcCardGroupAssignmentDocument = HydratedDocument<GameNfcCardGroupAssignment>;
export type GuessDocument = HydratedDocument<Guess>;

export type DbModels = {
  User: Model<User>;
  Badge: Model<Badge>;
  Game: Model<Game>;
  GameParticipant: Model<GameParticipant>;
  PlayerBadgeAssignment: Model<PlayerBadgeAssignment>;
  Question: Model<Question>;
  AnswerOption: Model<AnswerOption>;
  NfcCardGroup: Model<NfcCardGroup>;
  NfcCard: Model<NfcCard>;
  GameNfcCardGroupAssignment: Model<GameNfcCardGroupAssignment>;
  Guess: Model<Guess>;
};

export function registerModels(connection: Connection): DbModels {
  return {
    User: connection.model('User', userSchema),
    Badge: connection.model('Badge', badgeSchema),
    Game: connection.model('Game', gameSchema),
    GameParticipant: connection.model('GameParticipant', gameParticipantSchema),
    PlayerBadgeAssignment: connection.model('PlayerBadgeAssignment', playerBadgeAssignmentSchema),
    Question: connection.model('Question', questionSchema),
    AnswerOption: connection.model('AnswerOption', answerOptionSchema),
    NfcCardGroup: connection.model('NfcCardGroup', nfcCardGroupSchema),
    NfcCard: connection.model('NfcCard', nfcCardSchema),
    GameNfcCardGroupAssignment: connection.model(
      'GameNfcCardGroupAssignment',
      gameNfcCardGroupAssignmentSchema,
    ),
    Guess: connection.model('Guess', guessSchema),
  };
}

export function asObjectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}
