import { NfcCardService } from './nfc-card.service';
import { NfcCardsController } from './nfc-cards.controller';

describe('NfcCardsController', () => {
  const controller = new NfcCardsController(new NfcCardService());

  it('returns the seeded NFC cards', () => {
    const result = controller.getNfcCards();

    expect(result.cards).toEqual([
      { id: '5B:6F:B8:08', name: 'R12 - Monkey', display: 'circle' },
      { id: 'DB:93:B7:08', name: 'W3 - Clown', display: 'x' },
    ]);
  });

  it('returns a defensive copy that cannot mutate the seed', () => {
    const first = controller.getNfcCards();
    first.cards[0].name = 'mutated';

    const second = controller.getNfcCards();
    expect(second.cards[0].name).toBe('R12 - Monkey');
  });
});
