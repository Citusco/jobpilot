import { BadGatewayException, BadRequestException, Body, Controller, Post, UnprocessableEntityException } from '@nestjs/common';

import { AgentOrchestrationUnavailableError } from '../agent-orchestration/agent-orchestration.client.js';
import { JdSubmissionsService } from './jd-submissions.service.js';
import { jdSubmissionRequestSchema } from './schemas/jd-submission-request.schema.js';

@Controller('jd-submissions')
export class JdSubmissionsController {
  constructor(private readonly jdSubmissionsService: JdSubmissionsService) {}

  @Post()
  async create(@Body() body: unknown) {
    const parsed = jdSubmissionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid request body',
        issues: parsed.error.issues,
      });
    }

    const result = await this.submitOrFail(parsed.data.text);

    if (result.status === 'rejected') {
      throw new UnprocessableEntityException({ status: 'rejected', reason: result.reason });
    }

    return {
      id: result.id,
      status: 'accepted',
      extraction: result.extraction,
      directions: result.directions,
      createdAt: result.createdAt,
    };
  }

  private async submitOrFail(text: string) {
    try {
      return await this.jdSubmissionsService.submit(text);
    } catch (error) {
      if (error instanceof AgentOrchestrationUnavailableError) {
        throw new BadGatewayException({ message: error.message });
      }
      throw error;
    }
  }
}
