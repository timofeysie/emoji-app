import type { ExecutionContext, HttpException } from '@nestjs/common';
import jwt from 'jsonwebtoken';

jest.mock('jsonwebtoken', () => ({ __esModule: true, default: { verify: jest.fn() } }));
// The real client pulls in ESM-only `jose`; signing keys never matter here because `verify` is mocked.
jest.mock('jwks-rsa', () => ({ __esModule: true, default: () => ({ getSigningKey: jest.fn() }) }));

type GuardModule = typeof import('./auth.guard');

/** `auth.ts` reads its env when loaded, so each case loads a fresh copy. */
function loadGuard(env: Record<string, string>): GuardModule {
  process.env = { ...originalEnv, ...env };
  let loaded: GuardModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<GuardModule>('./auth.guard');
  });
  return loaded!;
}

function contextFor(req: { headers: Record<string, string>; auth?: unknown }): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

const originalEnv = { ...process.env };
const cognitoEnv = {
  DISABLE_AUTH: 'false',
  COGNITO_USER_POOL_ID: 'ap-southeast-2_test',
  COGNITO_REGION: 'ap-southeast-2',
  COGNITO_APP_CLIENT_ID: 'client-1',
};
const verify = jwt.verify as unknown as jest.Mock;

/** A fresh module copy has its own exception classes, so check status and body, not the class. */
async function expectUnauthorized(result: Promise<boolean>, error: string): Promise<void> {
  const thrown = await result.then(
    () => undefined,
    (reason: HttpException) => reason,
  );
  expect(thrown?.getStatus()).toBe(401);
  expect(thrown?.getResponse()).toEqual({ error });
}

describe('AuthGuard', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects a request without a token', async () => {
    const { AuthGuard } = loadGuard(cognitoEnv);

    await expectUnauthorized(new AuthGuard().canActivate(contextFor({ headers: {} })), 'Missing token');
  });

  it('rejects a token for another app client', async () => {
    const { AuthGuard } = loadGuard(cognitoEnv);
    verify.mockImplementation((_token, _key, _options, callback) =>
      callback(null, { sub: 'user-1', token_use: 'access', client_id: 'someone-else' }),
    );

    await expectUnauthorized(
      new AuthGuard().canActivate(contextFor({ headers: { authorization: 'Bearer token' } })),
      'Invalid token audience',
    );
  });

  it('lets a valid access token through and records the caller', async () => {
    const { AuthGuard } = loadGuard(cognitoEnv);
    verify.mockImplementation((_token, _key, _options, callback) =>
      callback(null, { sub: 'user-1', username: 'timo', token_use: 'access', client_id: 'client-1' }),
    );
    const req: { headers: Record<string, string>; auth?: unknown } = { headers: { authorization: 'Bearer token' } };

    await expect(new AuthGuard().canActivate(contextFor(req))).resolves.toBe(true);
    expect(req.auth).toEqual({ sub: 'user-1', username: 'timo' });
  });

  it('treats every request as the local-dev user when auth is disabled', async () => {
    const { AuthGuard } = loadGuard({ DISABLE_AUTH: 'true', NODE_ENV: 'test' });
    const req: { headers: Record<string, string>; auth?: unknown } = { headers: {} };

    await expect(new AuthGuard().canActivate(contextFor(req))).resolves.toBe(true);
    expect(req.auth).toEqual({ sub: 'local-dev', username: 'local-dev' });
  });

  it('ignores DISABLE_AUTH in production', async () => {
    const { AuthGuard } = loadGuard({ ...cognitoEnv, DISABLE_AUTH: 'true', NODE_ENV: 'production' });

    await expectUnauthorized(new AuthGuard().canActivate(contextFor({ headers: {} })), 'Missing token');
  });
});
