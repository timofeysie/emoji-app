import { Logger } from '@nestjs/common';
import { connect } from 'mongoose';
import { MongoService } from './mongo.service';
import { registerModels } from './models';

jest.mock('mongoose', () => ({
  connect: jest.fn(),
}));

jest.mock('./models', () => ({
  registerModels: jest.fn(),
}));

describe('MongoService', () => {
  it('gracefully disables persistence when MONGODB_URI is missing', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = new MongoService();

    await service.onModuleInit();

    expect(warnSpy).toHaveBeenCalledWith('MONGODB_URI is not set. Mongo persistence is disabled.');
    expect(service.isConnected()).toBe(false);
    expect(() => service.getModels()).toThrow(
      'Mongo models are unavailable. Set MONGODB_URI to enable persistence.',
    );
  });

  it('connects and registers models when MONGODB_URI is set', async () => {
    process.env['MONGODB_URI'] = 'mongodb://localhost:27017/emoji-app-test';
    const syncIndexes = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const fakeModels = { Game: { modelName: 'Game' } } as unknown;
    (connect as jest.Mock).mockResolvedValue({
      connection: { syncIndexes, close },
    });
    (registerModels as jest.Mock).mockReturnValue(fakeModels);
    const service = new MongoService();

    await service.onModuleInit();

    expect(connect).toHaveBeenCalled();
    expect(registerModels).toHaveBeenCalled();
    expect(syncIndexes).toHaveBeenCalled();
    expect(service.isConnected()).toBe(true);
    expect(service.getModels()).toBe(fakeModels);

    await service.onModuleDestroy();
    expect(close).toHaveBeenCalled();
  });
});
