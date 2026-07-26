import { Injectable } from '@nestjs/common';
import { z } from 'zod';

export const nfcCardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  display: z.string().min(1),
  slotLabel: z.enum(['A', 'B', 'C', 'D', 'E']).optional(),
});

export type NfcCard = z.infer<typeof nfcCardSchema>;

// Static seed mapping. This is the single source of truth for the demo;
// making it dynamically editable (Mongo-backed / admin-authored) is a later
// step. Mirrors the two entries the Zero previously hardcoded in
// emoji-os-zero.py (NFC_CARD_MAP). `display` is the icon key the Pico badge
// understands (currently "circle" or "x"). `slotLabel` maps the card to an
// answer slot (A–E) so the Zero can resolve guesses without a MongoDB card
// group assignment.
const SEED_NFC_CARDS: NfcCard[] = [
  { id: '5B:6F:B8:08', name: 'R12 - Monkey', display: 'circle', slotLabel: 'A' },
  { id: 'DB:93:B7:08', name: 'W3 - Clown',   display: 'x',      slotLabel: 'B' },
];

/** "R12 - Monkey" → "monkey"; falls back to slot or "-". */
export function shortCardLabel(
  displayName: string | undefined | null,
  fallback?: string | null,
): string {
  const raw = displayName?.trim();
  if (raw) {
    const dash = raw.lastIndexOf(' - ');
    const name = (dash >= 0 ? raw.slice(dash + 3) : raw).trim();
    if (name) {
      return name.toLowerCase();
    }
  }
  const fb = fallback?.trim();
  return fb ? fb.toLowerCase() : '-';
}

@Injectable()
export class NfcCardService {
  private readonly cards: NfcCard[] = SEED_NFC_CARDS;

  getCards(): NfcCard[] {
    return this.cards.map((card) => ({ ...card }));
  }

  findByUid(cardUid: string): NfcCard | undefined {
    return this.cards.find((card) => card.id === cardUid);
  }
}
