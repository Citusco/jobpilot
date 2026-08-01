import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

describe('GET /health (contract)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Boots the real AppModule (HealthModule + the @Global PrismaModule together) so DI
    // wiring across the whole app is exercised, not just HealthModule in isolation.
    // PrismaService is overridden with a stub — the DB connection stays mocked, per this
    // project's test convention, since no real Postgres is available for tests.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('matches the HealthStatus schema from contracts/openapi.yaml', async () => {
    const response = await request(app.getHttpServer() as Parameters<typeof request>[0]).get(
      '/health',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
