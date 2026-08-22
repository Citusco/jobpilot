import 'reflect-metadata';
import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // The concept map client. One directory of static files, served by the Express adapter
  // the app already runs on -- no new package, no build step, and no second process to
  // start before the map can be looked at.
  app.useStaticAssets(fileURLToPath(new URL('../public', import.meta.url)));
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
