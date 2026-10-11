import { Injectable } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { MongoService } from './mongo.service';
import { GameState, PlayMode, QuestionMode, SlotLabel } from './domain-types';
import { asObjectId } from './models';
import { shortCardLabel } from '../nfc-card.service';

export type CreateGameInput = {
  title: string;
  createdByUserId: string;
};

export type AddParticipantInput = {
  gameId: string;
  userId: string;
  role: 'player' | 'referee' | 'spectator';
  playMode?: PlayMode;
};

export type CreateQuestionInput = {
  gameId: string;
  createdByUserId: string;
  text: string;
  sequence: number;
  mode: QuestionMode;
  answerOptions: Array<{
    text: string;
    sequence: number;
    slotLabel: SlotLabel;
    isCorrect: boolean;
  }>;
};

export type SubmitGuessInput = {
  gameId: string;
  questionId: string;
  guesserUserId?: string;
  /** Controller station that relayed the scan. */
  pairName?: string;
  badgeId?: string;
  /** Badge that scanned. It is the player; defaults to `pairName` (Mode 1). */
  badgeName?: string;
  cardUid: string;
  slotLabel?: SlotLabel;
};

export type BindStationInput = {
  stationName: string;
  /** Roster; every name becomes one player binding. Empty → `[stationName]`. */
  badgeNames: string[];
  gameId: string;
  controllerId?: string;
};

/** Bindings changed for one game by a live roster sync. */
export type StationRosterChange = {
  gameId: string;
  stationName: string;
  added: string[];
  removed: string[];
  /** Roster names already bound to another station; left untouched. */
  skipped: string[];
};

export type GameSummary = {
  id: string;
  title: string;
  state: GameState;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  questionCount: number;
};

export type AnswerOptionDetail = {
  id: string;
  slotLabel: SlotLabel;
  text: string;
  isCorrect: boolean;
  sequence: number;
};

export type QuestionDetail = {
  id: string;
  text: string;
  sequence: number;
  mode: QuestionMode;
  state: string;
  closedAt?: string | null;
  /** Number of Guess docs for this question (any pair). */
  guessCount: number;
  answerOptions: AnswerOptionDetail[];
};

/** One player (badge). `pairName` is the player key; `stationName` its controller. */
export type BoundPairSummary = {
  pairName: string;
  stationName: string;
  joined: boolean;
  readyForNextQuestion: boolean | null;
  controllerId?: string;
};

export type QuestionResultPayload = {
  gameId: string;
  questionId: string;
  correctSlotLabel: string;
  results: Array<{
    pairName: string;
    stationName: string;
    badgeName: string;
    slotLabel: string | null;
    isCorrect: boolean;
  }>;
};

export type GameScoresPayload = {
  gameId: string;
  scores: Array<{
    pairName: string;
    stationName: string;
    badgeName: string;
    correct: number;
    total: number;
  }>;
};

export type GuessChartPairCell = {
  cardLabel: string;
  slotLabel: string;
  isCorrect: boolean;
  cardUid?: string;
};

export type GameGuessChartPayload = {
  gameId: string;
  title: string;
  /** Player keys (badge names). */
  pairs: string[];
  /** Player key → controller station. */
  pairStations: Record<string, string>;
  questions: Array<{
    questionId: string;
    sequence: number;
    byPair: Record<string, GuessChartPairCell | null>;
  }>;
};

export type GameDetail = {
  id: string;
  title: string;
  state: GameState;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  questions: QuestionDetail[];
  boundPairs: BoundPairSummary[];
};

/** Question shape xAPI export needs (`openedAt`, for `result.duration`); not part of the UI's `QuestionDetail`. */
export type GameExportQuestion = {
  id: string;
  text: string;
  openedAt: string | null;
  answerOptions: Array<{ slotLabel: SlotLabel; text: string; isCorrect: boolean }>;
};

/** One `Guess` row as xAPI export needs it. */
export type GameExportGuess = {
  id: string;
  questionId: string;
  badgeName: string;
  stationName: string | null;
  slotLabel: string;
  createdAt: string;
};

export type GameExportData = {
  id: string;
  title: string;
  state: GameState;
  startedAt: string | null;
  endedAt: string | null;
  questions: GameExportQuestion[];
  guesses: GameExportGuess[];
};

/** Player state inside a station snapshot; guess fields describe the open question. */
export type PlayerSnapshot = {
  badgeName: string;
  joined: boolean;
  readyForNextQuestion: boolean | null;
  guessed: boolean;
  slotLabel: string | null;
  isCorrect: boolean | null;
};

/**
 * Station snapshot for a controller. Top-level `joined` is true when any player
 * joined; `readyForNextQuestion` is set only when every joined player agrees.
 * Mode 1 has one player, so both equal that player's values.
 */
export type PairBindingSnapshot = {
  pairName: string;
  stationName: string;
  controllerId: string | undefined;
  gameId: string | null;
  state: GameState | null;
  joined: boolean;
  readyForNextQuestion: boolean | null;
  openQuestionId: string | null;
  roundsComplete: boolean;
  players: PlayerSnapshot[];
};

export type CreateNfcCardGroupInput = {
  name: string;
  description?: string;
  cards: Array<{
    cardUid: string;
    slotLabel: SlotLabel;
    displayName: string;
  }>;
};

/** Station of a binding or guess; Mode 1 / legacy rows have none and use the player key. */
function stationOf(row: { pairName?: string | null; stationName?: string | null }): string {
  return row.stationName || row.pairName || '';
}

/** Bindings owned by a station, including legacy rows keyed only by `pairName`. */
function stationFilter(stationName: string): Record<string, unknown> {
  return { $or: [{ stationName }, { stationName: null, pairName: stationName }] };
}

/**
 * Players of a game: every binding, then every player that guessed but is no
 * longer bound (removed mid-game), so scores and results keep them.
 */
