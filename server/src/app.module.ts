import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { BadgesController } from './badges.controller';
import { BadgeStateService } from './badge-state.service';
import { MongoService } from './persistence/mongo.service';
import { GameDataRepository } from './persistence/game-data.repository';
import { GameFlowController } from './game-flow.controller';

@Module({
  controllers: [ChatController, BadgesController, GameFlowController],
  providers: [BadgeStateService, MongoService, GameDataRepository],
  exports: [MongoService, GameDataRepository],
})
export class AppModule {}
