import { expect } from '@playwright/test';
import type { HttpResponse } from './http-client';

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractData<T = JsonRecord>(body: unknown): T {
  if (isRecord(body) && 'data' in body && body.data !== undefined && body.data !== null) {
    return body.data as T;
  }
  return body as T;
}

export function extractArray<T = JsonRecord>(body: unknown): T[] {
  if (Array.isArray(body)) {
    return body as T[];
  }
  if (isRecord(body)) {
    for (const key of ['data', 'items', 'results', 'clients', 'payments', 'products', 'categories']) {
      const candidate = body[key];
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
    if (isRecord(body.data)) {
      for (const key of ['items', 'results', 'clients', 'payments', 'products', 'categories']) {
        const candidate = body.data[key];
        if (Array.isArray(candidate)) {
          return candidate as T[];
        }
      }
    }
  }
  throw new Error(`Expected array or paginated collection, received: ${JSON.stringify(body).slice(0, 200)}`);
}

export function extractField<T = unknown>(obj: unknown, candidateKeys: string[]): T | undefined {
  if (!isRecord(obj)) {
    return undefined;
  }
  for (const key of candidateKeys) {
    if (obj[key] !== undefined) {
      return obj[key] as T;
    }
  }
  return undefined;
}

export function assertRfc7807Error(
  response: HttpResponse<unknown>,
  expectedStatus: number | number[],
  messageContains?: string,
): JsonRecord {
  const allowedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  expect(
    allowedStatuses,
    `Expected HTTP status in [${allowedStatuses.join(', ')}], got ${response.status}: ${response.rawText}`,
  ).toContain(response.status);

  expect(
    isRecord(response.body),
    `Expected RFC 7807 JSON object error body, got: ${response.rawText}`,
  ).toBe(true);

  const err = response.body as JsonRecord;
  expect(err.statusCode).toBe(response.status);

  const hasErrorLabel =
    (typeof err.error === 'string' && err.error.length > 0) ||
    (typeof err.title === 'string' && err.title.length > 0);
  expect(hasErrorLabel, `Missing non-empty error/title in RFC 7807 payload: ${response.rawText}`).toBe(true);

  const msg = err.message ?? err.detail;
  const hasMessage =
    (typeof msg === 'string' && msg.length > 0) ||
    (Array.isArray(msg) && msg.length > 0);
  expect(hasMessage, `Missing message/detail in RFC 7807 payload: ${response.rawText}`).toBe(true);

  expect(typeof err.path, `Expected path string in RFC 7807 payload: ${response.rawText}`).toBe('string');
  expect((err.path as string).length).toBeGreaterThan(0);

  expect(typeof err.timestamp, `Expected timestamp in RFC 7807 payload: ${response.rawText}`).toBe('string');
  expect(Number.isNaN(Date.parse(err.timestamp as string))).toBe(false);

  expect(
    typeof err.requestId === 'string' && (err.requestId as string).length > 0,
    `Expected non-empty requestId in RFC 7807 payload: ${response.rawText}`,
  ).toBe(true);

  if (messageContains) {
    const serializedMsg = Array.isArray(msg) ? msg.join(' ') : String(msg);
    expect(serializedMsg.toLowerCase()).toContain(messageContains.toLowerCase());
  }

  return err;
}

export function assertOpenApi3Document(doc: unknown): void {
  expect(isRecord(doc), 'OpenAPI response must be a JSON object').toBe(true);
  const spec = doc as JsonRecord;

  expect(typeof spec.openapi).toBe('string');
  expect((spec.openapi as string).startsWith('3.')).toBe(true);

  expect(isRecord(spec.info)).toBe(true);
  expect(typeof (spec.info as JsonRecord).title).toBe('string');

  expect(isRecord(spec.paths)).toBe(true);
  const pathKeys = Object.keys(spec.paths as JsonRecord);
  expect(pathKeys.length).toBeGreaterThan(10);

  expect(isRecord(spec.components)).toBe(true);
  const schemas = (spec.components as JsonRecord).schemas;
  expect(isRecord(schemas)).toBe(true);
  expect(Object.keys(schemas as JsonRecord).length).toBeGreaterThan(0);
}
