import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;
  let mockPrisma: { $queryRaw: jest.Mock };
  let mockRedis: { ping: jest.Mock };
  let mockRes: { status: jest.Mock };

  beforeEach(() => {
    mockPrisma = { $queryRaw: jest.fn() };
    mockRedis = { ping: jest.fn() };
    mockRes = { status: jest.fn() };

    service = new HealthService(
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as RedisService,
    );
    controller = new HealthController(service);
  });

  it('returns status ok when Postgres and Redis are both up without overriding status code', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    mockRedis.ping.mockResolvedValueOnce('PONG');

    const result = await controller.check(mockRes as unknown as Response);
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ok', db: 'up', redis: 'up' });
    expect(typeof result.timestamp).toBe('string');
  });

  it('sets HTTP 503 and preserves HealthResponseDto fields when Postgres is down', async () => {
    const loggerSpy = jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockRedis.ping.mockResolvedValueOnce('PONG');

    const result = await controller.check(mockRes as unknown as Response);
    expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(result).toMatchObject({ status: 'error', db: 'down', redis: 'up' });
    expect(typeof result.timestamp).toBe('string');
    loggerSpy.mockRestore();
  });

  it('sets HTTP 503 and preserves HealthResponseDto fields when Redis is down', async () => {
    const loggerSpy = jest
      .spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    mockPrisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    mockRedis.ping.mockRejectedValueOnce(new Error('Redis down'));

    const result = await controller.check(mockRes as unknown as Response);
    expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(result).toMatchObject({ status: 'error', db: 'up', redis: 'down' });
    expect(typeof result.timestamp).toBe('string');
    loggerSpy.mockRestore();
  });
});
