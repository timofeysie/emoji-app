import 'reflect-metadata';
import path from 'path';
import { existsSync } from 'fs';
import express from 'express';
import cors from 'cors';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module';
import { BadgeStateService } from './badge-state.service';
import { requestLoggingMiddleware } from './request-logging.middleware';

async function bootstrap(): Promise<void> {
  const host = process.env['HOST'] ?? 'localhost';
  const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;
  const openAiApiKey = process.env['OPENAI_API_KEY'];
  if (!openAiApiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const expressApp = express();
  expressApp.use(cors());
  expressApp.use(express.json());
  expressApp.use(requestLoggingMiddleware);

  const nestApp = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
    { bodyParser: false },
  );
  await nestApp.init();

  const httpServer = nestApp.getHttpServer();
  const wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });
  const badgeStateService = nestApp.get(BadgeStateService);
  badgeStateService.setWebSocketServer(wsServer);

  const staticPath = path.join(__dirname, 'client-react');
  if (existsSync(staticPath)) {
    expressApp.use(express.static(staticPath));
    expressApp.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/ws') {
        next();
        return;
      }
      res.sendFile(path.join(staticPath, 'index.html'));
    });
  }

  await nestApp.listen(port, host);
  console.log(`[ ready ] http://${host}:${port}`);
}

void bootstrap();
