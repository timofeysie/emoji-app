import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthClaims, AuthedRequest } from './auth';
import { PlayerRepository, type PlayerSummary } from './persistence/player.repository';
import { UserRepository, type UserSummary } from './persistence/user.repository';

/** What `/api/me` returns: the signed-in user and the player they practise as. */
export type Me = {
  user: { id: string; displayName: string };
  player: Pick<PlayerSummary, 'id' | 'firstName' | 'label'> | null;
};

export type Learner = { user: UserSummary; player: PlayerSummary };

/**
 * The signed-in user, and the player they practise as
 * (docs/yalla/implementation-plan.md §4, security.md D14). The learner always
 * comes from the token, never from a `playerId` in the request.
 */
@Injectable()
export class LearnerService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly playerRepository: PlayerRepository,
  ) {}

  /** Needs `AuthGuard` (or `requireAuth`) to have run. */
  claimsOf(req: AuthedRequest): AuthClaims {
    if (!req.auth) {
      throw new UnauthorizedException({ error: 'Missing token' });
    }
    return req.auth;
  }

  async me(req: AuthedRequest): Promise<{ me: Me; user: UserSummary; player: PlayerSummary | null }> {
    const user = await this.userRepository.upsertFromAuth(this.claimsOf(req));
    // A deleted player leaves a dangling link; treat it as unlinked.
    const player = user.playerId ? await this.playerRepository.getPlayer(user.playerId) : null;
    return {
      me: {
        user: { id: user.id, displayName: user.displayName },
        player: player && { id: player.id, firstName: player.firstName, label: player.label },
      },
      user,
      player,
    };
  }

  /**
   * The user and their linked player, for every `/api/yalla/me/*` route.
   * @throws ForbiddenException (403 `{ error: 'No linked player' }`) without a link
   */
  async resolveLearner(req: AuthedRequest): Promise<Learner> {
    const { user, player } = await this.me(req);
    if (!player) {
      throw new ForbiddenException({ error: 'No linked player' });
    }
    return { user, player };
  }
}