function gamePlayers(
  bindings: Array<{ pairName: string; stationName?: string | null }>,
  guesses: Array<{ pairName?: string | null; stationName?: string | null }>,
): Array<{ pairName: string; stationName: string }> {
  const players = new Map<string, string>();
  for (const binding of bindings) {
    players.set(binding.pairName, stationOf(binding));
  }
  for (const guess of guesses) {
    if (guess.pairName && !players.has(guess.pairName)) {
      players.set(guess.pairName, stationOf(guess));
    }
  }
  return [...players].map(([pairName, stationName]) => ({ pairName, stationName }));
}

@Injectable()
export class GameDataRepository {
  constructor(private readonly mongoService: MongoService) {}

  async createGame(input: CreateGameInput): Promise<string> {
    const { Game } = this.mongoService.getModels();
    const created = await Game.create({
      title: input.title,
      createdByUserId: asObjectId(input.createdByUserId),
      state: 'draft',
    });
    return created._id.toString();
  }

  async addParticipant(input: AddParticipantInput): Promise<void> {
    const { GameParticipant } = this.mongoService.getModels();
    await GameParticipant.updateOne(
      { gameId: asObjectId(input.gameId), userId: asObjectId(input.userId) },
      {
        $setOnInsert: {
          gameId: asObjectId(input.gameId),
          userId: asObjectId(input.userId),
          joinedAt: new Date(),
        },
        $set: {
          role: input.role,
          status: 'active',
          playMode: input.role === 'player' ? input.playMode : undefined,
        },
      },
      { upsert: true },
    );
  }

  async createQuestionWithOptions(input: CreateQuestionInput): Promise<string> {
    const { Question, AnswerOption } = this.mongoService.getModels();
    const question = await Question.create({
      gameId: asObjectId(input.gameId),
      createdByUserId: asObjectId(input.createdByUserId),
      text: input.text,
      sequence: input.sequence,
      mode: input.mode,
      state: 'draft',
    });

    await AnswerOption.insertMany(
      input.answerOptions.map((option) => ({
        questionId: question._id,
        text: option.text,
        sequence: option.sequence,
        slotLabel: option.slotLabel,
        isCorrect: option.isCorrect,
      })),
    );

    return question._id.toString();
  }

  async setQuestionState(input: {
    gameId: string;
    questionId: string;
    state: 'open' | 'closed';
  }): Promise<void> {
    const { Question } = this.mongoService.getModels();
    const timestampField = input.state === 'open' ? 'openedAt' : 'closedAt';
    await Question.updateOne(
      { _id: asObjectId(input.questionId), gameId: asObjectId(input.gameId) },
      { $set: { state: input.state, [timestampField]: new Date() } },
    );
  }

  /**
   * Open the next closed question (lowest sequence) if none is already open.
   * Used when the referee starts the game so badges get GAME:question_open /
   * NFC scan without a separate Open click.
   */
  async openNextQuestionForGame(gameId: string): Promise<string | null> {
    const { Question } = this.mongoService.getModels();
    const gid = asObjectId(gameId);

    const alreadyOpen = await Question.findOne({ gameId: gid, state: 'open' }).lean();
    if (alreadyOpen) {
      return null;
    }

    const next = await Question.findOne({ gameId: gid, state: 'closed' })
      .sort({ sequence: 1 })
      .lean();
    if (!next) {
      return null;
    }

    const questionId = (next._id as Types.ObjectId).toString();
    await this.setQuestionState({ gameId, questionId, state: 'open' });
    return questionId;
  }

  async createNfcCardGroup(input: CreateNfcCardGroupInput): Promise<string> {
    const { NfcCardGroup, NfcCard } = this.mongoService.getModels();
    return this.withOptionalTransaction(async (session) => {
      const group = await NfcCardGroup.create(
        [
          {
            name: input.name,
            description: input.description,
            status: 'active',
          },
        ],
        { session },
      );
      await NfcCard.insertMany(
        input.cards.map((card) => ({
          groupId: group[0]._id,
          cardUid: card.cardUid,
          slotLabel: card.slotLabel,
          displayName: card.displayName,
          status: 'active',
        })),
        { session },
      );
      return group[0]._id.toString();
    });
  }

  /**
   * Idempotent demo/seed group helper. Re-assigning the same card UIDs must not
   * 500 on the unique `cardUid` index — return the existing group instead.
   */
  async ensureNfcCardGroup(input: CreateNfcCardGroupInput): Promise<string> {
    const { NfcCardGroup, NfcCard } = this.mongoService.getModels();
    const uids = input.cards.map((card) => card.cardUid);

    const existingCard = await NfcCard.findOne({ cardUid: { $in: uids } }).lean();
    if (existingCard?.groupId) {
      return existingCard.groupId.toString();
    }

    const existingGroup = await NfcCardGroup.findOne({
      name: input.name,
      status: 'active',
    }).lean();
    if (existingGroup) {
      const cardCount = await NfcCard.countDocuments({ groupId: existingGroup._id });
      if (cardCount === 0) {
        await NfcCard.insertMany(
          input.cards.map((card) => ({
            groupId: existingGroup._id,
            cardUid: card.cardUid,
            slotLabel: card.slotLabel,
            displayName: card.displayName,
            status: 'active',
          })),
        );
      }
      return existingGroup._id.toString();
    }

    try {
      return await this.createNfcCardGroup(input);
    } catch (error) {
      // Race / leftover unique index: resolve via card UID again.
      const raced = await NfcCard.findOne({ cardUid: { $in: uids } }).lean();
      if (raced?.groupId) {
        return raced.groupId.toString();
      }
      throw error;
    }
  }

