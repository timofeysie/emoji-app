/** Values accepted by `POST /api/status` (device-reported). */
export type DeviceBleStatus =
  | 'startup'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected';

export type StatusChangedEvent = {
  controllerId: string;
  badgeId: string;
  bleStatus: DeviceBleStatus;
  /** Server UTC (canonical). */
  timestamp: string;
  /** Optional device hint when clock was wrong; not used for ordering. */
  clientTimestamp?: string;
  /** Shared pair label from pair_config.py, e.g. "white". */
  pairName?: string;
  /** Roster slot this status describes (Pico PAIR_NAME). */
  badgeName?: string;
  /** Full controller roster from pair_config.BADGE_NAMES. */
  badgeNames?: string[];
  /** Zero script version, e.g. "0.5.8". */
  controllerVersion?: string;
  /** Pico badge script version parsed from PAIR_OK handshake, e.g. "0.3.2". */
  picoVersion?: string;
  /** Controller battery level 0–100 from INA219; absent when unavailable. */
  batteryLevel?: number | null;
};

export type EmojiSentEvent = {
  controllerId: string;
  badgeId: string;
  menu: number;
  pos: number;
  neg: number;
  label: string;
  /** Server UTC (canonical). */
  timestamp: string;
  clientTimestamp?: string;
  pairName?: string;
  badgeName?: string;
};

/** One roster slot. `status` is undefined until the Zero has posted for that name. */
export type StationSlot = {
  badgeName: string;
  status?: StatusChangedEvent;
};

/** One controller `pairName` (one player) and its configured badges. */
export type StationRecord = {
  pairName: string;
  controllerId: string;
  controllerVersion?: string;
  batteryLevel?: number | null;
  /** Slot order. Reported by the Zero, or the slots seen so far. */
  badgeNames: string[];
  rosterReported: boolean;
  slots: Record<string, StationSlot>;
  /** Last station-scoped emoji; every connected badge shows it. */
  emoji?: EmojiSentEvent;
};

export type StationsByName = Record<string, StationRecord>;

type FlatBadgeSnapshot = {
  key: string;
  controllerId: string;
  badgeId: string;
  status: StatusChangedEvent | null;
  emoji: EmojiSentEvent | null;
};

type StationSnapshot = {
  pairName: string;
  controllerId: string;
  controllerVersion: string | null;
  batteryLevel: number | null;
  badgeNames: string[];
  emoji: EmojiSentEvent | null;
  badges: Array<{
    badgeName: string;
    badgeId: string | null;
    bleStatus: DeviceBleStatus;
    picoVersion: string | null;
    timestamp: string | null;
  }>;
};

export type BadgesSnapshotResponse = {
  badges: FlatBadgeSnapshot[];
  /** Absent on servers older than multi-badge Milestone 4. */
  stations?: StationSnapshot[];
};

/** Same rule as the server: station `pairName`, else `controllerId`. */
export function stationNameOf(event: { pairName?: string; controllerId: string }): string {
  return event.pairName || event.controllerId;
}

/** Same rule as the server: slot `badgeName`, else the station name (Mode 1). */
export function slotNameOf(event: {
  badgeName?: string;
  pairName?: string;
  controllerId: string;
}): string {
  return event.badgeName || stationNameOf(event);
}

function emptyStation(pairName: string, controllerId: string): StationRecord {
  return {
    pairName,
    controllerId,
    badgeNames: [],
    rosterReported: false,
    slots: {},
  };
}

export function applyStatusToStations(
  stations: StationsByName,
  status: StatusChangedEvent,
): StationsByName {
  const pairName = stationNameOf(status);
  const slotName = slotNameOf(status);
  const previous = stations[pairName] ?? emptyStation(pairName, status.controllerId);

  const reported = status.badgeNames?.length ? [...new Set(status.badgeNames)] : null;
  let badgeNames = previous.badgeNames;
  if (reported) {
    badgeNames = reported;
  } else if (!previous.rosterReported && !badgeNames.includes(slotName)) {
    badgeNames = [...badgeNames, slotName];
  }

  return {
    ...stations,
    [pairName]: {
      ...previous,
      controllerId: status.controllerId,
      controllerVersion: status.controllerVersion ?? previous.controllerVersion,
      batteryLevel: status.batteryLevel ?? previous.batteryLevel,
      badgeNames,
      rosterReported: previous.rosterReported || reported != null,
      slots: {
        ...previous.slots,
        [slotName]: { badgeName: slotName, status },
      },
    },
  };
}

export function applyEmojiToStations(
  stations: StationsByName,
  emoji: EmojiSentEvent,
): StationsByName {
  const pairName = stationNameOf(emoji);
  const previous = stations[pairName] ?? emptyStation(pairName, emoji.controllerId);
  const badgeNames = previous.badgeNames.length > 0 ? previous.badgeNames : [pairName];
  return {
    ...stations,
    [pairName]: { ...previous, badgeNames, emoji },
  };
}

function stationsFromServer(snapshots: StationSnapshot[]): StationsByName {
  const next: StationsByName = {};
  for (const snapshot of snapshots) {
    const slots: Record<string, StationSlot> = {};
    for (const slot of snapshot.badges) {
      slots[slot.badgeName] = {
        badgeName: slot.badgeName,
        status:
          slot.timestamp == null
            ? undefined
            : {
                controllerId: snapshot.controllerId,
                badgeId: slot.badgeId ?? 'unknown',
                bleStatus: slot.bleStatus,
                timestamp: slot.timestamp,
                pairName: snapshot.pairName,
                badgeName: slot.badgeName,
                badgeNames: snapshot.badgeNames,
                picoVersion: slot.picoVersion ?? undefined,
              },
      };
    }
    next[snapshot.pairName] = {
      pairName: snapshot.pairName,
      controllerId: snapshot.controllerId,
      controllerVersion: snapshot.controllerVersion ?? undefined,
      batteryLevel: snapshot.batteryLevel,
      badgeNames: snapshot.badgeNames,
      rosterReported: true,
      slots,
      emoji: snapshot.emoji ?? undefined,
    };
  }
  return next;
}

function byTimestamp(a: { timestamp: string }, b: { timestamp: string }): number {
  return a.timestamp.localeCompare(b.timestamp);
}

/** Old servers: replay flat records in time order so the newest status per slot wins. */
function stationsFromFlat(badges: FlatBadgeSnapshot[]): StationsByName {
  let next: StationsByName = {};
  const statuses = badges.flatMap((b) => (b.status ? [b.status] : [])).sort(byTimestamp);
  for (const status of statuses) {
    next = applyStatusToStations(next, status);
  }
  const emojis = badges.flatMap((b) => (b.emoji ? [b.emoji] : [])).sort(byTimestamp);
  for (const emoji of emojis) {
    next = applyEmojiToStations(next, emoji);
  }
  return next;
}

export function stationsFromSnapshot(data: BadgesSnapshotResponse): StationsByName {
  if (Array.isArray(data.stations)) {
    return stationsFromServer(data.stations);
  }
  return Array.isArray(data.badges) ? stationsFromFlat(data.badges) : {};
}

export function sortedStations(stations: StationsByName): StationRecord[] {
  return Object.values(stations).sort((a, b) => a.pairName.localeCompare(b.pairName));
}
