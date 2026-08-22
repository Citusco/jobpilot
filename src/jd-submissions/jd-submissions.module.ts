import { Module } from '@nestjs/common';

import { AgentOrchestrationModule } from '../agent-orchestration/agent-orchestration.module.js';
import { ConceptGraphModule } from '../concept-graph/concept-graph.module.js';
import { ResolveModule } from '../resolve/resolve.module.js';
import { JdSubmissionsController } from './jd-submissions.controller.js';
import { JdSubmissionsService } from './jd-submissions.service.js';

@Module({
  imports: [AgentOrchestrationModule, ResolveModule, ConceptGraphModule],
  controllers: [JdSubmissionsController],
  providers: [JdSubmissionsService],
})
export class JdSubmissionsModule {}
