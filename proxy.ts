import { NextResponse, type NextRequest } from 'next/server';

// ngrok's free-tier warning must not replace JSON/SSE with a browser interstitial.
// Set this on the server so EventSource streams receive it too.
export function proxy(request: NextRequest) {
  const backend = process.env.ORBIT_BACKEND_URL;
  if (!backend) return NextResponse.next();
  const hostname = new URL(backend).hostname;
  if (
    !['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io'].some((suffix) =>
      hostname.endsWith(suffix),
    )
  )
    return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set('ngrok-skip-browser-warning', '1');
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: '/api/:path*' };
