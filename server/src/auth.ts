import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

/** Only honoured when not in production (NODE_ENV !== 'production'). */
export const disableAuth =
  process.env['DISABLE_AUTH'] === 'true' &&
  process.env['NODE_ENV'] !== 'production';

const poolId = process.env['COGNITO_USER_POOL_ID'];
const region = process.env['COGNITO_REGION'] ?? process.env['AWS_REGION'];
const appClientId = process.env['COGNITO_APP_CLIENT_ID'];

function assertAuthConfig(): void {
  if (disableAuth) {
    return;
  }
  if (!poolId || !region || !appClientId) {
    throw new Error(
      'Missing Cognito env: set COGNITO_USER_POOL_ID, COGNITO_REGION (or AWS_REGION), COGNITO_APP_CLIENT_ID. For local dev without Cognito, set DISABLE_AUTH=true (development only).',
    );
  }
}

assertAuthConfig();

const expectedIssuer =
  poolId && region
    ? `https://cognito-idp.${region}.amazonaws.com/${poolId}`
    : '';

const jwks = poolId && region
  ? jwksClient({
      jwksUri: `https://cognito-idp.${region}.amazonaws.com/${poolId}/.well-known/jwks.json`,
      cache: true,
      rateLimit: true,
    })
  : null;

function getSigningKey(
  header: jwt.JwtHeader,
  callback: jwt.SigningKeyCallback,
): void {
  if (!jwks) {
    callback(new Error('JWKS not configured'));
    return;
  }
  jwks.getSigningKey(header.kid, (err, key) => {
    callback(err, key?.getPublicKey());
  });
}

type CognitoAccessPayload = jwt.JwtPayload & {
  token_use?: string;
  client_id?: string;
  username?: string;
};

/** Who made a request: the Cognito user (`sub`), or the fixed local-dev identity. */
export type AuthClaims = { sub: string; username: string };

/** Used for every request when `disableAuth` (local dev and e2e only). */
export const LOCAL_DEV_AUTH: AuthClaims = { sub: 'local-dev', username: 'local-dev' };

export type AuthResult = { ok: true; auth: AuthClaims } | { ok: false; error: string };

/** Checks an `Authorization` header: a Cognito access token for our app client. */
export function authenticate(header: string | undefined): Promise<AuthResult> {
  if (disableAuth) {
    return Promise.resolve({ ok: true, auth: LOCAL_DEV_AUTH });
  }
  if (!header?.startsWith('Bearer ')) {
    return Promise.resolve({ ok: false, error: 'Missing token' });
  }

  const token = header.slice(7);
  return new Promise((resolve) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        algorithms: ['RS256'],
        issuer: expectedIssuer,
      },
      (err, decoded) => {
        if (err || !decoded || typeof decoded === 'string') {
          resolve({ ok: false, error: 'Invalid token' });
          return;
        }

        const payload = decoded as CognitoAccessPayload;
        if (payload.token_use !== 'access') {
          resolve({ ok: false, error: 'Invalid token type' });
          return;
        }
        if (payload.client_id !== appClientId) {
          resolve({ ok: false, error: 'Invalid token audience' });
          return;
        }
        if (!payload.sub) {
          resolve({ ok: false, error: 'Invalid token' });
          return;
        }

        resolve({ ok: true, auth: { sub: payload.sub, username: payload.username ?? payload.sub } });
      },
    );
  });
}

/** A request `requireAuth` or `AuthGuard` has let through. */
export type AuthedRequest = Request & { auth?: AuthClaims };

export const requireAuth: RequestHandler = (req, res, next) => {
  void authenticate(req.headers.authorization).then((result) => {
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    (req as AuthedRequest).auth = result.auth;
    next();
  });
};
