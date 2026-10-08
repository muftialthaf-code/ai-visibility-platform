/** @type {import('next').NextConfig} */
export default {
  // Workspace packages are published as TypeScript source, so Next compiles them.
  transpilePackages: ['@avp/db', '@avp/github', '@avp/runtime', '@avp/tenant-ops', '@avp/tenant-schema', '@avp/seo'],
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};
