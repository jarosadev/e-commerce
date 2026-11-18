import { expect } from '@playwright/test';
import { ENDPOINTS, SEED_TENANTS, SEED_USERS, uniqueEmail } from '../config/env';
import { extractData, extractField, isRecord, type JsonRecord } from './assertions';
import { HttpClient, type HttpResponse } from './http-client';
import { MailpitClient } from './mailpit-client';

let cachedOpenApi: JsonRecord | null = null;

export function createBackendClient(cookieJar?: ConstructorParameters<typeof HttpClient>[0]['cookieJar']): HttpClient {
  return new HttpClient({
    baseUrl: ENDPOINTS.apiBaseUrl,
    cookieJar,
  });
}

export async function getOpenApiSpec(forceRefresh = false): Promise<JsonRecord> {
  if (cachedOpenApi && !forceRefresh) {
    return cachedOpenApi;
  }
  const client = new HttpClient({ baseUrl: '' });
  const res = await client.get<JsonRecord>(ENDPOINTS.openApiJsonUrl);
  expect(res.status, `GET ${ENDPOINTS.openApiJsonUrl} failed: ${res.rawText}`).toBe(200);
  expect(isRecord(res.body)).toBe(true);
  cachedOpenApi = res.body;
  return cachedOpenApi;
}

async function getSchemaPropertiesForPath(
  pathSuffix: string,
  method: 'post' | 'patch' | 'get' | 'put' | 'delete',
): Promise<string[]> {
  try {
    const spec = await getOpenApiSpec();
    const paths = isRecord(spec.paths) ? spec.paths : {};
    const matchedPath = Object.keys(paths).find((p) => p.endsWith(pathSuffix));
    if (!matchedPath) {
      return [];
    }
    const pathItem = paths[matchedPath];
    if (!isRecord(pathItem) || !isRecord(pathItem[method])) {
      return [];
    }
    const op = pathItem[method] as JsonRecord;
    const reqBody = op.requestBody;
    if (!isRecord(reqBody) || !isRecord(reqBody.content)) {
      return [];
    }
    const appJson = reqBody.content['application/json'];
    if (!isRecord(appJson) || !isRecord(appJson.schema)) {
      return [];
    }
    let schema = appJson.schema as JsonRecord;
    if (typeof schema.$ref === 'string' && isRecord(spec.components) && isRecord(spec.components.schemas)) {
      const schemaName = schema.$ref.split('/').pop() ?? '';
      const resolved = spec.components.schemas[schemaName];
      if (isRecord(resolved)) {
        schema = resolved;
      }
    }
    return isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  } catch {
    return [];
  }
}

export async function buildVerifyOtpPayload(email: string, otpValue: string): Promise<Record<string, string>> {
  const props = await getSchemaPropertiesForPath('/verify-otp', 'post');
  const codeKey = props.includes('code') && !props.includes('otp') ? 'code' : 'otp';
  return { email, [codeKey]: otpValue };
}

export async function buildResetPasswordPayload(
  email: string,
  otpOrToken: string,
  newPasswordValue: string,
): Promise<Record<string, string>> {
  const props = await getSchemaPropertiesForPath('/reset-password', 'post');
  console.log('DEBUG: reset-password props', props);
  const tokenKey = props.includes('token')
    ? 'token'
    : props.includes('code') && !props.includes('otp')
      ? 'code'
      : 'otp';
  const passwordKey = props.includes('password') && !props.includes('newPassword')
    ? 'password'
    : 'newPassword';
  return { email, [tokenKey]: otpOrToken, [passwordKey]: newPasswordValue };
}

export async function loginPlatform(
  email: string = SEED_USERS.superAdmin.email,
  password: string = SEED_USERS.superAdmin.password,
  existingClient?: HttpClient,
): Promise<{ client: HttpClient; response: HttpResponse<JsonRecord> }> {
  const client = existingClient ?? createBackendClient();
  const response = await client.post<JsonRecord>('/auth/platform/login', {
    email,
    password,
  });
  expect(
    [200, 201],
    `Platform login failed for ${email}: ${response.status} ${response.rawText}`,
  ).toContain(response.status);
  return { client, response };
}

export async function loginStoreCustomer(
  email: string = SEED_USERS.customer1.email,
  password: string = SEED_USERS.customer1.password,
  tenantSlug: string = SEED_TENANTS.modaMayorista.slug,
  existingClient?: HttpClient,
): Promise<{ client: HttpClient; response: HttpResponse<JsonRecord> }> {
  const client = existingClient ?? createBackendClient();
  const response = await client.post<JsonRecord>(
    '/auth/store/login',
    { email, password },
    { tenantSlug },
  );
  expect(
    [200, 201],
    `Store login failed for ${email} on ${tenantSlug}: ${response.status} ${response.rawText}`,
  ).toContain(response.status);
  return { client, response };
}

