/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Linting is handled separately in CI; don't block `next build` on it.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
