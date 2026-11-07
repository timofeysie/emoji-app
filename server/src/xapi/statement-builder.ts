import { v5 as uuidv5 } from 'uuid';
import { bindingAt, BindingRange, playerLabel } from '../persistence/player.repository';
import type { GameKind } from '../persistence/domain-types';
import {
  BOOK_TYPE,
  bookIri,
  CHAPTER_TYPE,
  chapterIri,
  chapterOfSourceRef,
  EXT_ASPECT,
  EXT_GAME_KIND,
  EXT_ROLE,
  EXT_SCORER,
  EXT_SOURCE_REF,
  EXT_STRENGTH,
  LEARNING_OBJECT_TYPES,
  learningObjectIri,
  parseLearningObjectId,
  qualifiedSourceRef,
  type LearningTag,
} from '../learning/learning-object';
import { CHOICE_WHOLE_SCORER, scoreChoiceWhole, type Observation } from '../learning/observations';
import { ANSWERED_VERB_ID, ASSESSED_VERB_ID, XAPI_BASE_IRI, XAPI_HOMEPAGE } from './iris';

export { XAPI_BASE_IRI, XAPI_HOMEPAGE };
const SCORED_VERB_ID = 'http://adlnet.gov/expapi/verbs/scored';
const CMI_INTERACTION_TYPE = 'http://adlnet.gov/expapi/activities/cmi.interaction';
const ASSESSMENT_TYPE = 'http://adlnet.gov/expapi/activities/assessment';

const EXT_GAME_ID = `${XAPI_BASE_IRI}/ext/game-id`;
const EXT_STATION_NAME = `${XAPI_BASE_IRI}/ext/station-name`;
const EXT_BADGE_NAME = `${XAPI_BASE_IRI}/ext/badge-name`;

/**
 * Fixed namespace for every UUID v5 this module derives (statement `id`s,
 * `context.registration`). Generated once and must never change: changing it
 * would make every id this module derives for the same game/guess/player
 * recompute differently, breaking idempotent re-export of already-sent games
 * (docs/xAPI/LRS.md → "Idempotency and re-export").
 */
const XAPI_UUID_NAMESPACE = '891bcddf-e674-482a-a7b2-28ec1b81586d';

function xapiUuid(name: string): string {
  return uuidv5(name, XAPI_UUID_NAMESPACE);
}

export function gameActivityId(gameId: string): string {
  return `${XAPI_BASE_IRI}/games/${gameId}`;
}

export function questionActivityId(gameId: string, questionId: string): string {
  return `${XAPI_BASE_IRI}/games/${gameId}/questions/${questionId}`;
}

export function gameRegistration(gameId: string): string {
  return xapiUuid(gameId);
}

export function answeredStatementId(gameId: string, guessId: string): string {
  return xapiUuid(`${gameId}:${guessId}:answered`);
}

/** The scorer is in the seed, so re-scoring with a new version never collides (409). */
export function assessedStatementId(
  gameId: string,
  guessId: string,
  learningObjectIri: string,
  aspect: string,
  scorer: string,
): string {
  return xapiUuid(`${gameId}:${guessId}:assessed:${learningObjectIri}:${aspect}:${scorer}`);
}

export function scoredStatementId(gameId: string, playerId: string): string {
  return xapiUuid(`${gameId}:${playerId}:scored`);
}

export type XApiActor = {
  objectType: 'Agent';
  /** Non-identifying label (e.g. "Player 7F3A"); never the player's first name. */
  name: string;
  account: { homePage: string; name: string };
};

/** Actor identity: `account` + `Player.externalId` only — no email, no name (security.md D3). */
export function buildActor(externalId: string): XApiActor {
  return {
    objectType: 'Agent',
    name: playerLabel(externalId),
    account: { homePage: XAPI_HOMEPAGE, name: externalId },
  };
}

export type XApiChoice = { id: string; description: { 'en-US': string } };