export async function registerAndVerifyPlatformOwner(options?: {
  email?: string;
  password?: string;
  fullName?: string;
}): Promise<{
  email: string;
  password: string;
  fullName: string;
  otp: string;
  client: HttpClient;
  user: JsonRecord;
}> {
  const email = options?.email ?? uniqueEmail('owner');
  const password = options?.password ?? 'OwnerPass123!';
  const fullName = options?.fullName ?? 'E2E Test Merchant';
  const client = createBackendClient();
  const mailpit = new MailpitClient();
  const startedAt = Date.now();

  const regRes = await client.post<JsonRecord>('/auth/platform/register', {
    email,
    password,
    fullName,
  });
  expect(regRes.status, `Register failed: ${regRes.rawText}`).toBe(201);

  const emailMsg = await mailpit.waitForEmail({
    to: email,
    afterMs: startedAt,
    timeoutMs: 20_000,
  });
  const otp = mailpit.extractOtpCode(emailMsg);

  const verifyPayload = await buildVerifyOtpPayload(email, otp);
  const verifyRes = await client.post<JsonRecord>('/auth/platform/verify-otp', verifyPayload);
  expect([200, 201], `Verify OTP failed: ${verifyRes.rawText}`).toContain(verifyRes.status);

  await loginPlatform(email, password, client);
  return {
    email,
    password,
    fullName,
    otp,
    client,
    user: extractData(regRes.body),
  };
}

export async function registerAndVerifyStoreCustomer(options: {
  tenantSlug: string;
  email?: string;
  password?: string;
  fullName?: string;
}): Promise<{
  email: string;
  password: string;
  fullName: string;
  otp: string;
  client: HttpClient;
  customer: JsonRecord;
}> {
  const email = options.email ?? uniqueEmail('buyer');
  const password = options.password ?? 'BuyerPass123!';
  const fullName = options.fullName ?? 'E2E Store Buyer';
  const client = createBackendClient();
  const mailpit = new MailpitClient();
  const startedAt = Date.now();

  const regRes = await client.post<JsonRecord>(
    '/auth/store/register',
    { email, password, fullName },
    { tenantSlug: options.tenantSlug },
  );
  expect(regRes.status, `Store register failed: ${regRes.rawText}`).toBe(201);

  const emailMsg = await mailpit.waitForEmail({
    to: email,
    afterMs: startedAt,
    timeoutMs: 20_000,
  });
  const otp = mailpit.extractOtpCode(emailMsg);

  const verifyPayload = await buildVerifyOtpPayload(email, otp);
  const verifyRes = await client.post<JsonRecord>('/auth/store/verify-otp', verifyPayload, {
    tenantSlug: options.tenantSlug,
  });
  expect([200, 201], `Store verify OTP failed: ${verifyRes.rawText}`).toContain(verifyRes.status);

  await loginStoreCustomer(email, password, options.tenantSlug, client);
  return {
    email,
    password,
    fullName,
    otp,
    client,
    customer: extractData(regRes.body),
  };
}

export async function fetchStorefrontProduct(
  productSlug: string,
  tenantSlug: string = SEED_TENANTS.modaMayorista.slug,
  client: HttpClient = createBackendClient(),
): Promise<JsonRecord> {
  const res = await client.get<JsonRecord>(`/storefront/products/${productSlug}`, {
    tenantSlug,
  });
  expect(res.status, `GET /storefront/products/${productSlug} failed: ${res.rawText}`).toBe(200);
  return extractData(res.body);
}

export function getVariantBySku(productDetail: JsonRecord, sku: string): JsonRecord {
  const variants = productDetail.variants;
  expect(Array.isArray(variants), `Product detail missing variants array: ${JSON.stringify(productDetail)}`).toBe(true);
  const match = (variants as JsonRecord[]).find((v) => v.sku === sku);
  expect(match, `SKU ${sku} not found in product variants`).toBeDefined();
  return match as JsonRecord;
}

export function getEntityId(record: JsonRecord): string {
  const id = extractField<string>(record, ['id', 'tenantId', 'ownerId', 'userId', 'planId', 'paymentId']);
  expect(typeof id === 'string' && id.length > 0, `Missing entity id in ${JSON.stringify(record)}`).toBe(true);
  return id as string;
}

export function extractCartView(body: unknown): {
  id: string;
  items: JsonRecord[];
  subtotal: number;
  totalQuantity: number;
  discountAmount: number;
} {
  const cart = extractData<JsonRecord>(body);
  const items = Array.isArray(cart.items) ? (cart.items as JsonRecord[]) : [];
  const rawSubtotal = extractField<number | string>(cart, ['subtotal', 'itemsSubtotal', 'totalAmount', 'total']);
  const subtotal = Number(rawSubtotal ?? 0);
  const totalQuantity = Number(
    extractField<number | string>(cart, ['totalQuantity', 'itemCount']) ??
      items.reduce((acc, item) => acc + Number(item.quantity ?? 0), 0),
  );
  const discountAmount = Number(extractField<number | string>(cart, ['discountAmount', 'discount']) ?? 0);
  return {
    id: String(cart.id ?? ''),
    items,
    subtotal,
    totalQuantity,
    discountAmount,
  };
}

export function extractCartItemUnitPrice(item: JsonRecord): number {
  const val = extractField<number | string>(item, [
    'unitPriceApplied',
    'unitPrice',
    'effectiveUnitPrice',
    'appliedUnitPrice',
    'price',
  ]);
  expect(val !== undefined, `Cart item missing unit price field: ${JSON.stringify(item)}`).toBe(true);
  return Number(val);
}
