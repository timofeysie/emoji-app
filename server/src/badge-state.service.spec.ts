import { BadgeStateService } from './badge-state.service';

function status(badgeNames?: string[], badgeName = 'power-cable') {
  return {
    controllerId: 'zero-1',
    badgeId: 'badge-1',
    bleStatus: 'connected' as const,
    pairName: 'power-cable',
    badgeName,
    ...(badgeNames ? { badgeNames } : {}),
  };
}

describe('BadgeStateService roster changes', () => {
  it('fires on the first roster and on a changed roster, not on a repeat', () => {
    const service = new BadgeStateService();
    const listener = jest.fn();
    service.onRosterChanged(listener);

    service.recordStatus(status(['power-cable', 'black']));
    service.recordStatus(status(['black', 'power-cable'], 'black'));
    service.recordStatus(status(['power-cable']));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 'power-cable', ['power-cable', 'black']);
    expect(listener).toHaveBeenNthCalledWith(2, 'power-cable', ['power-cable']);
    expect(service.getStationRoster('power-cable')).toEqual(['power-cable']);
  });

  it('ignores posts without a roster', () => {
    const service = new BadgeStateService();
    const listener = jest.fn();
    service.onRosterChanged(listener);

    service.recordStatus(status());

    expect(listener).not.toHaveBeenCalled();
  });
});