export type XApiInteractionDefinition = {
  type: typeof CMI_INTERACTION_TYPE;
  name: { 'en-US': string };
  interactionType: 'choice';
  correctResponsesPattern: string[];
  choices: XApiChoice[];
};

export type XApiAssessmentDefinition = {
  type: typeof ASSESSMENT_TYPE;
  name: { 'en-US': string };
};

export type XApiScore = { raw: number; min: number; max: number; scaled: number };

/** A `context.contextActivities.grouping` entry (learning object, chapter, book). */
export type XApiGroupingActivity = {
  id: string;
  definition: { type: string; name?: Record<string, string> };
};

export type XApiAnsweredStatement = {
  id: string;
  actor: XApiActor;
  verb: { id: typeof ANSWERED_VERB_ID; display: { 'en-US': 'answered' } };
  object: { objectType: 'Activity'; id: string; definition: XApiInteractionDefinition };
  result: { response: string; success: boolean; duration?: string };
  timestamp: string;
  context: {
    registration: string;
    contextActivities: { parent: [{ id: string }]; grouping?: XApiGroupingActivity[] };
    extensions: Record<string, string>;
  };
};

export type XApiScoredStatement = {
  id: string;
  actor: XApiActor;
  verb: { id: typeof SCORED_VERB_ID; display: { 'en-US': 'scored' } };
  object: { objectType: 'Activity'; id: string; definition: XApiAssessmentDefinition };
  result: { score: XApiScore; duration?: string };
  timestamp: string;
  context: { registration: string };
};

/** One observation about one learning object (docs/xAPI/learning-objects.md → A2). */
export type XApiAssessedStatement = {
  id: string;
  actor: XApiActor;
  verb: { id: string; display: { 'en-US': 'was assessed on' } };
  object: { objectType: 'Activity'; id: string; definition: { type: string; name: Record<string, string> } };
  result: { success: boolean };
  timestamp: string;
  context: {
    registration: string;
    /** The `answered` statement this observation was scored from. */
    statement: { objectType: 'StatementRef'; id: string };
    contextActivities: { parent: [{ id: string }]; grouping: XApiGroupingActivity[] };
    extensions: Record<string, string>;
  };
};

export type XApiStatement = XApiAnsweredStatement | XApiAssessedStatement | XApiScoredStatement;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** `end - start`, floored at zero, as an ISO 8601 duration (e.g. `PT4.2S`). */
function isoDuration(start: Date, end: Date): string {
  const seconds = Math.max(0, (end.getTime() - start.getTime()) / 1000);
  return `PT${Math.round(seconds * 10) / 10}S`;
}

export type AnswerOptionInput = {
  slotLabel: string;
  text: string;
  isCorrect: boolean;
};

export type QuestionInput = {
  id: string;
  text: string;
  /** Omit `result.duration` on its guesses when this is missing. */
  openedAt?: Date | string | null;
  /** In the order choices should be shown; not re-sorted. */
  answerOptions: AnswerOptionInput[];
  /** Leitner tag; when absent the statement is exactly the untagged shape. */
  learning?: LearningTag | null;
};

export type GuessInput = {
  id: string;
  questionId: string;
  /** Player key (`Guess.pairName`). */
  badgeName: string;
  stationName?: string | null;
  slotLabel: string;
  createdAt: Date | string;
};

/** One row of `getGameScores`'s `scores` array. */
export type ScoreRow = {
  badgeName: string;
  correct: number;
  total: number;
};

export type PlayerBindingInput = {
  badgeName: string;
  playerId: string;
  assignedAt: Date | string;
  unassignedAt?: Date | string | null;
};

export type PlayerInput = {
  id: string;
  externalId: string;
};

export type GameInput = {
  id: string;
  title: string;
  /** Goes in `ext/game-kind` on tagged statements; defaults to `class`. */
  kind?: GameKind;
  startedAt: Date | string;
  endedAt: Date | string;
};