  async assignNfcCardGroupToGame(input: {
    gameId: string;
    groupId: string;
    assignedByUserId?: string;
  }): Promise<void> {
    const { GameNfcCardGroupAssignment } = this.mongoService.getModels();
    await GameNfcCardGroupAssignment.updateMany(
      { gameId: asObjectId(input.gameId), status: 'active' },
      { $set: { status: 'superseded', unassignedAt: new Date() } },
    );
    await GameNfcCardGroupAssignment.create({
      gameId: asObjectId(input.gameId),
      groupId: asObjectId(input.groupId),
      assignedByUserId: asObjectId(input.assignedByUserId ?? '000000000000000000000000'),
      status: 'active',
      assignedAt: new Date(),
    });
  }

  async getActiveNfcCardGroupForGame(
    gameId: string,
  ): Promise<{ groupId: string; name: string; cardCount: number } | null> {
    const { GameNfcCardGroupAssignment, NfcCardGroup, NfcCard } = this.mongoService.getModels();

    const assignment = await GameNfcCardGroupAssignment.findOne({
      gameId: asObjectId(gameId),
      status: 'active',
    }).lean();
    if (!assignment) return null;

    const group = await NfcCardGroup.findById(assignment.groupId).lean();
    if (!group) return null;

    const cardCount = await NfcCard.countDocuments({
      groupId: assignment.groupId,
      status: 'active',
    });

    return { groupId: assignment.groupId.toString(), name: group.name, cardCount };
  }

  async submitGuess(
    input: SubmitGuessInput,
  ): Promise<{
    guessId: string;
    answerOptionId: string;
    slotLabel: string;
    isCorrect: boolean;
    cardLabel: string;
    gameTitle: string;
  }> {
    const { Question, AnswerOption, Guess, GameNfcCardGroupAssignment, NfcCard, Game, PairBinding } =
      this.mongoService.getModels();
    const player = input.badgeName ?? input.pairName;
    const stationName = input.pairName ?? input.badgeName;

    return this.withOptionalTransaction(async (session) => {
      const game = await Game.findById(asObjectId(input.gameId), undefined, { session }).lean();
      const gameTitle = game?.title ?? '';

      if (input.badgeName && input.pairName && input.badgeName !== input.pairName) {
        const binding = await PairBinding.findOne(
          {
            pairName: input.badgeName,
            gameId: asObjectId(input.gameId),
            stationName: input.pairName,
          },
          undefined,
          { session },
        ).lean();
        if (!binding) {
          throw new Error(
            `Badge '${input.badgeName}' is not bound to station '${input.pairName}' for this game.`,
          );
        }
      }

      const question = await Question.findOne(
        { _id: asObjectId(input.questionId), gameId: asObjectId(input.gameId) },
        undefined,
        { session },
      ).lean();
      if (!question || question.state !== 'open') {
        throw new Error('Question is not open for submissions.');
      }

      const assignment = await GameNfcCardGroupAssignment.findOne(
        { gameId: asObjectId(input.gameId), status: 'active' },
        undefined,
        { session },
      ).lean();

      let resolvedSlotLabel: SlotLabel;
      let cardDisplayName: string | undefined;

      if (assignment) {
        // MongoDB path — card group assigned; resolve slot via NfcCard document.
        const nfcCard = await NfcCard.findOne(
          { groupId: assignment.groupId, cardUid: input.cardUid, status: 'active' },
          undefined,
          { session },
        ).lean();
        if (!nfcCard) {
          // Unknown card in an assigned group → wrong (red X), not a hard error.
          const wrongOption = await AnswerOption.findOne(
            { questionId: asObjectId(input.questionId), isCorrect: false },
            undefined,
            { session },
          ).lean();
          if (!wrongOption) {
            return {
              guessId: '',
              answerOptionId: '',
              slotLabel: input.slotLabel ?? '?',
              isCorrect: false,
              cardLabel: shortCardLabel(undefined, input.slotLabel ?? '?'),
              gameTitle,
            };
          }
          resolvedSlotLabel = wrongOption.slotLabel as SlotLabel;
        } else {
          resolvedSlotLabel = nfcCard.slotLabel as SlotLabel;
          cardDisplayName = nfcCard.displayName as string | undefined;
        }
      } else if (input.slotLabel) {
        // Fallback path — no card group assigned; trust the slotLabel supplied
        // by the Zero (resolved from its local NFC_CARD_MAP). Demo seed:
        // R12 Monkey 5B:6F:B8:08 → A, W3 Clown DB:93:B7:08 → B.
        resolvedSlotLabel = input.slotLabel;
      } else {
        // No map and no group — still return wrong so the badge can show red X.
        return {
          guessId: '',
          answerOptionId: '',
          slotLabel: '?',
          isCorrect: false,
          cardLabel: shortCardLabel(undefined, '?'),
          gameTitle,
        };
      }

      const answerOption = await AnswerOption.findOne(
        {
          questionId: asObjectId(input.questionId),
          slotLabel: resolvedSlotLabel,
        },
        undefined,
        { session },
      ).lean();
      if (!answerOption) {
        return {
          guessId: '',
          answerOptionId: '',
          slotLabel: resolvedSlotLabel,
          isCorrect: false,
          cardLabel: shortCardLabel(cardDisplayName, resolvedSlotLabel),
          gameTitle,
        };
      }

      const guess = await Guess.create(
        [
          {
            gameId: asObjectId(input.gameId),
            questionId: asObjectId(input.questionId),
            answerOptionId: answerOption._id,
            ...(input.guesserUserId ? { guesserUserId: asObjectId(input.guesserUserId) } : {}),
            ...(player ? { pairName: player } : {}),
            ...(stationName ? { stationName } : {}),
            ...(input.badgeId ? { badgeId: asObjectId(input.badgeId) } : {}),
            ...(input.badgeName ? { badgeName: input.badgeName } : {}),
            cardUid: input.cardUid,
            slotLabel: resolvedSlotLabel,
          },
        ],
        { session },
      );

      return {
        guessId: guess[0]._id.toString(),
        answerOptionId: answerOption._id.toString(),
        slotLabel: resolvedSlotLabel,
        isCorrect: Boolean(answerOption.isCorrect),
        cardLabel: shortCardLabel(cardDisplayName, resolvedSlotLabel),
        gameTitle,
      };
    });
  }

