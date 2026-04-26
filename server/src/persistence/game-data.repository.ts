import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { MongoService } from './mongo.service';
import { PlayMode, QuestionMode, SlotLabel } from './domain-types';
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
  guesserUserId: string;
  badgeId?: string;
  cardUid: string;
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
    assignedByUserId: string;
  }): Promise<void> {
    const { GameNfcCardGroupAssignment } = this.mongoService.getModels();
    await GameNfcCardGroupAssignment.updateMany(
      { gameId: asObjectId(input.gameId), status: 'active' },
      { $set: { status: 'superseded', unassignedAt: new Date() } },
    );
    await GameNfcCardGroupAssignment.create({
      gameId: asObjectId(input.gameId),
      groupId: asObjectId(input.groupId),
      assignedByUserId: asObjectId(input.assignedByUserId),
      status: 'active',
      assignedAt: new Date(),
    });
  }

  async submitGuess(input: SubmitGuessInput): Promise<{ guessId: string; answerOptionId: string }> {
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
      if (!assignment) {
        throw new Error('No active NFC card group is assigned to this game.');
      }

      const nfcCard = await NfcCard.findOne(
        { groupId: assignment.groupId, cardUid: input.cardUid, status: 'active' },
        undefined,
        { session },
      ).lean();
      if (!nfcCard) {
        throw new Error('Scanned card does not exist in active game card group.');
      }

      const answerOption = await AnswerOption.findOne(
        {
          questionId: asObjectId(input.questionId),
          slotLabel: nfcCard.slotLabel,
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
            guesserUserId: asObjectId(input.guesserUserId),
            ...(input.badgeId ? { badgeId: asObjectId(input.badgeId) } : {}),
            cardUid: input.cardUid,
            slotLabel: nfcCard.slotLabel,
          },
        ],
        { session },
      );

      return {
        guessId: guess[0]._id.toString(),
        answerOptionId: answerOption._id.toString(),
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
