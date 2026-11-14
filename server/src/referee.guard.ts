import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { authenticate, type AuthedRequest } from './auth';
import { UserRepository } from './persistence/user.repository';

/** A request `RefereeGuard` has let through. */
export type RefereeRequest = AuthedRequest & { refereeUserId?: string };

/**
 * Referee-only writes (docs/xAPI/xapi-export-plan.md, "Users, roles and
 * permissions", Phase 2): 401 `{ error }` without a valid Cognito access
 * token, like `AuthGuard`. It also upserts the caller's `User` and puts its
 * id on `req.refereeUserId`, so handlers take `createdByUserId` from the
 * token, never from the body. In the prototype every signed-in user is a
 * referee; Cognito groups come with Step 0. Station routes don't use it.
 */
@Injectable()
export class RefereeGuard implements CanActivate {
  constructor(private readonly userRepository: UserRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RefereeRequest>();
    const result = await authenticate(req.headers.authorization);
    if (!result.ok) {
      throw new UnauthorizedException({ error: result.error });
    }
    req.auth = result.auth;
    req.refereeUserId = (await this.userRepository.upsertFromAuth(result.auth)).id;
    return true;
  }
}

/** The signed-in referee's `User` id. Needs `RefereeGuard` to have run. */
export function refereeUserIdOf(req: RefereeRequest): string {
  if (!req.refereeUserId) {
    throw new UnauthorizedException({ error: 'Missing token' });
  }
  return req.refereeUserId;
}
