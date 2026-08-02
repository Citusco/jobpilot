import { jest } from '@jest/globals';

import type { ExtractResponse } from '../../../src/agent-orchestration/schemas/extract-response.schema.js';
import { AgentOrchestrationUnavailableError } from '../../../src/agent-orchestration/agent-orchestration.client.js';
import { JdSubmissionsService } from '../../../src/jd-submissions/jd-submissions.service.js';

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

describe('JdSubmissionsService', () => {
  const buildDeps = () => {
    const extract = jest.fn<(text: string) => Promise<ExtractResponse>>();
    const create = jest.fn<(args: unknown) => Promise<CreatedSubmission>>();
    const agentClient = { extract };
    const prisma = { jdSubmission: { create } };
    const service = new JdSubmissionsService(agentClient as never, prisma as never);
    return { agentClient, prisma, service };
  };

  it('persists an accepted submission with its candidate directions', async () => {
    const { agentClient, prisma, service } = buildDeps();
    agentClient.extract.mockResolvedValue({
      sufficient: true,
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: [{ name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: 3 }],
    });
    const createdAt = new Date('2026-08-02T00:00:00.000Z');
    prisma.jdSubmission.create.mockResolvedValue({
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

    const result = await service.submit('a real JD text');

    expect(result).toEqual({
      status: 'accepted',
      id: 'submission-1',
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: [{ id: 'direction-1', name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: 3 }],
      createdAt,
    });
    expect(prisma.jdSubmission.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.jdSubmission.create.mock.calls[0][0] as unknown as {
      data: { status: string; candidateTrainingDirections: { create: unknown[] } };
    };
    expect(createArgs.data.status).toBe('accepted');
    expect(createArgs.data.candidateTrainingDirections.create).toHaveLength(1);
  });

  it('persists a rejected submission with no candidate directions', async () => {
    const { agentClient, prisma, service } = buildDeps();
    agentClient.extract.mockResolvedValue({ sufficient: false, reason: 'JD text is too short' });
    prisma.jdSubmission.create.mockResolvedValue({} as CreatedSubmission);

    const result = await service.submit('too short');

    expect(result).toEqual({ status: 'rejected', reason: 'JD text is too short' });
    const createArgs = prisma.jdSubmission.create.mock.calls[0][0] as unknown as {
      data: { status: string; rejectionReason: string; candidateTrainingDirections?: unknown };
    };
    expect(createArgs.data.status).toBe('rejected');
    expect(createArgs.data.rejectionReason).toBe('JD text is too short');
    expect(createArgs.data.candidateTrainingDirections).toBeUndefined();
  });

  it('persists nothing when the agent orchestration service fails', async () => {
    const { agentClient, prisma, service } = buildDeps();
    agentClient.extract.mockRejectedValue(new AgentOrchestrationUnavailableError('unreachable'));

    await expect(service.submit('a real JD text')).rejects.toThrow(AgentOrchestrationUnavailableError);
    expect(prisma.jdSubmission.create).not.toHaveBeenCalled();
  });
});