  async getGameGuessChart(gameId: string): Promise<GameGuessChartPayload> {
    const { Game, Question, Guess, AnswerOption, PairBinding, NfcCard, GameNfcCardGroupAssignment } =
      this.mongoService.getModels();

    const game = await Game.findById(asObjectId(gameId)).lean();
    if (!game) {
      throw new Error('Game not found.');
    }

    const [questions, bindings, assignment] = await Promise.all([
      Question.find({ gameId: asObjectId(gameId) }).sort({ sequence: 1 }).lean(),
      PairBinding.find({ gameId: asObjectId(gameId) }, { pairName: 1, stationName: 1 }).lean(),
      GameNfcCardGroupAssignment.findOne({
        gameId: asObjectId(gameId),
        status: 'active',
      }).lean(),
    ]);

    const questionIds = questions.map((q) => q._id as Types.ObjectId);

    const guessFilter: Record<string, unknown> = { gameId: asObjectId(gameId) };
    if (game.startedAt) {
      guessFilter['createdAt'] = { $gte: game.startedAt };
    }
    if (questionIds.length > 0) {
      guessFilter['questionId'] = { $in: questionIds };
    }

    const [guesses, groupCards, options] = await Promise.all([
      Guess.find(guessFilter).lean(),
      assignment
        ? NfcCard.find({ groupId: assignment.groupId, status: 'active' }).lean()
        : Promise.resolve([]),
      questionIds.length > 0
        ? AnswerOption.find({ questionId: { $in: questionIds } }).lean()
        : Promise.resolve([]),
    ]);

    const players = gamePlayers(bindings, guesses);
    const pairs = players.map((p) => p.pairName);
    const pairStations = Object.fromEntries(players.map((p) => [p.pairName, p.stationName]));

    const cardNameByUid = new Map(
      groupCards.map((c) => [c.cardUid as string, c.displayName as string]),
    );
    const correctByQuestion = new Map<string, string>();
    for (const opt of options) {
      if (opt.isCorrect) {
        correctByQuestion.set(
          (opt.questionId as Types.ObjectId).toString(),
          opt.slotLabel as string,
        );
      }
    }

    const guessByQuestionPair = new Map<string, GuessChartPairCell>();
    for (const guess of guesses) {
      if (!guess.pairName) continue;
      const qid = (guess.questionId as Types.ObjectId).toString();
      const slotLabel = (guess.slotLabel as string | undefined) ?? '?';
      const cardUid = guess.cardUid as string | undefined;
      const displayName = cardUid ? cardNameByUid.get(cardUid) : undefined;
      guessByQuestionPair.set(`${qid}::${guess.pairName}`, {
        cardLabel: shortCardLabel(displayName, slotLabel),
        slotLabel,
        isCorrect: slotLabel === (correctByQuestion.get(qid) ?? ''),
        ...(cardUid ? { cardUid } : {}),
      });
    }

    return {
      gameId: (game._id as Types.ObjectId).toString(),
      title: game.title,
      pairs,
      pairStations,
      questions: questions.map((q) => {
        const questionId = (q._id as Types.ObjectId).toString();
        const byPair: Record<string, GuessChartPairCell | null> = {};
        for (const pairName of pairs) {
          byPair[pairName] = guessByQuestionPair.get(`${questionId}::${pairName}`) ?? null;
        }
        return {
          questionId,
          sequence: q.sequence,
          byPair,
        };
      }),
    };
  }

  async setGameState(input: { gameId: string; state: GameState }): Promise<{ gameId: string; state: GameState }> {
    const { Game } = this.mongoService.getModels();
    const game = await Game.findById(asObjectId(input.gameId)).lean();
    if (!game) {
      throw new Error('Game not found.');
    }

    const allowedTransitions: Partial<Record<GameState, GameState[]>> = {
      draft:     ['ready'],
      ready:     ['lobby'],
      lobby:     ['active', 'cancelled'],
      active:    ['paused', 'completed', 'cancelled'],
      paused:    ['active', 'cancelled'],
      completed: ['ready'],
      cancelled: ['ready'],
    };

    const currentState = game.state as GameState;
    const allowed = allowedTransitions[currentState] ?? [];
    if (!allowed.includes(input.state)) {
      throw new Error(`Cannot transition game from '${currentState}' to '${input.state}'.`);
    }

    if (input.state === 'ready' && (currentState === 'completed' || currentState === 'cancelled')) {
      const { Question, PairBinding, Guess } = this.mongoService.getModels();
      const gid = asObjectId(input.gameId);

      await Game.updateOne(
        { _id: gid },
        { $set: { state: 'ready' }, $unset: { startedAt: '', endedAt: '' } },
      );

      await Question.updateMany(
        { gameId: gid },
        { $set: { state: 'closed' }, $unset: { openedAt: '', closedAt: '' } },
      );

      // Each run starts unbound; the referee binds the live stations again.
      await PairBinding.deleteMany({ gameId: gid });

      // Clear prior-run guesses so uniq_guess_per_pair does not block replay.
      await Guess.deleteMany({ gameId: gid });

      return { gameId: input.gameId, state: input.state };
    }

    const timestampFields: Partial<Record<GameState, string>> = {
      active: 'startedAt',
      completed: 'endedAt',
      cancelled: 'endedAt',
    };
    const timestampField = timestampFields[input.state];

    await Game.updateOne(
      { _id: asObjectId(input.gameId) },
      { $set: { state: input.state, ...(timestampField ? { [timestampField]: new Date() } : {}) } },
    );

    return { gameId: input.gameId, state: input.state };
  }

