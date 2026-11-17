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
