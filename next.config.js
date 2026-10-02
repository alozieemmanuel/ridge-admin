/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Linting is handled separately in CI; don't block `next build` on it.
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  async headers() {
    return [
      {
        // The logo used in emails. Long cache so mail apps (Gmail fetches images through
        // its own proxy) reuse it instead of re-downloading. If you replace this file,
        // give it a new name and update emailLogoUrl() in src/lib/email.ts.
        source: "/ridge-logo-email.png",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

module.exports = nextConfig;
