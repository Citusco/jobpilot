import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { AgentOrchestrationClient } from '../../src/agent-orchestration/agent-orchestration.client.js';
import { AgentOrchestrationUnavailableError } from '../../src/agent-orchestration/agent-orchestration.client.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import type { ExtractResponse } from '../../src/agent-orchestration/schemas/extract-response.schema.js';

interface CreatedSubmission {
  id: string;
  role: string | null;
  techStack: string[];
  seniority: string | null;
  seniorityInferred: boolean;
  createdAt: Date;
  candidateTrainingDirections: Array<{
    id: string;
    name: string;
    rationale: string;
    tags: string[];
    suggestedQuestionCount: number;
  }>;
}

describe('POST /jd-submissions (contract)', () => {
  let app: INestApplication;
  let agentClientMock: { extract: ReturnType<typeof jest.fn<(text: string) => Promise<ExtractResponse>>> };
  let prismaMock: { jdSubmission: { create: ReturnType<typeof jest.fn<(args: unknown) => Promise<CreatedSubmission>>> } };

  beforeAll(async () => {
    agentClientMock = { extract: jest.fn<(text: string) => Promise<ExtractResponse>>() };
    prismaMock = { jdSubmission: { create: jest.fn<(args: unknown) => Promise<CreatedSubmission>>() } };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AgentOrchestrationClient)
      .useValue(agentClientMock)
      .overrideProvider(PrismaService)
      .useValue({ ...prismaMock, onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    agentClientMock.extract.mockReset();
    prismaMock.jdSubmission.create.mockReset();
  });

  it('returns 201 with the accepted shape when the agent service reports sufficient info', async () => {
    agentClientMock.extract.mockResolvedValue({
      sufficient: true,
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: [{ name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: 3 }],
    });
    const createdAt = new Date('2026-08-02T00:00:00.000Z');
    prismaMock.jdSubmission.create.mockResolvedValue({
      id: 'submission-1',
      role: 'Backend Engineer',
      techStack: ['Node.js'],
      seniority: 'Senior',
      seniorityInferred: false,
      createdAt,
      candidateTrainingDirections: [
        { id: 'direction-1', name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: 3 },
      ],
    });

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/jd-submissions')
      .send({ text: 'a real JD text' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'submission-1',
      status: 'accepted',
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: [{ id: 'direction-1', name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: 3 }],
      createdAt: createdAt.toISOString(),
    });
  });

  it('returns 422 with the rejected shape when the agent service reports insufficient info', async () => {
    agentClientMock.extract.mockResolvedValue({ sufficient: false, reason: 'JD text is too short' });

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/jd-submissions')
      .send({ text: 'x' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ status: 'rejected', reason: 'JD text is too short' });
  });

  it('returns 400 without calling the agent service when the body is invalid', async () => {
    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/jd-submissions')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ message: expect.any(String) });
    expect(agentClientMock.extract).not.toHaveBeenCalled();
  });

  it('returns 502 when the agent orchestration service is unavailable', async () => {
    agentClientMock.extract.mockRejectedValue(new AgentOrchestrationUnavailableError('unreachable'));

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/jd-submissions')
      .send({ text: 'a real JD text' });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ message: expect.any(String) });
    expect(prismaMock.jdSubmission.create).not.toHaveBeenCalled();
  });
});
