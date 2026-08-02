import { Module } from '@nestjs/common';

import { AgentOrchestrationModule } from '../agent-orchestration/agent-orchestration.module.js';
import { JdSubmissionsController } from './jd-submissions.controller.js';
import { JdSubmissionsService } from './jd-submissions.service.js';

@Module({
  imports: [AgentOrchestrationModule],
  controllers: [JdSubmissionsController],
  providers: [JdSubmissionsService],
})
export class JdSubmissionsModule {}
