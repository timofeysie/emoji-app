import { CHAT_BODY_LIMIT_BYTES } from './chat-context';
import { ChatContextService } from './chat-context.service';

const RECORD = { fixedTokens: 1000, messageTokens: 200, replyTokens: 50, model: 'gpt-4.1', requestBytes: 4096 };
const T0 = new Date('2026-11-21T00:00:00.000Z');
const hours = (n: number) => new Date(T0.getTime() + n * 60 * 60 * 1000);

describe('ChatContextService', () => {
  it('keeps the latest reading per user and session', () => {
    const service = new ChatContextService();
    service.record('user-1', 'session-a', RECORD, T0);
    service.record('user-1', 'session-a', { ...RECORD, messageTokens: 900 }, hours(1));

    expect(service.get('user-1', 'session-a', hours(1))).toEqual({
      ...RECORD,
      messageTokens: 900,
      totalTokens: 1000 + 900 + 50,
      contextWindow: 1_047_576,
      bodyLimitBytes: CHAT_BODY_LIMIT_BYTES,
      at: hours(1).toISOString(),
    });
  });

  it("doesn't give one user another user's session", () => {
    const service = new ChatContextService();
    service.record('user-1', 'session-a', RECORD, T0);

    expect(service.get('user-2', 'session-a', T0)).toBeUndefined();
  });

  it('reports no window for an unknown model', () => {
    const service = new ChatContextService();
    service.record('user-1', 'session-a', { ...RECORD, model: 'some-new-model' }, T0);

    expect(service.get('user-1', 'session-a', T0)?.contextWindow).toBeNull();
  });

  it('forgets sessions after six hours', () => {
    const service = new ChatContextService();
    service.record('user-1', 'old', RECORD, T0);
    service.record('user-1', 'new', RECORD, hours(5));

    expect(service.get('user-1', 'old', hours(6.5))).toBeUndefined();
    expect(service.get('user-1', 'new', hours(6.5))).toBeDefined();
  });
});
