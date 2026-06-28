import { Controller, Get } from '@nestjs/common';
import { APP_VERSION } from './app-version';

@Controller('api')
export class VersionController {
  @Get('version')
  getVersion(): { version: string } {
    return { version: APP_VERSION };
  }
}
