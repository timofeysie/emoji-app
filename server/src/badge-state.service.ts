import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { WebSocket, WebSocketServer } from 'ws';

const MAX_EMOJI_HISTORY = 100;

export const clientTimestampHintSchema = z.string().datetime({ offset: true }).nullish();

export const deviceBleStatusSchema = z.enum([
  'startup',
  'scanning',
  'connecting',
  'connected',
  'disconnected',
]);

export const statusBodySchema = z.object({
  controllerId: z.string().min(1),
  badgeId: z.string().min(1),
  bleStatus: deviceBleStatusSchema,
  timestamp: clientTimestampHintSchema,
  /** Shared pair label from pair_config.py (e.g. "white"). */
  pairName: z.string().optional(),
  /** Roster slot this post describes (that Pico's PAIR_NAME). Defaults in Milestone 4. */
  badgeName: z.string().min(1).optional(),
  /** Full controller roster; present on every Mode 2 status post. */
  badgeNames: z.array(z.string().min(1)).optional(),
  /** Normalized Zero script version, e.g. "0.5.8". */
  controllerVersion: z.string().optional(),
  /** Pico badge script version parsed from PAIR_OK:<version>, e.g. "0.3.2". */
  picoVersion: z.string().optional(),
  /** Controller battery level 0–100 from INA219; absent when unavailable. */
  batteryLevel: z.number().int().min(0).max(100).nullable().optional(),
});

export const emojiBodySchema = z.object({
  controllerId: z.string().min(1),
  badgeId: z.string().min(1),
  menu: z.number().int(),
  pos: z.number().int(),
  neg: z.number().int(),
  label: z.string().min(1),
  timestamp: clientTimestampHintSchema,
  /** Shared pair label from pair_config.py (e.g. "white"). */
  pairName: z.string().optional(),
  /** Station slot for the emoji echo; station-scoped posts use pairName. */
  badgeName: z.string().min(1).optional(),
});

export type StatusDto = {
  controllerId: string;
  badgeId: string;
  bleStatus: z.infer<typeof deviceBleStatusSchema>;
  timestamp: string;
  clientTimestamp?: string;
  pairName?: string;
  badgeName?: string;
  badgeNames?: string[];
  controllerVersion?: string;
  picoVersion?: string;
  batteryLevel?: number | null;
};

export type EmojiDto = {
  controllerId: string;
  badgeId: string;
  menu: number;
  pos: number;
  neg: number;
  label: string;
  timestamp: string;
  clientTimestamp?: string;
  pairName?: string;
  badgeName?: string;
};

type BadgeStateDto = {
  key: string;
  controllerId: string;
  badgeId: string;
  status: StatusDto | null;
  emoji: EmojiDto | null;
};

/** One roster slot inside a station. `bleStatus` is `disconnected` until a status is seen. */
export type StationBadgeDto = {
  badgeName: string;
  badgeId: string | null;
  bleStatus: z.infer<typeof deviceBleStatusSchema>;
  picoVersion: string | null;
  /** Server UTC of the last status for this slot; null if never seen. */
  timestamp: string | null;
  emoji: EmojiDto | null;
};

/** One controller (`pairName`) and its badge roster in `badgeNames` order. */
export type StationDto = {
  pairName: string;
  controllerId: string;
  controllerVersion: string | null;
  batteryLevel: number | null;
  badgeNames: string[];
  /** Last station-scoped emoji (fanned out to every connected badge). */
  emoji: EmojiDto | null;
  badges: StationBadgeDto[];
};

type SlotState = {
  status: StatusDto | null;
};

type StationState = {
  pairName: string;
  controllerId: string;
  controllerVersion: string | null;
  batteryLevel: number | null;
  /** Roster from the latest post that carried `badgeNames`; null until one does. */
  reportedBadgeNames: string[] | null;
  slots: Map<string, SlotState>;
  emoji: EmojiDto | null;
};

function serverTimestamp(): string {
  return new Date().toISOString();
}

/** Station id: controller `pairName`, or `controllerId` for clients that predate pair names. */
export function resolveStationName(event: { pairName?: string; controllerId: string }): string {
  return event.pairName || event.controllerId;
}

