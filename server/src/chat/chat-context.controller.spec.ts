import { NotFoundException } from '@nestjs/common';
import type { AuthedRequest } from '../auth';
import { ChatContextController } from './chat-context.controller';
import { ChatContextService } from './chat-context.service';

// The guard is covered in auth.guard.spec.ts; importing the real one needs Cognito env.
jest.mock('../auth.guard', () => ({ AuthGuard: class {} }));

const SESSION = '3f0c8d0e-2b1a-4c5d-9e8f-0a1b2c3d4e5f';
const req = { auth: { sub: 'sub-1', username: 'timo' } } as AuthedRequest;

describe('ChatContextController', () => {
  const service = new ChatContextService();
  const controller = new ChatContextController(service);
  service.record('sub-1', SESSION, { fixedTokens: 10, messageTokens: 5, replyTokens: 2, model: 'gpt-4.1', requestBytes: 100 });

  it("returns the caller's reading", () => {
    expect(controller.getContext(SESSION, req).totalTokens).toBe(17);
  });

  it("404s for another user's session, an unknown session or a malformed id", () => {
    const other = { auth: { sub: 'sub-2', username: 'other' } } as AuthedRequest;
    expect(() => controller.getContext(SESSION, other)).toThrow(NotFoundException);
    expect(() => controller.getContext('3f0c8d0e-2b1a-4c5d-9e8f-000000000000', req)).toThrow(NotFoundException);
    expect(() => controller.getContext('not-a-uuid', req)).toThrow(NotFoundException);
  });
});
