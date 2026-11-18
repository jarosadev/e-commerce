import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EnvConfig } from '../config/env.validation';

const INCR_WITH_TTL_LUA = `
local current = redis.call('INCR', KEYS[1])
local ttl = tonumber(ARGV[1])
if ttl and ttl > 0 then
  if current == 1 or redis.call('TTL', KEYS[1]) == -1 then
    redis.call('EXPIRE', KEYS[1], ttl)
  end
end
return current
`;

const GET_DEL_LUA = `
local val = redis.call('GET', KEYS[1])
if val then
  redis.call('DEL', KEYS[1])
end
return val
`;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    this.client = new Redis({
      host: this.config.get('REDIS_HOST', { infer: true }),
      port: this.config.get('REDIS_PORT', { infer: true }),
      password: this.config.get('REDIS_PASSWORD', { infer: true }) || undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, value);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async getDel(key: string): Promise<string | null> {
    const result = await this.client.eval(GET_DEL_LUA, 1, key);
    return typeof result === 'string' ? result : null;
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.client.exists(key);
    return count > 0;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const result = await this.client.eval(INCR_WITH_TTL_LUA, 1, key, ttlSeconds);
    return Number(result);
  }

  async delByPattern(pattern: string): Promise<number> {
    let deleted = 0;
    const stream = this.client.scanStream({ match: pattern, count: 100 });
    for await (const keys of stream as AsyncIterable<string[]>) {
      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    }
    return deleted;
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    const status = this.client.status;
    if (status === 'ready' || status === 'connect') {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    } else if (status !== 'end') {
      this.client.disconnect();
    }
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
