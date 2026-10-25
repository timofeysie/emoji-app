import { Injectable } from '@nestjs/common';
import { getBookContent } from '../learning/book-content';
import { compareTracks, foldTracks, observationsFromStatements, type TrackChange } from '../learning/leitner';
import { fetchStudentEvidence } from '../learning/student-evidence';
import { GameDataRepository } from '../persistence/game-data.repository';
import { PlayerRepository } from '../persistence/player.repository';
import {
  loadLrsConfigFromEnv,
  LrsConflictError,
  LrsRequestError,
  sendStatements,
  type LrsConfig,
} from './lrs-client';
import { buildGameStatements, UnattributedBadgeError, type XApiStatement } from './statement-builder';

/** End-of-game summary for a Leitner game (docs/xAPI/leitner-method.md → lifecycle). */
export type LeitnerGameSummary = {
  score: { correct: number; total: number };
  /** Null when the student's earlier evidence couldn't be read; the export still counts. */
  changes: TrackChange[] | null;
};

export type GameExportOutcome =
  | {
      ok: true;
      statementsSent: number;
      /** Leitner games are deleted once the LRS has every statement (L10). */
      deleted: boolean;
      summary: LeitnerGameSummary | null;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * A deleted Leitner game's end screen. Kept in memory for a while so the
 * student view (and a reload of it) can still show the results; the LRS
 * has the evidence. A server restart forgets them.
 */
export type FinishedLeitnerGame = {
  gameId: string;
  title: string;
  playerId: string;
  finishedAt: string;
  statementsSent: number;
  summary: LeitnerGameSummary;
};

const FINISHED_KEEP_MS = 12 * 60 * 60 * 1000;
const FINISHED_MAX = 200;

function failure(status: number, body: Record<string, unknown>): GameExportOutcome {
  return { ok: false, status, body };
}

/**
 * Builds and sends one completed game's statements (docs/xAPI/xapi-export-plan.md
 * Step 1c). Class games: manual, and kept. Leitner games: also run on
 * completion; success deletes the game, failure keeps it as pending export.
 */
@Injectable()
export class GameExportService {
  private readonly finished = new Map<string, FinishedLeitnerGame>();

  constructor(
    private readonly gameDataRepository: GameDataRepository,
    private readonly playerRepository: PlayerRepository,
  ) {}

  async exportGame(gameId: string): Promise<GameExportOutcome> {
    const game = await this.gameDataRepository.getGameExportData(gameId);
    if (!game) {
      return failure(404, { error: 'Game not found' });
    }
    if (game.state !== 'completed') {
      return failure(400, { error: `Game must be completed to export; current state is '${game.state}'.` });
    }
    if (!game.startedAt || !game.endedAt) {
      return failure(400, { error: 'Game has no startedAt/endedAt; cannot export.' });
    }

    if (game.kind === 'leitner-solo') {
      // One student: a badge that answered without a player was theirs.
      await this.playerRepository.attributeLeitnerGuesses(gameId);
    }
    const { missingBadges, bindings } = await this.playerRepository.getGamePlayerBindings(gameId);
    if (missingBadges.length > 0) {
      return this.leitnerFailure(game.kind, gameId, 400, {
        error: 'Every badge that recorded a guess must have an assigned player before export.',
        missingBadges,
      });
    }

    const { scores } = await this.gameDataRepository.getGameScores(gameId);
    const playersById = new Map(bindings.map((b) => [b.player.id, b.player]));

    let statements: XApiStatement[];
    try {
      statements = buildGameStatements({
        game: { id: game.id, title: game.title, kind: game.kind, startedAt: game.startedAt, endedAt: game.endedAt },
        questions: game.questions,
        guesses: game.guesses,
        scores,
        playerBindings: bindings.map((b) => ({
          badgeName: b.badgeName,
          playerId: b.player.id,
          assignedAt: b.assignedAt,
          unassignedAt: b.unassignedAt,
        })),
        players: [...playersById.values()].map((p) => ({ id: p.id, externalId: p.externalId })),
      });
    } catch (error) {
      if (error instanceof UnattributedBadgeError) {
        return this.leitnerFailure(game.kind, gameId, 400, { error: error.message });
      }
      throw error;
    }

    let lrsConfig: LrsConfig;
    try {
      lrsConfig = loadLrsConfigFromEnv();
    } catch (error) {
      return this.leitnerFailure(game.kind, gameId, 500, { error: String((error as Error).message) });
    }

    // Read the student's earlier evidence first, for the summary. Optional:
    // a failed read never blocks the export.
    const prior =
      game.kind === 'leitner-solo' && game.leitner ? await this.priorEvidence(lrsConfig, game.leitner) : null;

    let sent: number;
    try {
      ({ sent } = await sendStatements(lrsConfig, statements));
    } catch (error) {
      if (error instanceof LrsConflictError) {
        return this.leitnerFailure(game.kind, gameId, 409, {
          error:
            'This game was already exported with a different statement shape. Re-exporting with changed content is rejected by the LRS.',
          lrsMessage: error.body,
        });
      }
      if (error instanceof LrsRequestError) {
        return this.leitnerFailure(game.kind, gameId, 502, {
          error: 'LRS rejected the export',
          status: error.status,
          lrsMessage: error.body,
        });
      }
      return this.leitnerFailure(game.kind, gameId, 502, { error: 'Failed to reach the LRS', message: String(error) });
    }

    if (game.kind !== 'leitner-solo') {
      return { ok: true, statementsSent: sent, deleted: false, summary: null };
    }

    const score = scores.reduce(
      (total, row) => ({ correct: total.correct + row.correct, total: total.total + row.total }),
      { correct: 0, total: 0 },
    );
    const summary: LeitnerGameSummary = {
      score,
      changes: prior ? this.changes(prior, statements, game.questions) : null,
    };
    await this.gameDataRepository.deleteGame(gameId);
    if (game.leitner) {
      this.rememberFinished({
        gameId,
        title: game.title,
        playerId: game.leitner.playerId,
        finishedAt: new Date().toISOString(),
        statementsSent: sent,
        summary,
      });
    }
    return { ok: true, statementsSent: sent, deleted: true, summary };
  }

  /** The end screen of a Leitner game deleted in the last 12 hours, or null. */
  getFinished(gameId: string, now = Date.now()): FinishedLeitnerGame | null {
    const entry = this.finished.get(gameId);
    if (!entry) return null;
    if (now - Date.parse(entry.finishedAt) > FINISHED_KEEP_MS) {
      this.finished.delete(gameId);
      return null;
    }
    return entry;
  }

  private rememberFinished(entry: FinishedLeitnerGame): void {
    this.finished.set(entry.gameId, entry);
    // Oldest first (insertion order): drop the oldest beyond the cap.
    while (this.finished.size > FINISHED_MAX) {
      const oldest = this.finished.keys().next().value;
      if (oldest === undefined) break;
      this.finished.delete(oldest);
    }
  }

  private async priorEvidence(
    config: LrsConfig,
    leitner: { playerId: string; book: string },
  ): Promise<{ statements: unknown[]; language: string } | null> {
    try {
      const player = await this.playerRepository.getPlayer(leitner.playerId);
      if (!player) return null;
      const { language } = getBookContent(leitner.book);
      const { statements } = await fetchStudentEvidence(config, player.externalId, language);
      return { statements, language };
    } catch {
      return null;
    }
  }

  /** Before = earlier evidence without this game's; after = both (a retry may already be in the LRS). */
  private changes(
    prior: { statements: unknown[]; language: string },
    sent: XApiStatement[],
    questions: Array<{ learning: { learningObjectId: string; aspect: string } | null }>,
  ): TrackChange[] {
    const sentIds = new Set(sent.map((statement) => statement.id));
    const earlier = prior.statements.filter(
      (statement) => !sentIds.has((statement as { id?: string } | null)?.id ?? ''),
    );
    const before = foldTracks(observationsFromStatements(earlier, prior.language));
    const after = foldTracks(observationsFromStatements([...earlier, ...sent], prior.language));
    const keys = questions.flatMap((question) => (question.learning ? [question.learning] : []));
    return compareTracks(before, after, keys);
  }

  private async leitnerFailure(
    kind: string,
    gameId: string,
    status: number,
    body: Record<string, unknown>,
  ): Promise<GameExportOutcome> {
    if (kind === 'leitner-solo') {
      await this.gameDataRepository.recordExportFailure(gameId, String(body['error']));
    }
    return failure(status, body);
  }
}
