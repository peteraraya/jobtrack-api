import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator.js';

@Controller()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    private db: TypeOrmHealthIndicator,
  ) {}

  @Public()
  @Get('health')
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
      // El ping invalida el health si no se puede conectar a Postgres.
      () => this.db.pingCheck('database', { timeout: 1500 }),
    ]);
  }
}
