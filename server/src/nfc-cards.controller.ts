import { Controller, Get } from '@nestjs/common';
import { NfcCard, NfcCardService } from './nfc-card.service';

@Controller('api')
export class NfcCardsController {
  constructor(private readonly nfcCardService: NfcCardService) {}

  @Get('nfc-cards')
  getNfcCards(): { cards: NfcCard[] } {
    return { cards: this.nfcCardService.getCards() };
  }
}
