import { Injectable } from '@nestjs/common';

import { AgentOrchestrationClient } from '../agent-orchestration/agent-orchestration.client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface JdSubmissionAcceptedResult {
  status: 'accepted';
  id: string;
  extraction: {
    role: string;
    techStack: string[];
    seniority: string;
    seniorityInferred: boolean;
  };
  directions: Array<{
    id: string;
    name: string;
    rationale: string;
    tags: string[];
    suggestedQuestionCount: number;
  }>;
  createdAt: Date;
}

export interface JdSubmissionRejectedResult {
  status: 'rejected';
  reason: string;
}

export type JdSubmissionResult = JdSubmissionAcceptedResult | JdSubmissionRejectedResult;

@Injectable()
export class JdSubmissionsService {
  constructor(
    private readonly agentClient: AgentOrchestrationClient,
    private readonly prisma: PrismaService,
  ) {}

  async submit(text: string): Promise<JdSubmissionResult> {
    const result = await this.agentClient.extract(text);

    if (!result.sufficient) {
      await this.prisma.jdSubmission.create({
        data: { rawText: text, status: 'rejected', rejectionReason: result.reason },
      });
      return { status: 'rejected', reason: result.reason };
    }

    const submission = await this.prisma.jdSubmission.create({
      data: {
        rawText: text,
        status: 'accepted',
        role: result.extraction.role,
        techStack: result.extraction.techStack,
        seniority: result.extraction.seniority,
        seniorityInferred: result.extraction.seniorityInferred,
        candidateTrainingDirections: {
          create: result.directions.map((direction) => ({
            name: direction.name,
            rationale: direction.rationale,
            tags: direction.tags,
            suggestedQuestionCount: direction.suggestedQuestionCount,
          })),
        },
      },
      include: { candidateTrainingDirections: true },
    });

    return {
      status: 'accepted',
      id: submission.id,
      extraction: {
        role: submission.role ?? '',
        techStack: submission.techStack,
        seniority: submission.seniority ?? '',
        seniorityInferred: submission.seniorityInferred,
      },
      directions: submission.candidateTrainingDirections.map((direction) => ({
        id: direction.id,
        name: direction.name,
        rationale: direction.rationale,
        tags: direction.tags,
        suggestedQuestionCount: direction.suggestedQuestionCount,
      })),
      createdAt: submission.createdAt,
    };
  }
}