export type BuildGameStatementsInput = {
  game: GameInput;
  /** Every question in the game, with its answer options. */
  questions: QuestionInput[];
  /** Every `Guess` row for the game's current run — one `answered` statement each. */
  guesses: GuessInput[];
  /** `getGameScores(gameId).scores` — one `scored` statement each. */
  scores: ScoreRow[];
  /** Every `PlayerBinding` row for the game (all badges, full history). */
  playerBindings: PlayerBindingInput[];
  /** Every `Player` referenced by `playerBindings`. */
  players: PlayerInput[];
};

/** A guess or score row's badge has no player binding covering it; export is blocked. */
export class UnattributedBadgeError extends Error {
  constructor(public readonly badgeName: string) {
    super(`Badge '${badgeName}' has no player binding covering this guess; export is blocked.`);
  }
}

function toBindingRange(binding: PlayerBindingInput): PlayerBindingInput & BindingRange {
  return {
    ...binding,
    assignedAt: toDate(binding.assignedAt),
    unassignedAt: binding.unassignedAt ? toDate(binding.unassignedAt) : null,
  };
}

/**
 * The player holding `badgeName` at `at`, per the Step 1a attribution rule
 * (`bindingAt`: a guess belongs to whoever held the badge at the time it was
 * made). Throws `UnattributedBadgeError` rather than silently dropping or
 * misattributing a statement.
 */
function resolvePlayerForBadge(
  badgeName: string,
  at: Date,
  bindingsByBadge: Map<string, PlayerBindingInput[]>,
  externalIdByPlayerId: Map<string, string>,
): { playerId: string; externalId: string } {
  const bindings = (bindingsByBadge.get(badgeName) ?? []).map(toBindingRange);
  const binding = bindingAt(bindings, at);
  const externalId = binding ? externalIdByPlayerId.get(binding.playerId) : undefined;
  if (!binding || !externalId) {
    throw new UnattributedBadgeError(badgeName);
  }
  return { playerId: binding.playerId, externalId };
}

type LearningContext = {
  /** The learning-object activity: `grouping` on `answered`, the object of `assessed`. */
  learningObject: XApiGroupingActivity & { definition: { name: Record<string, string> } };
  /** Chapter and book: where it was taught. */
  provenance: XApiGroupingActivity[];
  sourceRef: string;
  gameKind: GameKind;
};

/**
 * The learning object and its provenance for a tagged question
 * (docs/xAPI/leitner-method.md → Statement changes; learning-objects.md →
 * A1–A3). Throws on a tag that should have been rejected on create.
 */
function learningContext(learning: LearningTag, gameKind: GameKind): LearningContext {
  const key = parseLearningObjectId(learning.learningObjectId);
  const chapter = chapterOfSourceRef(learning.sourceRef);
  if (!key || !chapter) {
    throw new Error(
      `Malformed learning tag '${learning.learningObjectId}' / '${learning.sourceRef}'; it should have been rejected on create.`,
    );
  }
  return {
    learningObject: {
      id: learningObjectIri(key),
      definition: {
        type: LEARNING_OBJECT_TYPES[key.kind],
        name: { [key.language]: learning.target, 'en-US': learning.native },
      },
    },
    provenance: [
      { id: chapterIri(learning.book, chapter), definition: { type: CHAPTER_TYPE } },
      { id: bookIri(learning.book), definition: { type: BOOK_TYPE } },
    ],
    sourceRef: qualifiedSourceRef(learning.book, learning.sourceRef),
    gameKind,
  };
}

