import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host');
  if (!hostname) {
    return NextResponse.next();
  }

  // Example: admin.localhost:3000 -> superadmin, store.localhost:3000 -> store/store
  // Simple resolution based on requirements:
  // admin.* -> /superadmin
  // <slug>.* -> /store/[slug]
  
  const url = request.nextUrl.clone();

  if (hostname.startsWith('admin.')) {
    url.pathname = `/superadmin${url.pathname}`;
    return NextResponse.rewrite(url, {
      request: {
        headers: new Headers(request.headers),
      },
    });
  }

  // Assuming host is <slug>.localhost or <slug>.domain.com
  const slug = hostname.split('.')[0];
  if (slug && slug !== 'localhost' && slug !== 'www') {
    url.pathname = `/store/${slug}${url.pathname}`;
    
    // Inject x-tenant-host
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-tenant-host', hostname);
    
    return NextResponse.rewrite(url, {
      request: {
        headers: requestHeaders,
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (_next/api)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
