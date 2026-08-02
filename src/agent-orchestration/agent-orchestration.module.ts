import { Module } from '@nestjs/common';

import { AgentOrchestrationClient } from './agent-orchestration.client.js';

@Module({
  providers: [AgentOrchestrationClient],
  exports: [AgentOrchestrationClient],
})
export class AgentOrchestrationModule {}
