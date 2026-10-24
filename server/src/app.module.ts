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
import { PairBindingsController } from './pair-bindings.controller';
import { PlayersController } from './players.controller';
import { PlayerRepository } from './persistence/player.repository';
import { StationRosterSync } from './station-roster-sync';
import { XapiExportController } from './xapi/xapi-export.controller';
import { GameExportService } from './xapi/game-export.service';
import { LeitnerGamesController } from './learning/leitner-games.controller';
import { LearningProgressController } from './learning/progress.controller';
import { LeitnerFlowService } from './learning/leitner-flow.service';
import { LeitnerSetupService } from './learning/leitner-setup.service';

@Module({
  controllers: [
    ChatController,
    BadgesController,
    GameFlowController,
    NfcCardsController,
    VersionController,
    PairBindingsController,
    PlayersController,
    XapiExportController,
    LearningProgressController,
    LeitnerGamesController,
  ],
  providers: [
    BadgeStateService,
    MongoService,
    GameDataRepository,
    PlayerRepository,
    NfcCardService,
    StationRosterSync,
    GameExportService,
    LeitnerFlowService,
    LeitnerSetupService,
  ],
  exports: [MongoService, GameDataRepository],
})
export class AppModule {}
