import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { BadgesController } from './badges.controller';
import { BadgeStateService } from './badge-state.service';

@Module({
  controllers: [ChatController, BadgesController],
  providers: [BadgeStateService],
})
export class AppModule {}
