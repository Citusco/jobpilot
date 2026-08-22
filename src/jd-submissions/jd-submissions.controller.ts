import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';

import {
  AgentOrchestrationUnavailableError,
  AgentOrchestrationUnreachableError,
} from '../agent-orchestration/agent-orchestration.client.js';
import { ConceptGraphService } from '../concept-graph/concept-graph.service.js';
import { JdSubmissionsService } from './jd-submissions.service.js';
import { jdSubmissionRequestSchema } from './schemas/jd-submission-request.schema.js';

const submissionIdSchema = z.string().uuid();

@Controller('jd-submissions')
export class JdSubmissionsController {
  constructor(
    private readonly jdSubmissionsService: JdSubmissionsService,
    private readonly conceptGraphService: ConceptGraphService,
  ) {}

  /**
   * Submit a job description: extract its technical items, resolve each, store
   * everything, return the per-item outcome.
   *
   * There is no rejection path for a posting with no technical content. It is a 201 with
   * an empty item list, and a posting the corpus does not cover is a 201 that is entirely
   * unresolved -- a correct and informative answer, not an error (FR-004, FR-022,
   * SC-007). The removed pipeline's 422 has no successor.
   */
  @Post()
  async create(@Body() body: unknown) {
    const parsed = jdSubmissionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid request body',
        issues: parsed.error.issues,
      });
    }

    try {
      return await this.jdSubmissionsService.submit(parsed.data.text);
    } catch (error) {
      // Order matters: the unreachable error is a subclass of the unavailable one.
      if (error instanceof AgentOrchestrationUnreachableError) {
        throw new ServiceUnavailableException({ message: error.message });
      }
      if (error instanceof AgentOrchestrationUnavailableError) {
        throw new BadGatewayException({ message: error.message });
      }
      throw error;
    }
  }

  /**
   * The whole concept graph for a submission, in one response.
   *
   * No pagination, no subgraph parameter and no lazy expansion: the full graph measures
   * around 34 KB, and a caller that wants part of it can filter client-side. Splitting it
   * would cost a client the one thing the map is for -- seeing the unmatched majority
   * alongside the matched few.
   *
   * A malformed id is a 404 rather than a 400. It names no submission, which is the same
   * answer as an id that simply is not there, and letting it through would surface a
   * database driver error instead.
   */
  @Get(':id/graph')
  async graph(@Param('id') id: string) {
    if (!submissionIdSchema.safeParse(id).success) {
      throw new NotFoundException({ message: `No submission ${id}` });
    }
    return await this.conceptGraphService.graphFor(id);
  }
}
