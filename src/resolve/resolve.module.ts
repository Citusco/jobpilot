import { Module } from '@nestjs/common';

import { ResolveService } from './resolve.service.js';

// A module of its own rather than part of jd-submissions: resolution is per item and
// will later serve question generation as well, while submission handling is per
// request. Separately testable, different lifetimes (plan.md, Structure Decision).
//
// PrismaModule is @Global, so PrismaService needs no import here -- same as
// JdSubmissionsModule.
@Module({
  providers: [ResolveService],
  exports: [ResolveService],
})
export class ResolveModule {}
