/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ordinals.com',
      },
      {
        protocol: 'https',
        hostname: 'api.hiro.so',
      },
    ],
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "img-src * data: blob: 'unsafe-inline';",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
