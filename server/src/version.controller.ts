import { Controller, Get } from '@nestjs/common';
import { APP_VERSION, EXPECTED_CONTROLLER_VERSION, EXPECTED_PICO_VERSION } from './app-version';

@Controller('api')
export class VersionController {
  @Get('version')
  getVersion(): {
    version: string;
    expectedControllerVersion: string;
    expectedPicoVersion: string;
  } {
    return {
      version: APP_VERSION,
      expectedControllerVersion: EXPECTED_CONTROLLER_VERSION,
      expectedPicoVersion: EXPECTED_PICO_VERSION,
    };
  }
}
