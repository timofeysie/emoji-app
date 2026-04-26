import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Connection, connect } from 'mongoose';
import { DbModels, registerModels } from './models';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);

  private connection: Connection | null = null;

  private models: DbModels | null = null;

  async onModuleInit(): Promise<void> {
    const mongoUri = process.env['MONGODB_URI'];
    if (!mongoUri) {
      this.logger.warn('MONGODB_URI is not set. Mongo persistence is disabled.');
      return;
    }

    const mongoose = await connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 20,
      minPoolSize: 2,
    });

    this.connection = mongoose.connection;
    this.models = registerModels(this.connection);
    await this.connection.syncIndexes();
    this.logger.log('MongoDB connected and indexes synchronized.');
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.connection) {
      return;
    }

    await this.connection.close();
    this.connection = null;
    this.models = null;
    this.logger.log('MongoDB connection closed.');
  }

  isConnected(): boolean {
    return this.connection != null;
  }

  getModels(): DbModels {
    if (!this.models) {
      throw new Error('Mongo models are unavailable. Set MONGODB_URI to enable persistence.');
    }
    return this.models;
  }
}
