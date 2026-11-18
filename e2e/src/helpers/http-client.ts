export interface ParsedCookie {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  maxAge?: number;
  expires?: string;
  path?: string;
  domain?: string;
  raw: string;
}

export function parseSetCookieHeader(rawHeader: string): ParsedCookie {
  const parts = rawHeader.split(';').map((part) => part.trim());
  const firstPart = parts[0] ?? '';
  const eqIndex = firstPart.indexOf('=');
  const name = eqIndex >= 0 ? firstPart.slice(0, eqIndex).trim() : firstPart;
  const value = eqIndex >= 0 ? firstPart.slice(eqIndex + 1) : '';

  const parsed: ParsedCookie = {
    name,
    value,
    httpOnly: false,
    secure: false,
    raw: rawHeader,
  };

  for (const attr of parts.slice(1)) {
    const attrEq = attr.indexOf('=');
    const key = (attrEq >= 0 ? attr.slice(0, attrEq) : attr).trim().toLowerCase();
    const val = attrEq >= 0 ? attr.slice(attrEq + 1).trim() : '';

    if (key === 'httponly') {
      parsed.httpOnly = true;
    } else if (key === 'secure') {
      parsed.secure = true;
    } else if (key === 'samesite') {
      parsed.sameSite = val;
    } else if (key === 'max-age') {
      const n = Number(val);
      if (!Number.isNaN(n)) {
        parsed.maxAge = n;
      }
    } else if (key === 'expires') {
      parsed.expires = val;
    } else if (key === 'path') {
      parsed.path = val;
    } else if (key === 'domain') {
      parsed.domain = val;
    }
  }

  return parsed;
}

export class CookieJar {
  private cookies = new Map<string, ParsedCookie>();
  private setCookieHistory: ParsedCookie[] = [];

  applySetCookies(rawHeaders: string[]): ParsedCookie[] {
    const parsedList = rawHeaders.map(parseSetCookieHeader);
    for (const cookie of parsedList) {
      if (!cookie.name) {
        continue;
      }
      this.setCookieHistory.push(cookie);
      const isExpiredMaxAge = cookie.maxAge !== undefined && cookie.maxAge <= 0;
      const isExpiredDate =
        cookie.expires !== undefined && !Number.isNaN(Date.parse(cookie.expires)) && Date.parse(cookie.expires) <= Date.now();
      const isEmptyCleared = cookie.value === '';

      if (isExpiredMaxAge || isExpiredDate || isEmptyCleared) {
        this.cookies.delete(cookie.name);
      } else {
        this.cookies.set(cookie.name, cookie);
      }
    }
    return parsedList;
  }

  get(name: string): ParsedCookie | undefined {
    return this.cookies.get(name);
  }

  getValue(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }

  set(name: string, value: string): void {
    this.cookies.set(name, {
      name,
      value,
      httpOnly: false,
      secure: false,
      raw: `${name}=${value}`,
    });
  }

  delete(name: string): void {
    this.cookies.delete(name);
  }

  clear(): void {
    this.cookies.clear();
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  entries(): ParsedCookie[] {
    return Array.from(this.cookies.values());
  }

  getHistory(): ParsedCookie[] {
    return [...this.setCookieHistory];
  }

  toCookieHeader(): string {
    return Array.from(this.cookies.values())
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  snapshot(): Record<string, ParsedCookie> {
    const out: Record<string, ParsedCookie> = {};
    for (const [key, val] of this.cookies.entries()) {
      out[key] = { ...val };
    }
    return out;
  }

  restore(snap: Record<string, ParsedCookie>): void {
    this.cookies.clear();
    for (const [key, val] of Object.entries(snap)) {
      this.cookies.set(key, { ...val });
    }
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  cookieJar?: CookieJar;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  tenantHost?: string;
  tenantSlug?: string;
  body?: unknown;
  skipCookieJar?: boolean;
  manualCookieHeader?: string;
  redirect?: 'follow' | 'manual' | 'error';
  timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Headers;
  setCookies: ParsedCookie[];
  body: T;
  rawText: string;
}

export class HttpClient {
  public readonly baseUrl: string;
  public readonly jar: CookieJar;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.jar = options.cookieJar ?? new CookieJar();
    this.defaultHeaders = { ...(options.defaultHeaders ?? {}) };
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const normalizedPath = path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...(options.headers ?? {}),
    };

    if (options.tenantHost) {
      headers['x-tenant-host'] = options.tenantHost;
    }
    if (options.tenantSlug) {
      headers['x-tenant-slug'] = options.tenantSlug;
    }

    if (options.manualCookieHeader !== undefined) {
      if (options.manualCookieHeader.length > 0) {
        headers['Cookie'] = options.manualCookieHeader;
      }
    } else {
      const cookieHeader = this.jar.toCookieHeader();
      if (cookieHeader.length > 0) {
        headers['Cookie'] = cookieHeader;
      }
    }

    let requestBody: string | undefined;
    if (options.body !== undefined) {
      if (typeof options.body === 'string') {
        requestBody = options.body;
      } else {
        requestBody = JSON.stringify(options.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 15_000,
    );

    try {
      const response = await fetch(normalizedPath, {
        method,
        headers,
        body: requestBody,
        redirect: options.redirect ?? 'follow',
        signal: controller.signal,
      });

      const rawSetCookies =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [];

      const setCookies = options.skipCookieJar
        ? rawSetCookies.map(parseSetCookieHeader)
        : this.jar.applySetCookies(rawSetCookies);

      const rawText = await response.text();
      let parsedBody: unknown = rawText;

      const contentType = response.headers.get('content-type') ?? '';
      if (
        rawText.length > 0 &&
        (contentType.includes('application/json') ||
          contentType.includes('application/problem+json') ||
          rawText.trimStart().startsWith('{') ||
          rawText.trimStart().startsWith('['))
      ) {
        try {
          parsedBody = JSON.parse(rawText);
        } catch {
          parsedBody = rawText;
        }
      } else if (rawText.length === 0) {
        parsedBody = null;
      }

      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        setCookies,
        body: parsedBody as T,
        rawText,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  get<T = unknown>(path: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  post<T = unknown>(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('POST', path, { ...options, body });
  }

  patch<T = unknown>(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  put<T = unknown>(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  delete<T = unknown>(path: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', path, options);
  }

  options<T = unknown>(path: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('OPTIONS', path, options);
  }
}
