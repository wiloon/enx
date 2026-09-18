import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Evaluated when the server starts, not at build time -- this is what lets
  // the browser talk to the API without the API host being baked into the
  // bundle. ApiService therefore calls same-origin /api/*.
  async rewrites() {
    const apiBaseUrl = process.env.API_BASE_URL || "https://enx-api.wiloon.lab";
    return [
      { source: "/api/:path*", destination: `${apiBaseUrl}/api/:path*` },
    ];
  },
  eslint: {
    // `next build` runs ESLint and fails the build on any error. Until the
    // repo-wide formatting decision is made, that would block deploys:
    // eslint.config.mjs was broken for a long time (its flat config had
    // `plugins` as an array of strings, so ESLint fatally errored and linted
    // nothing), which let ~2000 prettier/prettier violations accumulate
    // unnoticed. Repairing the config turned all of them into build errors.
    //
    // Linting is still available on demand via `npx eslint .` -- this only
    // decouples it from the production build, which is where Next 15 is
    // headed anyway now that `next lint` is deprecated. Remove this once the
    // backlog is cleared (either reformat to match .prettierrc, or change
    // .prettierrc to match the code) and lint runs in CI instead.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
