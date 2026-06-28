import { Injectable } from '@nestjs/common';
import { z } from 'zod';

export const nfcCardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  display: z.string().min(1),
});

export type NfcCard = z.infer<typeof nfcCardSchema>;

// Static seed mapping. This is the single source of truth for the demo;
// making it dynamically editable (Mongo-backed / admin-authored) is a later
// step. Mirrors the two entries the Zero previously hardcoded in
// emoji-os-zero.py (NFC_CARD_MAP). `display` is the icon key the Pico badge
// understands (currently "circle" or "x").
const SEED_NFC_CARDS: NfcCard[] = [
  { id: '5B:6F:B8:08', name: 'R12 - Monkey', display: 'circle' },
  { id: 'DB:93:B7:08', name: 'W3 - Clown', display: 'x' },
];

@Injectable()
export class NfcCardService {
  private readonly cards: NfcCard[] = SEED_NFC_CARDS;

  getCards(): NfcCard[] {
    return this.cards.map((card) => ({ ...card }));
  }
}
