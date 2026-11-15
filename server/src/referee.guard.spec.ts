import type { ExecutionContext, HttpException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { UserRepository } from './persistence/user.repository';

jest.mock('jsonwebtoken', () => ({ __esModule: true, default: { verify: jest.fn() } }));
// The real client pulls in ESM-only `jose`; signing keys never matter here because `verify` is mocked.
jest.mock('jwks-rsa', () => ({ __esModule: true, default: () => ({ getSigningKey: jest.fn() }) }));

type GuardModule = typeof import('./referee.guard');
type Req = { headers: Record<string, string>; auth?: unknown; refereeUserId?: string };

/** `auth.ts` reads its env when loaded, so each case loads a fresh copy. */
function loadGuard(env: Record<string, string>): GuardModule {
  process.env = { ...originalEnv, ...env };
  let loaded: GuardModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<GuardModule>('./referee.guard');
  });
  return loaded!;
}

function contextFor(req: Req): ExecutionContext {
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
const USER_ID = '507f1f77bcf86cd799439012';

describe('RefereeGuard', () => {
  const users = { upsertFromAuth: jest.fn() };
  const userRepository = users as unknown as UserRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    users.upsertFromAuth.mockResolvedValue({ id: USER_ID });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects a request without a token and looks up no user', async () => {
    const { RefereeGuard } = loadGuard(cognitoEnv);

    const thrown = await new RefereeGuard(userRepository).canActivate(contextFor({ headers: {} })).then(
      () => undefined,
      (reason: HttpException) => reason,
    );

    expect(thrown?.getStatus()).toBe(401);
    expect(thrown?.getResponse()).toEqual({ error: 'Missing token' });
    expect(users.upsertFromAuth).not.toHaveBeenCalled();
  });

  it('puts the signed-in user id on the request', async () => {
    const { RefereeGuard } = loadGuard(cognitoEnv);
    verify.mockImplementation((_token, _key, _options, callback) =>
      callback(null, { sub: 'user-1', username: 'timo', token_use: 'access', client_id: 'client-1' }),
    );
    const req: Req = { headers: { authorization: 'Bearer token' } };

    await expect(new RefereeGuard(userRepository).canActivate(contextFor(req))).resolves.toBe(true);

    expect(users.upsertFromAuth).toHaveBeenCalledWith({ sub: 'user-1', username: 'timo' });
    expect(req.auth).toEqual({ sub: 'user-1', username: 'timo' });
    expect(req.refereeUserId).toBe(USER_ID);
  });

  it('uses the local-dev user when auth is disabled', async () => {
    const { RefereeGuard } = loadGuard({ DISABLE_AUTH: 'true', NODE_ENV: 'test' });
    const req: Req = { headers: {} };

    await expect(new RefereeGuard(userRepository).canActivate(contextFor(req))).resolves.toBe(true);

    expect(users.upsertFromAuth).toHaveBeenCalledWith({ sub: 'local-dev', username: 'local-dev' });
    expect(req.refereeUserId).toBe(USER_ID);
  });

  it('refereeUserIdOf refuses a request the guard never saw', () => {
    const { refereeUserIdOf } = loadGuard(cognitoEnv);

    expect(() => refereeUserIdOf({ headers: {} } as never)).toThrow();
  });
});
