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
});

export type StatusDto = {
  controllerId: string;
  badgeId: string;
  bleStatus: z.infer<typeof deviceBleStatusSchema>;
  timestamp: string;
  clientTimestamp?: string;
  pairName?: string;
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
};

type BadgeStateDto = {
  key: string;
  controllerId: string;
  badgeId: string;
  status: StatusDto | null;
  emoji: EmojiDto | null;
};

function serverTimestamp(): string {
  return new Date().toISOString();
}

function getBadgeKey(controllerId: string, badgeId: string): string {
  return `${controllerId}::${badgeId}`;
}

export type RealtimeEvent = Record<string, unknown> & { type: string };

@Injectable()
export class BadgeStateService {
  private readonly bleStatusByBadgeKey = new Map<string, StatusDto>();

  private readonly lastEmojiByBadgeKey = new Map<string, EmojiDto>();

  private readonly emojiEventHistory: EmojiDto[] = [];

  private wsServer: WebSocketServer | null = null;

  /** Dashboard browser clients — receive all broadcast events. */
  private readonly dashboards = new Set<WebSocket>();

  /** Controller room: pairName → set of WebSocket connections for that pair. */
  private readonly pairRooms = new Map<string, Set<WebSocket>>();

  /** Reverse lookup: socket → pairName (for cleanup on close). */
  private readonly socketToPair = new Map<WebSocket, string>();

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
          const { pairName, controllerId, controllerVersion, picoVersion, token } = msg as Record<string, unknown>;
          if (typeof pairName === 'string' && pairName.length > 0) {
            // Move from dashboards to the pair room
            this.dashboards.delete(socket);
            this.socketToPair.set(socket, pairName);
            const room = this.pairRooms.get(pairName) ?? new Set<WebSocket>();
            room.add(socket);
            this.pairRooms.set(pairName, room);

            // Reply with a welcome snapshot (game state will be populated by the controller after
            // calling GET /api/pairs/:pairName — the welcome here is a lightweight acknowledgement)
            this.sendToSocket(socket, {
              type: 'controller.welcome',
              pairName,
              controllerId: typeof controllerId === 'string' ? controllerId : undefined,
              controllerVersion: typeof controllerVersion === 'string' ? controllerVersion : undefined,
              picoVersion: typeof picoVersion === 'string' ? picoVersion : undefined,
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
      ...(body.controllerVersion != null ? { controllerVersion: body.controllerVersion } : {}),
      ...(body.picoVersion != null ? { picoVersion: body.picoVersion } : {}),
      ...(body.batteryLevel != null ? { batteryLevel: body.batteryLevel } : {}),
    };

    const badgeKey = getBadgeKey(statusEvent.controllerId, statusEvent.badgeId);
    this.bleStatusByBadgeKey.set(badgeKey, statusEvent);
    this.broadcastDashboard({ type: 'status.changed', ...statusEvent });
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
    };

    const badgeKey = getBadgeKey(emojiEvent.controllerId, emojiEvent.badgeId);
    this.lastEmojiByBadgeKey.set(badgeKey, emojiEvent);
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
