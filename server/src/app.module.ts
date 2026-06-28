import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { BadgesController } from './badges.controller';
import { BadgeStateService } from './badge-state.service';
import { MongoService } from './persistence/mongo.service';
import { GameDataRepository } from './persistence/game-data.repository';
import { GameFlowController } from './game-flow.controller';
import { NfcCardsController } from './nfc-cards.controller';
import { NfcCardService } from './nfc-card.service';
import { VersionController } from './version.controller';

@Module({
  controllers: [
    ChatController,
    BadgesController,
    GameFlowController,
    NfcCardsController,
    VersionController,
  ],
  providers: [BadgeStateService, MongoService, GameDataRepository, NfcCardService],
  exports: [MongoService, GameDataRepository],
})
export class AppModule {}
