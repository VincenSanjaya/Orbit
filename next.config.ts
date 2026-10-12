import type { NextConfig } from 'next';
import { backendOrigin } from './lib/deployment';
const backend = backendOrigin(process.env.ORBIT_BACKEND_URL, process.env.VERCEL === '1');
const config: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  async rewrites() {
    return {
      beforeFiles: backend ? [{ source: '/api/:path*', destination: `${backend}/api/:path*` }] : [],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
