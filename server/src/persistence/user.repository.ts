import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { MongoService } from './mongo.service';
import { asObjectId } from './models';

export type UserSummary = {
  id: string;
  displayName: string;
  /** The player this user practises as, or null. */
  playerId: string | null;
};

/** Another user already practises as this player. */
export class PlayerAlreadyLinkedError extends Error {}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}

function toUserSummary(user: { _id: unknown; displayName: string; playerId?: unknown }): UserSummary {
  return {
    id: (user._id as Types.ObjectId).toString(),
    displayName: user.displayName,
    playerId: user.playerId ? (user.playerId as Types.ObjectId).toString() : null,
  };
}

/** People who log in (security.md D1, D14). Created on their first authenticated request. */
@Injectable()
export class UserRepository {
  constructor(private readonly mongoService: MongoService) {}

  /** The user for a Cognito `sub`, created the first time it's seen. */
  async upsertFromAuth(input: { sub: string; username: string }): Promise<UserSummary> {
    const { User } = this.mongoService.getModels();
    const user = await User.findOneAndUpdate(
      { authProviderId: input.sub },
      { $setOnInsert: { authProviderId: input.sub, displayName: input.username } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    if (!user) {
      throw new Error(`Could not create the user for ${input.sub}`);
    }
    return toUserSummary(user);
  }

  /**
   * Links the user to a player, or unlinks them (`null`).
   * @throws PlayerAlreadyLinkedError when another user practises as that player
   */
  async setPlayer(userId: string, playerId: string | null): Promise<UserSummary> {
    const { User } = this.mongoService.getModels();
    try {
      const user = await User.findByIdAndUpdate(
        asObjectId(userId),
        { $set: { playerId: playerId ? asObjectId(playerId) : null } },
        { returnDocument: 'after' },
      ).lean();
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      return toUserSummary(user);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new PlayerAlreadyLinkedError('Another user already practises as this player.');
      }
      throw error;
    }
  }
}