/** Slot id: `badgeName`, else the station name (Mode 1 is a one-slot station). */
export function resolveSlotName(event: {
  badgeName?: string;
  pairName?: string;
  controllerId: string;
}): string {
  return event.badgeName || resolveStationName(event);
}

function knownOrNull(value: string | undefined): string | null {
  return value && value !== 'unknown' ? value : null;
}

function getBadgeKey(controllerId: string, badgeId: string, badgeName?: string): string {
  if (badgeName) {
    return `${controllerId}::${badgeName}`;
  }
  return `${controllerId}::${badgeId}`;
}

export type RealtimeEvent = Record<string, unknown> & { type: string };

export type RosterChangedListener = (stationName: string, badgeNames: string[]) => void;

function sameNames(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name) => b.includes(name));
}

@Injectable()
export class BadgeStateService {
  private readonly bleStatusByBadgeKey = new Map<string, StatusDto>();

  private readonly lastEmojiByBadgeKey = new Map<string, EmojiDto>();

  private readonly emojiEventHistory: EmojiDto[] = [];

  private readonly stationsByName = new Map<string, StationState>();

  private wsServer: WebSocketServer | null = null;

  /** Dashboard browser clients — receive all broadcast events. */
  private readonly dashboards = new Set<WebSocket>();

  /** Controller room: pairName → set of WebSocket connections for that pair. */
  private readonly pairRooms = new Map<string, Set<WebSocket>>();

  /** Reverse lookup: socket → pairName (for cleanup on close). */
  private readonly socketToPair = new Map<WebSocket, string>();

  private readonly rosterListeners: RosterChangedListener[] = [];

  /** Called when a station reports a roster that differs (order ignored) from the last one. */
  onRosterChanged(listener: RosterChangedListener): void {
    this.rosterListeners.push(listener);
  }

  private updateReportedRoster(station: StationState, badgeNames: string[]): void {
    const next = [...new Set(badgeNames)];
    if (next.length === 0) {
      return;
    }
    const previous = station.reportedBadgeNames;
    station.reportedBadgeNames = next;
    if (previous && sameNames(previous, next)) {
      return;
    }
    for (const listener of this.rosterListeners) {
      listener(station.pairName, next);
    }
  }

