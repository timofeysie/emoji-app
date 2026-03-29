import type { RequestHandler } from 'express';
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
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (disableAuth) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  const token = header.slice(7);

  jwt.verify(
    token,
    getSigningKey,
    {
      algorithms: ['RS256'],
      issuer: expectedIssuer,
    },
    (err, decoded) => {
      if (err || !decoded || typeof decoded === 'string') {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }

      const payload = decoded as CognitoAccessPayload;
      if (payload.token_use !== 'access') {
        res.status(401).json({ error: 'Invalid token type' });
        return;
      }
      if (payload.client_id !== appClientId) {
        res.status(401).json({ error: 'Invalid token audience' });
        return;
      }

      next();
    },
  );
};
