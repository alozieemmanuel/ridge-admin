/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Linting is handled separately in CI; don't block `next build` on it.
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

module.exports = nextConfig;