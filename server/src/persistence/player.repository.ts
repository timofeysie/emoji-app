import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { MongoService } from './mongo.service';
import { PlayerBindingReason } from './domain-types';
import { asObjectId } from './models';

export type PlayerSummary = {
  id: string;
  firstName: string;
  externalId: string;
  /** Non-identifying label shown next to the name, e.g. "Player 7F3A" (security.md D3). */
  label: string;
};

export type PlayerBindingSummary = {
  id: string;
  badgeName: string;
  player: PlayerSummary;
  assignedAt: string;
  unassignedAt: string | null;
  reason: PlayerBindingReason;
};

export type GamePlayerBindings = {
  gameId: string;
  /** Every badge in the game: bound now, or guessed in the current run. */
  badgeNames: string[];
  /** All bindings, oldest first; active ones have `unassignedAt: null`. */
  bindings: PlayerBindingSummary[];
  /** Badges with a guess in the current run that no binding covers; export is blocked. */
  missingBadges: string[];
};

/** Thrown for unknown players or badges; controllers map it to 404. */
export class PlayerNotFoundError extends Error {}

/** A binding's time range; `unassignedAt: null` means still active. */
export type BindingRange = {
  assignedAt: Date;
  unassignedAt?: Date | null;
};

/**
 * The binding of one badge that covers a guess made at `at`.
 *
 * Bindings are time-ranged, so a mid-game swap doesn't move earlier guesses.
 * The badge's first binding also covers everything before it: the referee may
 * bind after the game (or after the first round), and nobody else held the
 * badge in that time.
 */
export function bindingAt<T extends BindingRange>(bindingsForBadge: T[], at: Date): T | null {
  const sorted = [...bindingsForBadge].sort(
    (a, b) => a.assignedAt.getTime() - b.assignedAt.getTime(),
  );
  const time = at.getTime();
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const binding = sorted[index];
    const starts = index === 0 ? -Infinity : binding.assignedAt.getTime();
    const ends = binding.unassignedAt ? binding.unassignedAt.getTime() : Infinity;
    if (time >= starts && time < ends) {
      return binding;
    }
  }
  return null;
}