export function buildAnsweredStatement(input: {
  gameId: string;
  guess: GuessInput;
  question: QuestionInput;
  externalId: string;
  gameKind?: GameKind;
}): XApiAnsweredStatement {
  const { gameId, guess, question, externalId } = input;
  const learning = question.learning ? learningContext(question.learning, input.gameKind ?? 'class') : null;
  const correctSlotLabels = question.answerOptions
    .filter((option) => option.isCorrect)
    .map((option) => option.slotLabel);
  const chosen = question.answerOptions.find((option) => option.slotLabel === guess.slotLabel);
  if (!chosen) {
    throw new Error(
      `Guess '${guess.id}' chose slot '${guess.slotLabel}', which has no answer option on question '${question.id}'.`,
    );
  }

  const duration = question.openedAt
    ? isoDuration(toDate(question.openedAt), toDate(guess.createdAt))
    : undefined;

  return {
    id: answeredStatementId(gameId, guess.id),
    actor: buildActor(externalId),
    verb: { id: ANSWERED_VERB_ID, display: { 'en-US': 'answered' } },
    object: {
      objectType: 'Activity',
      id: questionActivityId(gameId, question.id),
      definition: {
        type: CMI_INTERACTION_TYPE,
        name: { 'en-US': question.text },
        interactionType: 'choice',
        correctResponsesPattern: correctSlotLabels,
        choices: question.answerOptions.map((option) => ({
          id: option.slotLabel,
          description: { 'en-US': option.text },
        })),
      },
    },
    result: {
      response: guess.slotLabel,
      success: correctSlotLabels.includes(guess.slotLabel),
      ...(duration ? { duration } : {}),
    },
    timestamp: toDate(guess.createdAt).toISOString(),
    context: {
      registration: gameRegistration(gameId),
      contextActivities: {
        parent: [{ id: gameActivityId(gameId) }],
        ...(learning ? { grouping: [learning.learningObject, ...learning.provenance] } : {}),
      },
      extensions: {
        [EXT_GAME_ID]: gameId,
        [EXT_STATION_NAME]: guess.stationName ?? guess.badgeName,
        [EXT_BADGE_NAME]: guess.badgeName,
        ...(learning && question.learning
          ? {
              [EXT_SOURCE_REF]: learning.sourceRef,
              [EXT_ASPECT]: question.learning.aspect,
              [EXT_GAME_KIND]: learning.gameKind,
            }
          : {}),
      },
    },
  };
}

/**
 * One `assessed` statement per observation, about the learning object
 * itself, pointing back at the `answered` statement it was scored from.
 * Same actor, time and registration as that statement.
 */
export function buildAssessedStatement(input: {
  gameId: string;
  guessId: string;
  answered: XApiAnsweredStatement;
  learning: LearningTag;
  gameKind?: GameKind;
  observation: Observation;
  scorer: string;
}): XApiAssessedStatement {
  const { gameId, guessId, answered, observation, scorer } = input;
  if (observation.learningObjectId !== input.learning.learningObjectId) {
    throw new Error(`Observation on '${observation.learningObjectId}' has no names; only the tagged learning object is supported.`);
  }
  const context = learningContext(input.learning, input.gameKind ?? 'class');
  return {
    id: assessedStatementId(gameId, guessId, context.learningObject.id, observation.aspect, scorer),
    actor: answered.actor,
    verb: { id: ASSESSED_VERB_ID, display: { 'en-US': 'was assessed on' } },
    object: { objectType: 'Activity', ...context.learningObject },
    result: { success: observation.success },
    timestamp: answered.timestamp,
    context: {
      registration: answered.context.registration,
      statement: { objectType: 'StatementRef', id: answered.id },
      contextActivities: { parent: [{ id: answered.object.id }], grouping: context.provenance },
      extensions: {
        [EXT_GAME_ID]: gameId,
        [EXT_ASPECT]: observation.aspect,
        [EXT_ROLE]: observation.role,
        [EXT_STRENGTH]: observation.strength,
        [EXT_SOURCE_REF]: context.sourceRef,
        [EXT_GAME_KIND]: context.gameKind,
        [EXT_SCORER]: scorer,
      },
    },
  };
}

