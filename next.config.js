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
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; img-src 'self' https://ordinals.com https://api.hiro.so data: blob:; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://ordinals.com https://api.hiro.so https://hpec-dao-backend-0d9de4c43824.herokuapp.com;",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
