import { Module } from '@nestjs/common';

import { AgentOrchestrationModule } from './agent-orchestration/agent-orchestration.module.js';
import { HealthModule } from './health/health.module.js';
import { JdSubmissionsModule } from './jd-submissions/jd-submissions.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, HealthModule, AgentOrchestrationModule, JdSubmissionsModule],
})
export class AppModule {}