export function buildScoredStatement(input: {
  gameId: string;
  gameTitle: string;
  score: ScoreRow;
  playerId: string;
  externalId: string;
  startedAt: Date | string;
  endedAt: Date | string;
}): XApiScoredStatement {
  const { gameId, gameTitle, score, playerId, externalId, startedAt, endedAt } = input;
  const scaled = score.total > 0 ? score.correct / score.total : 0;

  return {
    id: scoredStatementId(gameId, playerId),
    actor: buildActor(externalId),
    verb: { id: SCORED_VERB_ID, display: { 'en-US': 'scored' } },
    object: {
      objectType: 'Activity',
      id: gameActivityId(gameId),
      definition: { type: ASSESSMENT_TYPE, name: { 'en-US': gameTitle } },
    },
    result: {
      score: { raw: score.correct, min: 0, max: score.total, scaled },
      duration: isoDuration(toDate(startedAt), toDate(endedAt)),
    },
    timestamp: toDate(endedAt).toISOString(),
    context: { registration: gameRegistration(gameId) },
  };
}

/**
 * The full statement set for one completed game: one `answered` statement per
 * `Guess` (each followed by its `assessed` statements when the question is
 * tagged), then one `scored` statement per `getGameScores` row. Pure — no
 * network or database calls — so it can be unit-tested and inspected without
 * an LRS. Throws `UnattributedBadgeError` if any guess or score row's badge
 * has no covering `PlayerBinding`; callers should already have checked this
 * via `PlayerRepository.getGamePlayerBindings`'s `missingBadges`. A score row
 * for a badge with no guesses and no player at game end is skipped, so a badge that never
 * joined doesn't block export. One with a player still gets its 0 score.
 */
export function buildGameStatements(input: BuildGameStatementsInput): XApiStatement[] {
  const { game, questions, guesses, scores, playerBindings, players } = input;

  const externalIdByPlayerId = new Map(players.map((player) => [player.id, player.externalId]));
  const bindingsByBadge = new Map<string, PlayerBindingInput[]>();
  for (const binding of playerBindings) {
    bindingsByBadge.set(binding.badgeName, [
      ...(bindingsByBadge.get(binding.badgeName) ?? []),
      binding,
    ]);
  }
  const questionsById = new Map(questions.map((question) => [question.id, question]));

  const statements: XApiStatement[] = [];

  for (const guess of guesses) {
    const question = questionsById.get(guess.questionId);
    if (!question) {
      throw new Error(`Guess '${guess.id}' references unknown question '${guess.questionId}'.`);
    }
    const { externalId } = resolvePlayerForBadge(
      guess.badgeName,
      toDate(guess.createdAt),
      bindingsByBadge,
      externalIdByPlayerId,
    );
    const answered = buildAnsweredStatement({ gameId: game.id, guess, question, externalId, gameKind: game.kind });
    statements.push(answered);
    if (question.learning) {
      for (const observation of scoreChoiceWhole(question.learning, answered.result.success)) {
        statements.push(
          buildAssessedStatement({
            gameId: game.id,
            guessId: guess.id,
            answered,
            learning: question.learning,
            gameKind: game.kind,
            observation,
            scorer: CHOICE_WHOLE_SCORER,
          }),
        );
      }
    }
  }

  // One badge can hold several bindings over a game (swap/replacement); the
  // `scored` row aggregates the whole game, so attribute it to whoever held
  // the badge when the game ended.
  const resolveScoreAt = toDate(game.endedAt);
  const badgesWithGuesses = new Set(guesses.map((guess) => guess.badgeName));
  for (const score of scores) {
    // A bound badge that never played (didn't join, or made no guesses) and
    // has no player has nothing to report; skip it rather than block export.
    if (
      !badgesWithGuesses.has(score.badgeName) &&
      !bindingAt((bindingsByBadge.get(score.badgeName) ?? []).map(toBindingRange), resolveScoreAt)
    ) {
      continue;
    }
    const { playerId, externalId } = resolvePlayerForBadge(
      score.badgeName,
      resolveScoreAt,
      bindingsByBadge,
      externalIdByPlayerId,
    );
    statements.push(
      buildScoredStatement({
        gameId: game.id,
        gameTitle: game.title,
        score,
        playerId,
        externalId,
        startedAt: game.startedAt,
        endedAt: game.endedAt,
      }),
    );
  }

  return statements;
}
