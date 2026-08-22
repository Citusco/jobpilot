import { Module } from '@nestjs/common';

import { ConceptGraphService } from './concept-graph.service.js';

// Its own module for the same reason ResolveModule is: graph assembly is per concept
// corpus, not per request, and it will serve surfaces beyond a submission's graph.
//
// PrismaModule is @Global, so PrismaService needs no import here.
@Module({
  providers: [ConceptGraphService],
  exports: [ConceptGraphService],
})
export class ConceptGraphModule {}