  /**
   * Bind a controller station to a game: one player binding per roster badge.
   * Bindings this station owned for badges that left the roster are removed.
   */
  async bindStation(input: BindStationInput): Promise<string[]> {
    const { PairBinding } = this.mongoService.getModels();
    const badgeNames = [
      ...new Set(input.badgeNames.length > 0 ? input.badgeNames : [input.stationName]),
    ];

    await PairBinding.deleteMany({
      ...stationFilter(input.stationName),
      pairName: { $nin: badgeNames },
    });

    await Promise.all(
      badgeNames.map((badgeName) =>
        PairBinding.updateOne(
          { pairName: badgeName },
          {
            $set: {
              stationName: input.stationName,
              gameId: new Types.ObjectId(input.gameId),
              joined: false,
              readyForNextQuestion: null,
              updatedAt: new Date(),
              ...(input.controllerId ? { controllerId: input.controllerId } : {}),
            },
            $setOnInsert: { pairName: badgeName },
          },
          { upsert: true },
        ),
      ),
    );
    return badgeNames;
  }

  /**
   * Make a bound station's player bindings match its live roster. New badges
   * are bound (not joined); badges that left the roster are unbound, keeping
   * their guesses. Existing players keep their join / readiness state.
   * Finished games and unbound stations are left alone.
   */
  async syncStationRoster(input: {
    stationName: string;
    badgeNames: string[];
  }): Promise<StationRosterChange[]> {
    const { PairBinding, Game } = this.mongoService.getModels();
    const roster = [...new Set(input.badgeNames)];
    if (roster.length === 0) {
      return [];
    }

    const owned = await PairBinding.find({
      ...stationFilter(input.stationName),
      gameId: { $ne: null },
    }).lean();
    const gameIds = [...new Set(owned.map((b) => String(b.gameId)))];
    const changes: StationRosterChange[] = [];

    for (const gameId of gameIds) {
      const game = await Game.findById(asObjectId(gameId), { state: 1 }).lean();
      if (!game || game.state === 'completed' || game.state === 'cancelled') {
        continue;
      }

      const bound = owned.filter((b) => String(b.gameId) === gameId);
      const boundNames = new Set(bound.map((b) => b.pairName));
      const removed = [...boundNames].filter((name) => !roster.includes(name));
      const candidates = roster.filter((name) => !boundNames.has(name));

      const others = candidates.length
        ? await PairBinding.find({ pairName: { $in: candidates } }).lean()
        : [];
      const skipped = others
        .filter((b) => b.gameId != null && stationOf(b) !== input.stationName)
        .map((b) => b.pairName);
      const added = candidates.filter((name) => !skipped.includes(name));
      const controllerId = bound.find((b) => b.controllerId)?.controllerId;

      if (removed.length > 0) {
        await PairBinding.deleteMany({
          ...stationFilter(input.stationName),
          gameId: asObjectId(gameId),
          pairName: { $in: removed },
        });
      }
      await Promise.all(
        added.map((badgeName) =>
          PairBinding.updateOne(
            { pairName: badgeName },
            {
              $set: {
                stationName: input.stationName,
                gameId: asObjectId(gameId),
                joined: false,
                readyForNextQuestion: null,
                updatedAt: new Date(),
                ...(controllerId ? { controllerId } : {}),
              },
              $setOnInsert: { pairName: badgeName },
            },
            { upsert: true },
          ),
        ),
      );

      if (added.length > 0 || removed.length > 0 || skipped.length > 0) {
        changes.push({ gameId, stationName: input.stationName, added, removed, skipped });
      }
    }
    return changes;
  }

  /** Remove a station's player bindings for a game. Guesses stay. Returns the names removed. */
  async unbindStation(input: { gameId: string; stationName: string }): Promise<string[]> {
    const { PairBinding } = this.mongoService.getModels();
    const filter = { ...stationFilter(input.stationName), gameId: asObjectId(input.gameId) };
    const rows = await PairBinding.find(filter, { pairName: 1 }).lean();
    if (rows.length > 0) {
      await PairBinding.deleteMany(filter);
    }
    return rows.map((b) => b.pairName);
  }

  /** The game's open question, or null. */
  async getOpenQuestionId(gameId: string): Promise<string | null> {
    const { Question } = this.mongoService.getModels();
    const open = await Question.findOne({ gameId: asObjectId(gameId), state: 'open' }, { _id: 1 }).lean();
    return open ? (open._id as Types.ObjectId).toString() : null;
  }

