import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { authenticate, type AuthedRequest } from './auth';

/**
 * Nest version of `requireAuth`: 401 `{ error }` without a valid Cognito
 * access token, else `req.auth` holds the caller. With `DISABLE_AUTH`
 * (development only) every request is the local-dev identity.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const result = await authenticate(req.headers.authorization);
    if (!result.ok) {
      throw new UnauthorizedException({ error: result.error });
    }
    req.auth = result.auth;
    return true;
  }
}
