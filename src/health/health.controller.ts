import { Controller, Get } from '@nestjs/common';

interface HealthStatus {
  status: 'ok';
}

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthStatus {
    return { status: 'ok' };
  }
}
