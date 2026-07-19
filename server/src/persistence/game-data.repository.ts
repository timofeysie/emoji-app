import { Injectable } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { MongoService } from './mongo.service';
import { GameState, PlayMode, QuestionMode, SlotLabel } from './domain-types';
import { asObjectId } from './models';

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
  pairName?: string;
  badgeId?: string;
  cardUid: string;
  slotLabel?: SlotLabel;
};

export type BindPairInput = {
  pairName: string;
  gameId: string;
  controllerId?: string;
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
  answerOptions: AnswerOptionDetail[];
};

export type BoundPairSummary = {
  pairName: string;
  joined: boolean;
  controllerId?: string;
};

export type QuestionResultPayload = {
  gameId: string;
  questionId: string;
  correctSlotLabel: string;
  results: Array<{ pairName: string; slotLabel: string | null; isCorrect: boolean }>;
};

export type GameScoresPayload = {
  gameId: string;
  scores: Array<{ pairName: string; correct: number; total: number }>;
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

export type PairBindingSnapshot = {
  pairName: string;
  controllerId: string | undefined;
  gameId: string | null;
  state: GameState | null;
  joined: boolean;
  openQuestionId: string | null;
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
  ): Promise<{ guessId: string; answerOptionId: string; slotLabel: string; isCorrect: boolean }> {
    const { Question, AnswerOption, Guess, GameNfcCardGroupAssignment, NfcCard } =
      this.mongoService.getModels();

    return this.withOptionalTransaction(async (session) => {
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

      if (assignment) {
        // MongoDB path — card group assigned; resolve slot via NfcCard document.
        const nfcCard = await NfcCard.findOne(
          { groupId: assignment.groupId, cardUid: input.cardUid, status: 'active' },
          undefined,
          { session },
        ).lean();
        if (!nfcCard) {
          throw new Error('Scanned card does not exist in active game card group.');
        }
        resolvedSlotLabel = nfcCard.slotLabel as SlotLabel;
      } else if (input.slotLabel) {
        // Fallback path — no card group assigned; trust the slotLabel supplied
        // by the Zero (resolved from its local NFC_CARD_MAP). The MongoDB card
        // group path is bypassed entirely for the demo.
        resolvedSlotLabel = input.slotLabel;
      } else {
        throw new Error(
          'No active NFC card group is assigned to this game and no slotLabel was provided.',
        );
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
        throw new Error('No answer option is mapped to scanned slot label for this question.');
      }

      const guess = await Guess.create(
        [
          {
            gameId: asObjectId(input.gameId),
            questionId: asObjectId(input.questionId),
            answerOptionId: answerOption._id,
            ...(input.guesserUserId ? { guesserUserId: asObjectId(input.guesserUserId) } : {}),
            ...(input.pairName ? { pairName: input.pairName } : {}),
            ...(input.badgeId ? { badgeId: asObjectId(input.badgeId) } : {}),
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
      };
    });
  }

  async setGameState(input: { gameId: string; state: GameState }): Promise<{ gameId: string; state: GameState }> {
    const { Game } = this.mongoService.getModels();
    const game = await Game.findById(asObjectId(input.gameId)).lean();
    if (!game) {
      throw new Error('Game not found.');
    }

    const allowedTransitions: Partial<Record<GameState, GameState[]>> = {
      draft:     ['lobby'],
      lobby:     ['active', 'cancelled'],
      active:    ['paused', 'completed', 'cancelled'],
      paused:    ['active', 'cancelled'],
      completed: ['draft'],
      cancelled: ['draft'],
    };

    const allowed = allowedTransitions[game.state as GameState] ?? [];
    if (!allowed.includes(input.state)) {
      throw new Error(`Cannot transition game from '${game.state}' to '${input.state}'.`);
    }

    if (input.state === 'draft' && (game.state === 'completed' || game.state === 'cancelled')) {
      const { Question, PairBinding } = this.mongoService.getModels();

      await Game.updateOne(
        { _id: asObjectId(input.gameId) },
        { $set: { state: 'draft' }, $unset: { startedAt: '', endedAt: '' } },
      );

      await Question.updateMany(
        { gameId: asObjectId(input.gameId) },
        { $set: { state: 'closed' }, $unset: { openedAt: '', closedAt: '' } },
      );

      await PairBinding.updateMany(
        { gameId: asObjectId(input.gameId) },
        { $set: { joined: false, updatedAt: new Date() } },
      );

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

  async bindPair(input: BindPairInput): Promise<void> {
    const { PairBinding } = this.mongoService.getModels();
    await PairBinding.updateOne(
      { pairName: input.pairName },
      {
        $set: {
          gameId: new Types.ObjectId(input.gameId),
          joined: false,
          updatedAt: new Date(),
          ...(input.controllerId ? { controllerId: input.controllerId } : {}),
        },
        $setOnInsert: { pairName: input.pairName },
      },
      { upsert: true },
    );
  }

  async getBinding(pairName: string): Promise<PairBindingSnapshot | null> {
    const { PairBinding, Game, Question } = this.mongoService.getModels();
    const binding = await PairBinding.findOne({ pairName }).lean();
    if (!binding) {
      return null;
    }

    const gameId = binding.gameId ? (binding.gameId as Types.ObjectId).toString() : null;
    let state: GameState | null = null;
    let openQuestionId: string | null = null;

    if (gameId) {
      const game = await Game.findById(binding.gameId).lean();
      if (game) {
        state = game.state as GameState;
        const openQuestion = await Question.findOne({ gameId: binding.gameId, state: 'open' }).lean();
        openQuestionId = openQuestion ? (openQuestion._id as Types.ObjectId).toString() : null;
      }
    }

    return {
      pairName: binding.pairName,
      controllerId: binding.controllerId ?? undefined,
      gameId,
      state,
      joined: binding.joined,
      openQuestionId,
    };
  }

  async markJoined(pairName: string): Promise<void> {
    const { PairBinding } = this.mongoService.getModels();
    await PairBinding.updateOne({ pairName }, { $set: { joined: true, updatedAt: new Date() } });
  }

  async getBindingsByGameId(gameId: string): Promise<string[]> {
    const { PairBinding } = this.mongoService.getModels();
    const bindings = await PairBinding.find({ gameId: new Types.ObjectId(gameId) }, { pairName: 1 }).lean();
    return bindings.map((b) => b.pairName);
  }

  /**
   * Build per-pair correct/wrong outcomes for a closed question.
   * Includes every bound pair; `slotLabel: null` means no guess was submitted.
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
      { pairName: 1 },
    ).lean();

    const correctSlotLabel = correct.slotLabel as string;
    const results = bindings.map((binding) => {
      const slotLabel = guessByPair.has(binding.pairName)
        ? guessByPair.get(binding.pairName) ?? null
        : null;
      return {
        pairName: binding.pairName,
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
   * Cumulative correct-guess counts per bound pair.
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
      { pairName: 1 },
    ).lean();

    const scores = bindings
      .map((binding) => ({
        pairName: binding.pairName,
        correct: correctByPair.get(binding.pairName) ?? 0,
        total,
      }))
      .sort(
        (a, b) =>
          b.correct - a.correct || a.pairName.localeCompare(b.pairName),
      );

    return { gameId, scores };
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

  async getGameDetail(gameId: string): Promise<GameDetail | null> {
    const { Game, Question, AnswerOption, PairBinding } = this.mongoService.getModels();
    const game = await Game.findById(asObjectId(gameId)).lean();
    if (!game) {
      return null;
    }

    const questions = await Question.find({ gameId: asObjectId(gameId) })
      .sort({ sequence: 1 })
      .lean();
    const questionIds = questions.map((q) => q._id);
    const allOptions = await AnswerOption.find({ questionId: { $in: questionIds } }).lean();

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
        const opts = (optsByQuestion.get((q._id as Types.ObjectId).toString()) ?? [])
          .slice()
          .sort((a, b) => a.sequence - b.sequence);
        return {
          id: (q._id as Types.ObjectId).toString(),
          text: q.text,
          sequence: q.sequence,
          mode: q.mode as QuestionMode,
          state: q.state,
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
        joined: bp.joined,
        controllerId: bp.controllerId ?? undefined,
      })),
    };
  }

  async getQuestionsByGameId(gameId: string): Promise<QuestionDetail[]> {
    const { Question, AnswerOption } = this.mongoService.getModels();
    const questions = await Question.find({ gameId: asObjectId(gameId) })
      .sort({ sequence: 1 })
      .lean();
    const questionIds = questions.map((q) => q._id);
    const allOptions = await AnswerOption.find({ questionId: { $in: questionIds } }).lean();

    const optsByQuestion = new Map<string, typeof allOptions>();
    for (const opt of allOptions) {
      const key = (opt.questionId as Types.ObjectId).toString();
      const arr = optsByQuestion.get(key) ?? [];
      arr.push(opt);
      optsByQuestion.set(key, arr);
    }

    return questions.map((q) => {
      const opts = (optsByQuestion.get((q._id as Types.ObjectId).toString()) ?? [])
        .slice()
        .sort((a, b) => a.sequence - b.sequence);
      return {
        id: (q._id as Types.ObjectId).toString(),
        text: q.text,
        sequence: q.sequence,
        mode: q.mode as QuestionMode,
        state: q.state,
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
