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
};

module.exports = nextConfig;
