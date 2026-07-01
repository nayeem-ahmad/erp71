import { withSentryConfig } from '@sentry/nextjs';
import { legacyRouteRedirects } from './src/lib/route-redirects.js';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [...legacyRouteRedirects];
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${BACKEND_URL}/api/v1/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
};

export default withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: !process.env.CI,
    widenClientFileUpload: true,
    webpack: {
        treeshake: { removeDebugLogging: true },
        automaticVercelMonitors: false,
    },
});
