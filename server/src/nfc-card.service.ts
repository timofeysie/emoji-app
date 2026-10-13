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
// group assignment; cards without one are not answer cards.
const SEED_NFC_CARDS: NfcCard[] = [
  // Early-demo cards (NFC test scripts match on id only). No slotLabel, so a
  // scan during a game counts as wrong.
  { id: '5B:6F:B8:08', name: 'R12 - Monkey', display: 'circle' },
  { id: 'DB:93:B7:08', name: 'W3 - Clown',   display: 'x' },
  // Four-option quiz cards (docs/games/game-planning.md → Phase 0). Names are
  // the numbers printed on the cards.
  { id: '2B:73:B8:08', name: '12', display: 'A', slotLabel: 'A' },
  { id: '4B:71:B8:08', name: '11', display: 'B', slotLabel: 'B' },
  { id: 'DB:69:B8:08', name: '10', display: 'C', slotLabel: 'C' },
  { id: '1B:5D:B8:08', name: 'D',  display: 'D', slotLabel: 'D' },
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
