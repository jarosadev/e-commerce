import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { HealthResponseDto } from './health.dto';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthResponseDto> {
    let db: 'up' | 'down' = 'down';
    let redis: 'up' | 'down' = 'down';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Health check Postgres falló: ${message}`);
    }

    try {
      const pong = await this.redis.ping();
      if (pong === 'PONG') {
        redis = 'up';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Health check Redis falló: ${message}`);
    }

    const status = db === 'up' && redis === 'up' ? 'ok' : 'error';

    return {
      status,
      db,
      redis,
      timestamp: new Date().toISOString(),
    };
  }
}