  /**
   * Station snapshot for a controller. `name` is the station; a badge name also
   * resolves to its station so an old caller still gets a snapshot.
   */
  async getBinding(name: string): Promise<PairBindingSnapshot | null> {
    const { PairBinding, Game, Question, Guess, AnswerOption } = this.mongoService.getModels();
    let bindings = await PairBinding.find(stationFilter(name)).lean();
    if (bindings.length === 0) {
      const byBadge = await PairBinding.findOne({ pairName: name }).lean();
      if (!byBadge) {
        return null;
      }
      bindings = await PairBinding.find(stationFilter(stationOf(byBadge))).lean();
    }

    const primary = bindings.find((b) => b.gameId) ?? bindings[0];
    const stationName = stationOf(primary);
    const players = bindings.filter(
      (b) => String(b.gameId ?? '') === String(primary.gameId ?? ''),
    );
    const gameId = primary.gameId ? (primary.gameId as Types.ObjectId).toString() : null;
    let state: GameState | null = null;
    let openQuestionId: string | null = null;
    let roundsComplete = false;
    const guessByPlayer = new Map<string, { slotLabel: string | null; isCorrect: boolean }>();

    if (gameId) {
      const game = await Game.findById(primary.gameId).lean();
      if (game) {
        state = game.state as GameState;
        const openQuestion = await Question.findOne({ gameId: primary.gameId, state: 'open' }).lean();
        openQuestionId = openQuestion ? (openQuestion._id as Types.ObjectId).toString() : null;
        if (openQuestion) {
          const [guesses, correct] = await Promise.all([
            Guess.find({
              questionId: openQuestion._id,
              pairName: { $in: players.map((p) => p.pairName) },
            }).lean(),
            AnswerOption.findOne({ questionId: openQuestion._id, isCorrect: true }).lean(),
          ]);
          for (const guess of guesses) {
            if (!guess.pairName) continue;
            const slotLabel = (guess.slotLabel as string | undefined) ?? null;
            guessByPlayer.set(guess.pairName, {
              slotLabel,
              isCorrect: slotLabel != null && slotLabel === correct?.slotLabel,
            });
          }
        }
        if (state === 'active' && !openQuestion) {
          const playableQuestions = await Question.find({
            gameId: primary.gameId,
            state: { $ne: 'archived' },
          }).lean();
          roundsComplete =
            playableQuestions.length > 0 &&
            playableQuestions.every((question) => Boolean(question.closedAt));
        }
      }
    }

    const joinedPlayers = players.filter((p) => p.joined);
    const readiness = [...new Set(joinedPlayers.map((p) => p.readyForNextQuestion ?? null))];

    return {
      pairName: stationName,
      stationName,
      controllerId: primary.controllerId ?? undefined,
      gameId,
      state,
      joined: joinedPlayers.length > 0,
      readyForNextQuestion: readiness.length === 1 ? readiness[0] : null,
      openQuestionId,
      roundsComplete,
      players: players.map((p) => {
        const guess = guessByPlayer.get(p.pairName);
        return {
          badgeName: p.pairName,
          joined: p.joined,
          readyForNextQuestion: p.readyForNextQuestion ?? null,
          guessed: guess != null,
          slotLabel: guess?.slotLabel ?? null,
          isCorrect: guess ? guess.isCorrect : null,
        };
      }),
    };
  }

  /** Mark the listed station badges joined. Returns the badge names that matched. */
  async markJoined(input: {
    gameId: string;
    stationName: string;
    badgeNames: string[];
  }): Promise<string[]> {
    const { PairBinding } = this.mongoService.getModels();
    const filter = {
      ...stationFilter(input.stationName),
      gameId: asObjectId(input.gameId),
      pairName: { $in: input.badgeNames },
    };
    const matched = await PairBinding.find(filter, { pairName: 1 }).lean();
    if (matched.length > 0) {
      await PairBinding.updateMany(filter, { $set: { joined: true, updatedAt: new Date() } });
    }
    return matched.map((b) => b.pairName);
  }

  /** Record readiness for the listed joined badges. Returns the badge names updated. */
  async setPairReadyForNextQuestion(input: {
    gameId: string;
    stationName: string;
    badgeNames: string[];
    ready: boolean;
  }): Promise<string[]> {
    const { PairBinding } = this.mongoService.getModels();
    const filter = {
      ...stationFilter(input.stationName),
      gameId: asObjectId(input.gameId),
      pairName: { $in: input.badgeNames },
      joined: true,
    };
    const matched = await PairBinding.find(filter, { pairName: 1 }).lean();
    if (matched.length > 0) {
      await PairBinding.updateMany(filter, {
        $set: {
          readyForNextQuestion: input.ready,
          updatedAt: new Date(),
        },
      });
    }
    return matched.map((b) => b.pairName);
  }

  async resetPairReadiness(gameId: string): Promise<void> {
    const { PairBinding } = this.mongoService.getModels();
    await PairBinding.updateMany(
      { gameId: asObjectId(gameId) },
      {
        $set: {
          readyForNextQuestion: null,
          updatedAt: new Date(),
        },
      },
    );
  }

  /** Player keys (badge names) bound to the game. */
  async getBindingsByGameId(gameId: string): Promise<string[]> {
    const { PairBinding } = this.mongoService.getModels();
    const bindings = await PairBinding.find({ gameId: new Types.ObjectId(gameId) }, { pairName: 1 }).lean();
    return bindings.map((b) => b.pairName);
  }

  /** Controller stations (WS rooms) with at least one player bound to the game. */
  async getStationNamesByGameId(gameId: string): Promise<string[]> {
    const { PairBinding } = this.mongoService.getModels();
    const bindings = await PairBinding.find(
      { gameId: new Types.ObjectId(gameId) },
      { pairName: 1, stationName: 1 },
    ).lean();
    return [...new Set(bindings.map((b) => stationOf(b)))];
  }

  /**
   * True when every joined player has a Guess for this question. Bound players
   * that never joined (e.g. an unpowered badge) do not hold the question open.
   * No joined players → false (do not auto-close).
   */
  async haveAllJoinedPlayersGuessed(gameId: string, questionId: string): Promise<boolean> {
    const { PairBinding, Guess } = this.mongoService.getModels();
    const bindings = await PairBinding.find(
      { gameId: asObjectId(gameId), joined: true },
      { pairName: 1 },
    ).lean();
    if (bindings.length === 0) {
      return false;
    }

    const guesses = await Guess.find(
      {
        gameId: asObjectId(gameId),
        questionId: asObjectId(questionId),
        pairName: { $in: bindings.map((b) => b.pairName) },
      },
      { pairName: 1 },
    ).lean();

    const guessedPairs = new Set(
      guesses.map((g) => g.pairName).filter((name): name is string => Boolean(name)),
    );
    return bindings.every((b) => guessedPairs.has(b.pairName));
  }

