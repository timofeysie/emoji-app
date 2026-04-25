import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { WebSocketServer } from 'ws';

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
});

export const emojiBodySchema = z.object({
  controllerId: z.string().min(1),
  badgeId: z.string().min(1),
  menu: z.number().int(),
  pos: z.number().int(),
  neg: z.number().int(),
  label: z.string().min(1),
  timestamp: clientTimestampHintSchema,
});

export type StatusDto = {
  controllerId: string;
  badgeId: string;
  bleStatus: z.infer<typeof deviceBleStatusSchema>;
  timestamp: string;
  clientTimestamp?: string;
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

@Injectable()
export class BadgeStateService {
  private readonly bleStatusByBadgeKey = new Map<string, StatusDto>();

  private readonly lastEmojiByBadgeKey = new Map<string, EmojiDto>();

  private readonly emojiEventHistory: EmojiDto[] = [];

  private wsServer: WebSocketServer | null = null;

  setWebSocketServer(wsServer: WebSocketServer): void {
    this.wsServer = wsServer;
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
    };

    const badgeKey = getBadgeKey(statusEvent.controllerId, statusEvent.badgeId);
    this.bleStatusByBadgeKey.set(badgeKey, statusEvent);
    this.emitEvent('status.changed', statusEvent);
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
    };

    const badgeKey = getBadgeKey(emojiEvent.controllerId, emojiEvent.badgeId);
    this.lastEmojiByBadgeKey.set(badgeKey, emojiEvent);
    this.emojiEventHistory.push(emojiEvent);

    if (this.emojiEventHistory.length > MAX_EMOJI_HISTORY) {
      this.emojiEventHistory.splice(0, this.emojiEventHistory.length - MAX_EMOJI_HISTORY);
    }

    this.emitEvent('emoji.sent', emojiEvent);
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

  private emitEvent(type: 'status.changed' | 'emoji.sent', payload: StatusDto | EmojiDto): void {
    if (!this.wsServer) {
      return;
    }

    const serialized = JSON.stringify({ type, payload });
    for (const client of this.wsServer.clients) {
      if (client.readyState === client.OPEN) {
        client.send(serialized);
      }
    }
  }
}