/** "Player 7F3A": first four hex digits of the external ID. */
export function playerLabel(externalId: string): string {
  return `Player ${externalId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

function toPlayerSummary(player: {
  _id: unknown;
  firstName: string;
  externalId: string;
}): PlayerSummary {
  return {
    id: (player._id as Types.ObjectId).toString(),
    firstName: player.firstName,
    externalId: player.externalId,
    label: playerLabel(player.externalId),
  };
}

@Injectable()
export class PlayerRepository {
  constructor(private readonly mongoService: MongoService) {}

  async createPlayer(input: { firstName: string }): Promise<PlayerSummary> {
    const { Player } = this.mongoService.getModels();
    const player = await Player.create({
      firstName: input.firstName,
      externalId: randomUUID(),
    });
    return toPlayerSummary(player);
  }

  async listPlayers(): Promise<PlayerSummary[]> {
    const { Player } = this.mongoService.getModels();
    const players = await Player.find({}).sort({ firstName: 1 }).lean();
    return players.map(toPlayerSummary);
  }

  /**
   * Bind `badgeName` to a player for this game. Ends the badge's active
   * binding and the player's active binding on another badge first.
   * Reason defaults to `initial` for a badge's first binding, else `swap`.
   */
  async bindPlayer(input: {
    gameId: string;
    badgeName: string;
    playerId: string;
    reason?: PlayerBindingReason;
  }): Promise<PlayerBindingSummary> {
    const { Player, PlayerBinding } = this.mongoService.getModels();
    const gameId = asObjectId(input.gameId);
    const playerId = asObjectId(input.playerId);

    const player = await Player.findById(playerId).lean();
    if (!player) {
      throw new PlayerNotFoundError('Player not found.');
    }
    await this.assertBadgeInGame(input.gameId, input.badgeName);

    const active = await PlayerBinding.findOne({
      gameId,
      badgeName: input.badgeName,
      unassignedAt: null,
    }).lean();
    if (active && (active.playerId as Types.ObjectId).equals(playerId)) {
      return this.toBindingSummary(active, toPlayerSummary(player));
    }

    const hadBinding = await PlayerBinding.exists({ gameId, badgeName: input.badgeName });
    const now = new Date();
    await PlayerBinding.updateMany(
      {
        gameId,
        unassignedAt: null,
        $or: [{ badgeName: input.badgeName }, { playerId }],
      },
      { $set: { unassignedAt: now } },
    );
    const binding = await PlayerBinding.create({
      gameId,
      badgeName: input.badgeName,
      playerId,
      assignedAt: now,
      reason: input.reason ?? (hadBinding ? 'swap' : 'initial'),
    });
    return this.toBindingSummary(binding, toPlayerSummary(player));
  }

  /** End the badge's active binding. Returns false when it had none. */
  async unbindPlayer(input: { gameId: string; badgeName: string }): Promise<boolean> {
    const { PlayerBinding } = this.mongoService.getModels();
    const result = await PlayerBinding.updateOne(
      { gameId: asObjectId(input.gameId), badgeName: input.badgeName, unassignedAt: null },
      { $set: { unassignedAt: new Date() } },
    );
    return result.modifiedCount > 0;
  }

  async getGamePlayerBindings(gameId: string): Promise<GamePlayerBindings> {
    const { Game, Guess, PairBinding, PlayerBinding, Player } = this.mongoService.getModels();
    const game = await Game.findById(asObjectId(gameId)).lean();
    if (!game) {
      throw new PlayerNotFoundError('Game not found.');
    }

    // Same run scoping as getGameScores, so Play Again ignores earlier runs.
    const guessFilter: Record<string, unknown> = { gameId: asObjectId(gameId) };
    if (game.startedAt) {
      guessFilter['createdAt'] = { $gte: game.startedAt };
    }

    const [guesses, pairBindings, bindings] = await Promise.all([
      Guess.find(guessFilter, { pairName: 1, createdAt: 1 }).lean(),
      PairBinding.find({ gameId: asObjectId(gameId) }, { pairName: 1 }).lean(),
      PlayerBinding.find({ gameId: asObjectId(gameId) }).sort({ assignedAt: 1 }).lean(),
    ]);

    const playerIds = [...new Set(bindings.map((b) => (b.playerId as Types.ObjectId).toString()))];
    const players =
      playerIds.length > 0
        ? await Player.find({ _id: { $in: playerIds.map((id) => asObjectId(id)) } }).lean()
        : [];
    const playerById = new Map(
      players.map((p) => [(p._id as Types.ObjectId).toString(), toPlayerSummary(p)]),
    );

    const bindingsByBadge = new Map<string, typeof bindings>();
    for (const binding of bindings) {
      bindingsByBadge.set(binding.badgeName, [
        ...(bindingsByBadge.get(binding.badgeName) ?? []),
        binding,
      ]);
    }

    const missing = new Set<string>();
    for (const guess of guesses) {
      if (!guess.pairName) continue;
      const createdAt = (guess as unknown as { createdAt: Date }).createdAt;
      if (!bindingAt(bindingsByBadge.get(guess.pairName) ?? [], createdAt)) {
        missing.add(guess.pairName);
      }
    }

    const badgeNames = new Set<string>(pairBindings.map((b) => b.pairName));
    for (const guess of guesses) {
      if (guess.pairName) badgeNames.add(guess.pairName);
    }

    return {
      gameId,
      badgeNames: [...badgeNames].sort((a, b) => a.localeCompare(b)),
      bindings: bindings.flatMap((binding) => {
        const player = playerById.get((binding.playerId as Types.ObjectId).toString());
        return player ? [this.toBindingSummary(binding, player)] : [];
      }),
      missingBadges: [...missing].sort((a, b) => a.localeCompare(b)),
    };
  }

  /** The badge is bound to the game now, or has a guess in it. */
  private async assertBadgeInGame(gameId: string, badgeName: string): Promise<void> {
    const { Game, PairBinding, Guess } = this.mongoService.getModels();
    const game = await Game.exists({ _id: asObjectId(gameId) });
    if (!game) {
      throw new PlayerNotFoundError('Game not found.');
    }
    const [bound, guessed] = await Promise.all([
      PairBinding.exists({ gameId: asObjectId(gameId), pairName: badgeName }),
      Guess.exists({ gameId: asObjectId(gameId), pairName: badgeName }),
    ]);
    if (!bound && !guessed) {
      throw new PlayerNotFoundError(`Badge '${badgeName}' is not part of this game.`);
    }
  }

  private toBindingSummary(
    binding: {
      _id: unknown;
      badgeName: string;
      assignedAt: Date;
      unassignedAt?: Date | null;
      reason: string;
    },
    player: PlayerSummary,
  ): PlayerBindingSummary {
    return {
      id: (binding._id as Types.ObjectId).toString(),
      badgeName: binding.badgeName,
      player,
      assignedAt: binding.assignedAt.toISOString(),
      unassignedAt: binding.unassignedAt ? binding.unassignedAt.toISOString() : null,
      reason: binding.reason as PlayerBindingReason,
    };
  }
}