  /**
   * Build per-player correct/wrong outcomes for a closed question.
   * Includes every bound player plus any unbound player that guessed;
   * `slotLabel: null` means no guess was submitted.
   */
  async computeQuestionResult(gameId: string, questionId: string): Promise<QuestionResultPayload> {
    const { AnswerOption, Guess, PairBinding } = this.mongoService.getModels();

    const correct = await AnswerOption.findOne({
      questionId: asObjectId(questionId),
      isCorrect: true,
    }).lean();
    if (!correct) {
      throw new Error('No correct answer option for question.');
    }

    const guesses = await Guess.find({
      gameId: asObjectId(gameId),
      questionId: asObjectId(questionId),
    }).lean();

    const guessByPair = new Map<string, string | null>();
    for (const guess of guesses) {
      if (!guess.pairName) continue;
      guessByPair.set(guess.pairName, (guess.slotLabel as string | undefined) ?? null);
    }

    const bindings = await PairBinding.find(
      { gameId: asObjectId(gameId) },
      { pairName: 1, stationName: 1 },
    ).lean();

    const correctSlotLabel = correct.slotLabel as string;
    const results = gamePlayers(bindings, guesses).map((player) => {
      const slotLabel = guessByPair.get(player.pairName) ?? null;
      return {
        pairName: player.pairName,
        stationName: player.stationName,
        badgeName: player.pairName,
        slotLabel,
        isCorrect: slotLabel === correctSlotLabel,
      };
    });

    return {
      gameId,
      questionId,
      correctSlotLabel,
      results,
    };
  }

  /**
   * Cumulative correct-guess counts per player (badge): every bound player plus
   * any player removed after guessing.
   * Guesses are scoped to `game.startedAt` when present so Play Again does not
   * inflate scores with prior runs.
   */
  async getGameScores(gameId: string): Promise<GameScoresPayload> {
    const { Game, Question, Guess, AnswerOption, PairBinding } = this.mongoService.getModels();

    const game = await Game.findById(asObjectId(gameId)).lean();
    if (!game) {
      throw new Error('Game not found.');
    }

    const total = await Question.countDocuments({ gameId: asObjectId(gameId) });

    const guessFilter: Record<string, unknown> = { gameId: asObjectId(gameId) };
    if (game.startedAt) {
      guessFilter['createdAt'] = { $gte: game.startedAt };
    }

    const guesses = await Guess.find(guessFilter).lean();
    const optionIds = [
      ...new Set(
        guesses
          .map((g) => g.answerOptionId)
          .filter((id): id is Types.ObjectId => id != null)
          .map((id) => id.toString()),
      ),
    ];

    const options =
      optionIds.length > 0
        ? await AnswerOption.find({ _id: { $in: optionIds.map((id) => asObjectId(id)) } }).lean()
        : [];
    const correctOptionIds = new Set(
      options.filter((o) => o.isCorrect).map((o) => (o._id as Types.ObjectId).toString()),
    );

    const correctByPair = new Map<string, number>();
    for (const guess of guesses) {
      if (!guess.pairName) continue;
      const optionId = guess.answerOptionId?.toString();
      if (!optionId || !correctOptionIds.has(optionId)) continue;
      correctByPair.set(guess.pairName, (correctByPair.get(guess.pairName) ?? 0) + 1);
    }

    const bindings = await PairBinding.find(
      { gameId: asObjectId(gameId) },
      { pairName: 1, stationName: 1 },
    ).lean();

    const scores = gamePlayers(bindings, guesses)
      .map((player) => ({
        pairName: player.pairName,
        stationName: player.stationName,
        badgeName: player.pairName,
        correct: correctByPair.get(player.pairName) ?? 0,
        total,
      }))
      .sort(
        (a, b) =>
          b.correct - a.correct || a.pairName.localeCompare(b.pairName),
      );

    return { gameId, scores };
  }

  /**
   * Game, questions (with `openedAt`) and raw guesses for xAPI export
   * (docs/xAPI/xapi-export-plan.md Step 1b/1c). Guesses are scoped to
   * `game.startedAt` like `getGameScores`, so Play Again doesn't re-export
   * a prior run. Every stored `Guess` has a `pairName` and `slotLabel`
   * (`submitGuess` returns early without creating one otherwise), so guesses
   * missing either are dropped rather than emitted half-formed.
   */
  async getGameExportData(gameId: string): Promise<GameExportData | null> {
    const { Game, Question, AnswerOption, Guess } = this.mongoService.getModels();
    const game = await Game.findById(asObjectId(gameId)).lean();
    if (!game) {
      return null;
    }

    const questions = await Question.find({ gameId: asObjectId(gameId) })
      .sort({ sequence: 1 })
      .lean();
    const questionIds = questions.map((q) => q._id as Types.ObjectId);
    const options =
      questionIds.length > 0
        ? await AnswerOption.find({ questionId: { $in: questionIds } }).lean()
        : [];
    const optsByQuestion = new Map<string, typeof options>();
    for (const opt of options) {
      const key = (opt.questionId as Types.ObjectId).toString();
      optsByQuestion.set(key, [...(optsByQuestion.get(key) ?? []), opt]);
    }

    const guessFilter: Record<string, unknown> = { gameId: asObjectId(gameId) };
    if (game.startedAt) {
      guessFilter['createdAt'] = { $gte: game.startedAt };
    }
    const guesses = await Guess.find(guessFilter).lean();

    return {
      id: (game._id as Types.ObjectId).toString(),
      title: game.title,
      state: game.state as GameState,
      startedAt: game.startedAt ? game.startedAt.toISOString() : null,
      endedAt: game.endedAt ? game.endedAt.toISOString() : null,
      questions: questions.map((q) => {
        const qid = (q._id as Types.ObjectId).toString();
        const opts = (optsByQuestion.get(qid) ?? []).slice().sort((a, b) => a.sequence - b.sequence);
        return {
          id: qid,
          text: q.text,
          openedAt: q.openedAt ? q.openedAt.toISOString() : null,
          answerOptions: opts.map((o) => ({
            slotLabel: o.slotLabel as SlotLabel,
            text: o.text,
            isCorrect: o.isCorrect,
          })),
        };
      }),
      guesses: guesses.flatMap((g) => {
        if (!g.pairName || !g.slotLabel) return [];
        return [
          {
            id: (g._id as Types.ObjectId).toString(),
            questionId: (g.questionId as Types.ObjectId).toString(),
            badgeName: g.pairName,
            stationName: g.stationName ?? null,
            slotLabel: g.slotLabel as string,
            createdAt: (g as unknown as { createdAt: Date }).createdAt.toISOString(),
          },
        ];
      }),
    };
  }