  setWebSocketServer(wsServer: WebSocketServer): void {
    this.wsServer = wsServer;

    // Ping every 30 s so the ALB never sees a fully idle connection.
    // Browsers and the `websockets` library on the Zero respond with pong automatically.
    const heartbeat = setInterval(() => {
      for (const client of wsServer.clients) {
        if (client.readyState === client.OPEN) {
          client.ping();
        }
      }
    }, 30_000);

    wsServer.on('close', () => clearInterval(heartbeat));

    wsServer.on('connection', (socket: WebSocket) => {
      // Classify as dashboard until a controller.hello arrives
      this.dashboards.add(socket);

      socket.on('message', (raw) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (
          typeof msg === 'object' &&
          msg !== null &&
          (msg as Record<string, unknown>)['type'] === 'controller.hello'
        ) {
          const { pairName, controllerId, controllerVersion, picoVersion, token, badgeNames } =
            msg as Record<string, unknown>;
          if (typeof pairName === 'string' && pairName.length > 0) {
            // Move from dashboards to the pair room
            this.dashboards.delete(socket);
            this.socketToPair.set(socket, pairName);
            const room = this.pairRooms.get(pairName) ?? new Set<WebSocket>();
            room.add(socket);
            this.pairRooms.set(pairName, room);

            const roster = Array.isArray(badgeNames)
              ? badgeNames.filter((name): name is string => typeof name === 'string' && name.length > 0)
              : undefined;
            if (roster != null && roster.length > 0) {
              const station = this.ensureStation(
                pairName,
                typeof controllerId === 'string' && controllerId.length > 0
                  ? controllerId
                  : (this.stationsByName.get(pairName)?.controllerId ?? pairName),
              );
              this.updateReportedRoster(station, roster);
            }

            // Reply with a welcome snapshot (game state will be populated by the controller after
            // calling GET /api/pairs/:pairName — the welcome here is a lightweight acknowledgement)
            this.sendToSocket(socket, {
              type: 'controller.welcome',
              pairName,
              controllerId: typeof controllerId === 'string' ? controllerId : undefined,
              controllerVersion: typeof controllerVersion === 'string' ? controllerVersion : undefined,
              picoVersion: typeof picoVersion === 'string' ? picoVersion : undefined,
              ...(roster != null ? { badgeNames: roster } : {}),
              token: token ?? null,
              serverTime: new Date().toISOString(),
            });
          }
        }
      });

      socket.on('close', () => {
        this.dashboards.delete(socket);
        const pairName = this.socketToPair.get(socket);
        if (pairName) {
          this.socketToPair.delete(socket);
          const room = this.pairRooms.get(pairName);
          if (room) {
            room.delete(socket);
            if (room.size === 0) {
              this.pairRooms.delete(pairName);
            }
          }
        }
      });
    });
  }

  /** Send an event to all dashboard browser clients. */
  broadcastDashboard(event: RealtimeEvent): void {
    const serialized = JSON.stringify(event);
    for (const client of this.dashboards) {
      if (client.readyState === client.OPEN) {
        client.send(serialized);
      }
    }
  }

  /** Send an event to all controller sockets in the rooms for the given pair names. */
  sendToPairNames(pairNames: string[], event: RealtimeEvent): void {
    const serialized = JSON.stringify(event);
    for (const pairName of pairNames) {
      const room = this.pairRooms.get(pairName);
      if (!room) continue;
      for (const socket of room) {
        if (socket.readyState === socket.OPEN) {
          socket.send(serialized);
        }
      }
    }
  }

  recordStatus(body: z.infer<typeof statusBodySchema>): void {
    const statusEvent: StatusDto = {
      controllerId: body.controllerId,
      badgeId: body.badgeId,
      bleStatus: body.bleStatus,
      timestamp: serverTimestamp(),
      ...(body.timestamp != null && body.timestamp !== ''
        ? { clientTimestamp: body.timestamp }
        : {}),
      ...(body.pairName != null ? { pairName: body.pairName } : {}),
      ...(body.badgeName != null ? { badgeName: body.badgeName } : {}),
      ...(body.badgeNames != null ? { badgeNames: body.badgeNames } : {}),
      ...(body.controllerVersion != null ? { controllerVersion: body.controllerVersion } : {}),
      ...(body.picoVersion != null ? { picoVersion: body.picoVersion } : {}),
      ...(body.batteryLevel != null ? { batteryLevel: body.batteryLevel } : {}),
    };

    const badgeKey = getBadgeKey(
      statusEvent.controllerId,
      statusEvent.badgeId,
      statusEvent.badgeName,
    );
    this.bleStatusByBadgeKey.set(badgeKey, statusEvent);
    this.recordStationStatus(statusEvent);
    this.broadcastDashboard({ type: 'status.changed', ...statusEvent });
  }

  private ensureStation(stationName: string, controllerId: string): StationState {
    let station = this.stationsByName.get(stationName);
    if (!station) {
      station = {
        pairName: stationName,
        controllerId,
        controllerVersion: null,
        batteryLevel: null,
        reportedBadgeNames: null,
        slots: new Map(),
        emoji: null,
      };
      this.stationsByName.set(stationName, station);
    }
    station.controllerId = controllerId;
    return station;
  }

  private recordStationStatus(statusEvent: StatusDto): void {
    const station = this.ensureStation(
      resolveStationName(statusEvent),
      statusEvent.controllerId,
    );
    if (statusEvent.controllerVersion != null) {
      station.controllerVersion = statusEvent.controllerVersion;
    }
    if (statusEvent.batteryLevel != null) {
      station.batteryLevel = statusEvent.batteryLevel;
    }
    station.slots.set(resolveSlotName(statusEvent), { status: statusEvent });
    if (statusEvent.badgeNames != null) {
      this.updateReportedRoster(station, statusEvent.badgeNames);
    }
  }

  /** Roster order: reported `badgeNames`, else slots seen so far (Mode 1 → `[pairName]`). */
  private stationRoster(station: StationState): string[] {
    if (station.reportedBadgeNames) {
      return station.reportedBadgeNames;
    }
    const seen = [...station.slots.keys()];
    return seen.length > 0 ? seen : [station.pairName];
  }

  private toStationDto(station: StationState): StationDto {
    const badgeNames = this.stationRoster(station);
    return {
      pairName: station.pairName,
      controllerId: station.controllerId,
      controllerVersion: station.controllerVersion,
      batteryLevel: station.batteryLevel,
      badgeNames,
      emoji: station.emoji,
      badges: badgeNames.map((badgeName) => {
        const status = station.slots.get(badgeName)?.status ?? null;
        const bleStatus = status?.bleStatus ?? 'disconnected';
        return {
          badgeName,
          badgeId: knownOrNull(status?.badgeId),
          bleStatus,
          picoVersion: knownOrNull(status?.picoVersion),
          timestamp: status?.timestamp ?? null,
          emoji: bleStatus === 'connected' ? station.emoji : null,
        };
      }),
    };
  }

  /** Live roster for a station, or null when that controller has never posted. */
  getStationRoster(stationName: string): string[] | null {
    const station = this.stationsByName.get(stationName);
    return station ? this.stationRoster(station) : null;
  }

  /** Badge names in `badgeNames` that another live station also has in its roster. */
  findRosterConflicts(stationName: string, badgeNames: string[]): string[] {
    const conflicts = new Set<string>();
    for (const station of this.stationsByName.values()) {
      if (station.pairName === stationName) continue;
      const roster = this.stationRoster(station);
      for (const name of badgeNames) {
        if (roster.includes(name)) conflicts.add(name);
      }
    }
    return [...conflicts];
  }

  getStations(): StationDto[] {
    return [...this.stationsByName.values()].map((station) => this.toStationDto(station));
  }

  recordEmoji(body: z.infer<typeof emojiBodySchema>): void {
    const emojiEvent: EmojiDto = {
      controllerId: body.controllerId,
      badgeId: body.badgeId,
      menu: body.menu,
      pos: body.pos,
      neg: body.neg,
      label: body.label,
      timestamp: serverTimestamp(),
      ...(body.timestamp != null && body.timestamp !== ''
        ? { clientTimestamp: body.timestamp }
        : {}),
      ...(body.pairName != null ? { pairName: body.pairName } : {}),
      ...(body.badgeName != null ? { badgeName: body.badgeName } : {}),
    };

    const badgeKey = getBadgeKey(
      emojiEvent.controllerId,
      emojiEvent.badgeId,
      emojiEvent.badgeName,
    );
    this.lastEmojiByBadgeKey.set(badgeKey, emojiEvent);
    this.ensureStation(resolveStationName(emojiEvent), emojiEvent.controllerId).emoji =
      emojiEvent;
    this.emojiEventHistory.push(emojiEvent);

    if (this.emojiEventHistory.length > MAX_EMOJI_HISTORY) {
      this.emojiEventHistory.splice(0, this.emojiEventHistory.length - MAX_EMOJI_HISTORY);
    }

    this.broadcastDashboard({ type: 'emoji.sent', ...emojiEvent });
  }

  getBadges(): BadgeStateDto[] {
    const keys = new Set([
      ...this.bleStatusByBadgeKey.keys(),
      ...this.lastEmojiByBadgeKey.keys(),
    ]);
    const badges: BadgeStateDto[] = [];

    for (const key of keys) {
      const status = this.bleStatusByBadgeKey.get(key);
      const emoji = this.lastEmojiByBadgeKey.get(key);
      const controllerId = status?.controllerId ?? emoji?.controllerId ?? '';
      const badgeId = status?.badgeId ?? emoji?.badgeId ?? '';
      badges.push({
        key,
        controllerId,
        badgeId,
        status: status ?? null,
        emoji: emoji ?? null,
      });
    }

    return badges;
  }

  private sendToSocket(socket: WebSocket, event: RealtimeEvent): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }
}
