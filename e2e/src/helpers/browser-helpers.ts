import { expect, type Page, type Response } from '@playwright/test';
import { ENV } from '../config/env';

export interface BrowserErrorReport {
  consoleErrors: string[];
  pageErrors: string[];
  serverErrors: string[];
}

export interface BrowserGuardOptions {
  ignoreConsolePatterns?: RegExp[];
  allowStatusCodes?: number[];
}

export class BrowserGuard {
  public readonly consoleErrors: string[] = [];
  public readonly pageErrors: string[] = [];
  public readonly serverErrors: string[] = [];

  constructor(
    private readonly page: Page,
    private readonly options: BrowserGuardOptions = {},
  ) {
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const ignored = this.options.ignoreConsolePatterns?.some((re) => re.test(text)) ?? false;
        if (!ignored) {
          this.consoleErrors.push(text);
        }
      }
    });

    this.page.on('pageerror', (error) => {
      this.pageErrors.push(error.message);
    });

    this.page.on('response', (response: Response) => {
      const status = response.status();
      if (status >= 500 && !(this.options.allowStatusCodes ?? []).includes(status)) {
        this.serverErrors.push(`${status} ${response.url()}`);
      }
    });
  }

  getReport(): BrowserErrorReport {
    return {
      consoleErrors: [...this.consoleErrors],
      pageErrors: [...this.pageErrors],
      serverErrors: [...this.serverErrors],
    };
  }

  assertClean(): void {
    expect(this.pageErrors, `Uncaught page errors: ${this.pageErrors.join(' | ')}`).toEqual([]);
    expect(this.serverErrors, `Unexpected 5xx responses: ${this.serverErrors.join(' | ')}`).toEqual([]);
    expect(this.consoleErrors, `Console errors: ${this.consoleErrors.join(' | ')}`).toEqual([]);
  }
}

export function attachBrowserGuard(page: Page, options?: BrowserGuardOptions): BrowserGuard {
  return new BrowserGuard(page, options);
}

export function buildFrontendUrl(path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${ENV.frontendUrl}${normalized}`;
}

export function buildSubdomainFrontendUrl(subdomain: string, path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `http://${subdomain}.${ENV.platformBaseDomain}${normalized}`;
}

export async function loginViaUi(
  page: Page,
  options: {
    email: string;
    password: string;
    targetPath: '/dashboard' | '/superadmin';
  },
): Promise<void> {
  await page.goto(buildFrontendUrl('/login'), { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(options.email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(options.password);

  const submitBtn = page.locator('button[type="submit"]').first();
  const [loginRes] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        (res.url().includes('/auth/') || res.url().includes('/login')),
      { timeout: 15_000 },
    ),
    submitBtn.click(),
  ]);
  expect(
    loginRes.status(),
    `UI login POST failed with status ${loginRes.status()}`,
  ).toBeLessThan(400);

  // Allow client router redirect to settle if /login automatically navigates after login
  await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 })
    .catch(() => undefined);

  const currentPath = new URL(page.url()).pathname;
  if (!currentPath.startsWith(options.targetPath)) {
    const navRes = await page.goto(buildFrontendUrl(options.targetPath), {
      waitUntil: 'networkidle',
    });
    expect(navRes?.status(), `GET ${options.targetPath} failed`).toBe(200);
  } else {
    await page.waitForLoadState('networkidle');
  }

  const escapedPath = options.targetPath.replace(/\//g, '\\/');
  await expect(page).toHaveURL(new RegExp(escapedPath));
  await expect(page).not.toHaveURL(/\/login/);
}
