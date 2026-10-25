// The dashboard lives under one address prefix, for example https://pertinencegroup.com/event.
// Change NEXT_PUBLIC_BASE_PATH (in .env and at build time) to move it. Use an empty value for the site root.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "/event").replace(/\/+$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  eslint: {
    // Linting is handled separately in CI; don't block `next build` on it.
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

module.exports = nextConfig;
