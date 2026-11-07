import { NfcCardService } from './nfc-card.service';
import { NfcCardsController } from './nfc-cards.controller';

describe('NfcCardsController', () => {
  const controller = new NfcCardsController(new NfcCardService());

  it('returns the seeded NFC cards', () => {
    const result = controller.getNfcCards();

    expect(result.cards).toEqual([
      { id: '5B:6F:B8:08', name: 'R12 - Monkey', display: 'circle' },
      { id: 'DB:93:B7:08', name: 'W3 - Clown', display: 'x' },
      { id: '2B:73:B8:08', name: '12', display: 'A', slotLabel: 'A' },
      { id: '4B:71:B8:08', name: '11', display: 'B', slotLabel: 'B' },
      { id: 'DB:69:B8:08', name: '10', display: 'C', slotLabel: 'C' },
      { id: '1B:5D:B8:08', name: 'D', display: 'D', slotLabel: 'D' },
    ]);
  });

  it('returns a defensive copy that cannot mutate the seed', () => {
    const first = controller.getNfcCards();
    first.cards[0].name = 'mutated';

    const second = controller.getNfcCards();
    expect(second.cards[0].name).toBe('R12 - Monkey');
  });
});