  async listGames(): Promise<GameSummary[]> {
    const { Game, Question } = this.mongoService.getModels();
    const games = await Game.find({}).sort({ createdAt: -1 }).lean();
    const gameIds = games.map((g) => g._id);

    const counts = await Question.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { gameId: { $in: gameIds } } },
      { $group: { _id: '$gameId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

    return games.map((g) => ({
      id: (g._id as Types.ObjectId).toString(),
      title: g.title,
      state: g.state as GameState,
      createdAt: (g as unknown as { createdAt: Date }).createdAt.toISOString(),
      startedAt: g.startedAt ? g.startedAt.toISOString() : null,
      endedAt: g.endedAt ? g.endedAt.toISOString() : null,
      questionCount: countMap.get((g._id as Types.ObjectId).toString()) ?? 0,
    }));
  }

  private async guessCountsByQuestionIds(
    questionIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (questionIds.length === 0) {
      return new Map();
    }
    const { Guess } = this.mongoService.getModels();
    const rows = await Guess.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { questionId: { $in: questionIds } } },
      { $group: { _id: '$questionId', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [r._id.toString(), r.count]));
  }

  async getGameDetail(gameId: string): Promise<GameDetail | null> {
    const { Game, Question, AnswerOption, PairBinding } = this.mongoService.getModels();
    const game = await Game.findById(asObjectId(gameId)).lean();
    if (!game) {
      return null;
    }

    const questions = await Question.find({ gameId: asObjectId(gameId) })
      .sort({ sequence: 1 })
      .lean();
    const questionIds = questions.map((q) => q._id as Types.ObjectId);
    const [allOptions, guessCounts] = await Promise.all([
      AnswerOption.find({ questionId: { $in: questionIds } }).lean(),
      this.guessCountsByQuestionIds(questionIds),
    ]);

    const optsByQuestion = new Map<string, typeof allOptions>();
    for (const opt of allOptions) {
      const key = (opt.questionId as Types.ObjectId).toString();
      const arr = optsByQuestion.get(key) ?? [];
      arr.push(opt);
      optsByQuestion.set(key, arr);
    }

    const boundPairs = await PairBinding.find({ gameId: asObjectId(gameId) }).lean();

    return {
      id: (game._id as Types.ObjectId).toString(),
      title: game.title,
      state: game.state as GameState,
      createdAt: (game as unknown as { createdAt: Date }).createdAt.toISOString(),
      startedAt: game.startedAt ? game.startedAt.toISOString() : null,
      endedAt: game.endedAt ? game.endedAt.toISOString() : null,
      questions: questions.map((q) => {
        const qid = (q._id as Types.ObjectId).toString();
        const opts = (optsByQuestion.get(qid) ?? [])
          .slice()
          .sort((a, b) => a.sequence - b.sequence);
        return {
          id: qid,
          text: q.text,
          sequence: q.sequence,
          mode: q.mode as QuestionMode,
          state: q.state,
          closedAt: q.closedAt ? q.closedAt.toISOString() : null,
          guessCount: guessCounts.get(qid) ?? 0,
          answerOptions: opts.map((o) => ({
            id: (o._id as Types.ObjectId).toString(),
            slotLabel: o.slotLabel as SlotLabel,
            text: o.text,
            isCorrect: o.isCorrect,
            sequence: o.sequence,
          })),
        };
      }),
      boundPairs: boundPairs.map((bp) => ({
        pairName: bp.pairName,
        stationName: stationOf(bp),
        joined: bp.joined,
        readyForNextQuestion: bp.readyForNextQuestion ?? null,
        controllerId: bp.controllerId ?? undefined,
      })),
    };
  }

  async getQuestionsByGameId(gameId: string): Promise<QuestionDetail[]> {
    const { Question, AnswerOption } = this.mongoService.getModels();
    const questions = await Question.find({ gameId: asObjectId(gameId) })
      .sort({ sequence: 1 })
      .lean();
    const questionIds = questions.map((q) => q._id as Types.ObjectId);
    const [allOptions, guessCounts] = await Promise.all([
      AnswerOption.find({ questionId: { $in: questionIds } }).lean(),
      this.guessCountsByQuestionIds(questionIds),
    ]);

    const optsByQuestion = new Map<string, typeof allOptions>();
    for (const opt of allOptions) {
      const key = (opt.questionId as Types.ObjectId).toString();
      const arr = optsByQuestion.get(key) ?? [];
      arr.push(opt);
      optsByQuestion.set(key, arr);
    }

    return questions.map((q) => {
      const qid = (q._id as Types.ObjectId).toString();
      const opts = (optsByQuestion.get(qid) ?? [])
        .slice()
        .sort((a, b) => a.sequence - b.sequence);
      return {
        id: qid,
        text: q.text,
        sequence: q.sequence,
        mode: q.mode as QuestionMode,
        state: q.state,
        guessCount: guessCounts.get(qid) ?? 0,
        answerOptions: opts.map((o) => ({
          id: (o._id as Types.ObjectId).toString(),
          slotLabel: o.slotLabel as SlotLabel,
          text: o.text,
          isCorrect: o.isCorrect,
          sequence: o.sequence,
        })),
      };
    });
  }

  private async withOptionalTransaction<T>(
    fn: (session: ClientSession | undefined) => Promise<T>,
  ): Promise<T> {
    const { Game } = this.mongoService.getModels();
    const session = await Game.db.startSession();
    try {
      session.startTransaction();
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
