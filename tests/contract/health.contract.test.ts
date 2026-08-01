import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { HealthModule } from '../../src/health/health.module.js';

describe('GET /health (contract)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

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
