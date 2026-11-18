import { Readable } from 'stream';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '../config/env.validation';
import { RedisService } from './redis.module';

describe('RedisService', () => {
  let service: RedisService;
  let mockConfig: ConfigService<EnvConfig, true>;

  beforeEach(() => {
    mockConfig = {
      get: jest.fn((key: string) => {
        const map: Record<string, unknown> = {
          REDIS_HOST: 'localhost',
          REDIS_PORT: 6379,
          REDIS_PASSWORD: '',
        };
        return map[key];
      }),
    } as unknown as ConfigService<EnvConfig, true>;

    service = new RedisService(mockConfig);
  });

  afterEach(async () => {
    service.client.disconnect();
    jest.restoreAllMocks();
  });

  it('uses lazyConnect: true so constructor does not eagerly connect', () => {
    expect(service.client.options.lazyConnect).toBe(true);
  });

  it('getJson returns null on miss and parsed object on hit', async () => {
    const getSpy = jest.spyOn(service.client, 'get');
    getSpy.mockResolvedValueOnce(null);
    await expect(service.getJson('missing')).resolves.toBeNull();

    getSpy.mockResolvedValueOnce(JSON.stringify({ id: 'tenant-1', slug: 'moda' }));
    await expect(service.getJson('tenant:host:moda.localhost')).resolves.toEqual({
      id: 'tenant-1',
      slug: 'moda',
    });
  });

  it('setJson serializes JSON with EX TTL', async () => {
    const setSpy = jest.spyOn(service.client, 'set').mockResolvedValue('OK');
    await service.setJson('k1', { ok: true }, 600);
    expect(setSpy).toHaveBeenCalledWith('k1', JSON.stringify({ ok: true }), 'EX', 600);
  });

  it('get, set, del, exists, ttl, and ping delegate cleanly', async () => {
    const getSpy = jest.spyOn(service.client, 'get').mockResolvedValue('val');
    const setSpy = jest.spyOn(service.client, 'set').mockResolvedValue('OK');
    const delSpy = jest.spyOn(service.client, 'del').mockResolvedValue(1);
    const existsSpy = jest.spyOn(service.client, 'exists').mockResolvedValue(1);
    const ttlSpy = jest.spyOn(service.client, 'ttl').mockResolvedValue(120);
    const pingSpy = jest.spyOn(service.client, 'ping').mockResolvedValue('PONG');

    await expect(service.get('a')).resolves.toBe('val');
    await service.set('a', 'b', 30);
    await service.set('a', 'c');
    await service.del('a');
    await expect(service.exists('a')).resolves.toBe(true);
    await expect(service.ttl('a')).resolves.toBe(120);
    await expect(service.ping()).resolves.toBe('PONG');

    expect(getSpy).toHaveBeenCalledWith('a');
    expect(setSpy).toHaveBeenNthCalledWith(1, 'a', 'b', 'EX', 30);
    expect(setSpy).toHaveBeenNthCalledWith(2, 'a', 'c');
    expect(delSpy).toHaveBeenCalledWith('a');
    expect(existsSpy).toHaveBeenCalledWith('a');
    expect(ttlSpy).toHaveBeenCalledWith('a');
    expect(pingSpy).toHaveBeenCalled();
  });

  it('incrWithTtl executes atomic Lua eval script', async () => {
    const evalSpy = jest.spyOn(service.client, 'eval');

    evalSpy.mockResolvedValueOnce(1);
    await expect(service.incrWithTtl('otp:rate:1', 300)).resolves.toBe(1);
    expect(evalSpy).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      1,
      'otp:rate:1',
      300,
    );

    evalSpy.mockResolvedValueOnce(2);
    await expect(service.incrWithTtl('otp:rate:1', 300)).resolves.toBe(2);
    expect(evalSpy).toHaveBeenCalledTimes(2);
  });

  it('getDel atomically retrieves and deletes key via Lua eval script', async () => {
    const evalSpy = jest.spyOn(service.client, 'eval');

    evalSpy.mockResolvedValueOnce('one-time-payload');
    await expect(service.getDel('auth:oauth:code:abc')).resolves.toBe('one-time-payload');
    expect(evalSpy).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      1,
      'auth:oauth:code:abc',
    );

    evalSpy.mockResolvedValueOnce(null);
    await expect(service.getDel('auth:oauth:code:missing')).resolves.toBeNull();
  });

  it('delByPattern uses scanStream (not KEYS) and deletes batches', async () => {
    const stream = Readable.from([['tenant:host:a', 'tenant:host:b'], ['tenant:host:c']]);
    const scanSpy = jest.spyOn(service.client, 'scanStream').mockReturnValue(stream as never);
    const delSpy = jest
      .spyOn(service.client, 'del')
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const deleted = await service.delByPattern('tenant:host:*');

    expect(scanSpy).toHaveBeenCalledWith({ match: 'tenant:host:*', count: 100 });
    expect(delSpy).toHaveBeenNthCalledWith(1, 'tenant:host:a', 'tenant:host:b');
    expect(delSpy).toHaveBeenNthCalledWith(2, 'tenant:host:c');
    expect(deleted).toBe(3);
  });

  it('onModuleDestroy handles ready, wait, and end statuses safely', async () => {
    const quitSpy = jest.spyOn(service.client, 'quit').mockResolvedValue('OK');
    const disconnectSpy = jest
      .spyOn(service.client, 'disconnect')
      .mockImplementation(() => undefined);

    Object.defineProperty(service.client, 'status', { value: 'ready', configurable: true });
    await service.onModuleDestroy();
    expect(quitSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(service.client, 'status', { value: 'wait', configurable: true });
    await service.onModuleDestroy();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(service.client, 'status', { value: 'end', configurable: true });
    await service.onModuleDestroy();
    expect(quitSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    quitSpy.mockRejectedValueOnce(new Error('Connection closed'));
    Object.defineProperty(service.client, 'status', { value: 'ready', configurable: true });
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(disconnectSpy).toHaveBeenCalledTimes(2);
  });
});
