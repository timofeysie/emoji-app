import type { Response } from 'express';
import { BadgeStateService } from './badge-state.service';
import { BadgesController } from './badges.controller';

function fakeResponse() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe('BadgesController', () => {
  let controller: BadgesController;

  beforeEach(() => {
    controller = new BadgesController(new BadgeStateService());
  });

  function postStatus(body: Record<string, unknown>) {
    const res = fakeResponse();
    controller.postStatus(body, res as unknown as Response);
    return res;
  }

  function postEmoji(body: Record<string, unknown>) {
    const res = fakeResponse();
    controller.postEmoji(body, res as unknown as Response);
    return res;
  }

  const roster = ['white', 'white-2', 'white-3'];

  function rosterStatus(badgeName: string, bleStatus: string, extra: Record<string, unknown> = {}) {
    return {
      controllerId: 'zero-1',
      badgeId: 'unknown',
      bleStatus,
      pairName: 'white',
      badgeName,
      badgeNames: roster,
      controllerVersion: '0.7.15',
      batteryLevel: 82,
      ...extra,
    };
  }

  it('keeps a Mode 1 post as one flat badge and a one-slot station', () => {
    const res = postStatus({
      controllerId: 'zero-1',
      badgeId: 'badge-aa-bb',
      bleStatus: 'connected',
      pairName: 'black',
      controllerVersion: '0.6.0',
      picoVersion: '0.4.0',
    });
    expect(res.statusCode).toBe(201);

    const { badges, stations } = controller.getBadges();
    expect(badges).toHaveLength(1);
    expect(badges[0].key).toBe('zero-1::badge-aa-bb');
    expect(stations).toEqual([
      {
        pairName: 'black',
        controllerId: 'zero-1',
        controllerVersion: '0.6.0',
        batteryLevel: null,
        badgeNames: ['black'],
        emoji: null,
        badges: [
          expect.objectContaining({
            badgeName: 'black',
            badgeId: 'badge-aa-bb',
            bleStatus: 'connected',
            picoVersion: '0.4.0',
          }),
        ],
      },
    ]);
  });

  it('returns three roster slots when only one badge is connected', () => {
    postStatus(
      rosterStatus('white', 'connected', { badgeId: 'badge-aa', picoVersion: '0.4.0' }),
    );

    const [station] = controller.getBadges().stations;
    expect(station.badgeNames).toEqual(roster);
    expect(station.batteryLevel).toBe(82);
    expect(station.badges.map((b) => [b.badgeName, b.bleStatus, b.badgeId])).toEqual([
      ['white', 'connected', 'badge-aa'],
      ['white-2', 'disconnected', null],
      ['white-3', 'disconnected', null],
    ]);
    expect(station.badges[1]).toMatchObject({ picoVersion: null, timestamp: null, emoji: null });
  });

  it('updates only the slot named by a later post', () => {
    for (const name of roster) {
      postStatus(rosterStatus(name, 'scanning'));
    }
    postStatus(rosterStatus('white', 'connected', { badgeId: 'badge-aa' }));
    postStatus(
      rosterStatus('white-2', 'connected', { badgeId: 'badge-bb', picoVersion: '0.4.1' }),
    );
    postStatus(
      rosterStatus('white-2', 'disconnected', { badgeId: 'badge-bb', picoVersion: '0.4.1' }),
    );

    const [station] = controller.getBadges().stations;
    expect(station.badges.map((b) => [b.badgeName, b.bleStatus])).toEqual([
      ['white', 'connected'],
      ['white-2', 'disconnected'],
      ['white-3', 'scanning'],
    ]);
    expect(station.badges[1]).toMatchObject({ badgeId: 'badge-bb', picoVersion: '0.4.1' });
    expect(controller.getBadges().badges).toHaveLength(3);
  });

  it('shows the station emoji on connected slots only', () => {
    postStatus(rosterStatus('white', 'connected', { badgeId: 'badge-aa' }));
    postEmoji({
      controllerId: 'zero-1',
      badgeId: 'badge-aa',
      menu: 2,
      pos: 1,
      neg: 0,
      label: 'finn',
      pairName: 'white',
      badgeName: 'white',
    });

    const [station] = controller.getBadges().stations;
    expect(station.emoji?.label).toBe('finn');
    expect(station.badges[0].emoji?.label).toBe('finn');
    expect(station.badges[1].emoji).toBeNull();
  });

  it('keeps battery when a later post omits it', () => {
    postStatus(rosterStatus('white', 'connected'));
    postStatus(rosterStatus('white-2', 'connected', { batteryLevel: undefined }));

    expect(controller.getBadges().stations[0].batteryLevel).toBe(82);
  });

  it('rejects a malformed roster', () => {
    const res = postStatus(rosterStatus('white', 'connected', { badgeNames: ['white', ''] }));
    expect(res.statusCode).toBe(400);
    expect(controller.getBadges().stations).toEqual([]);
  });
});
