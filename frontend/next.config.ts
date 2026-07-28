import { join } from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['shared'],
  typescript: { ignoreBuildErrors: true },
  // We run `next start`, not the standalone tracer, but 15.5 warns when it can't infer a single
  // workspace root (this is a monorepo with lockfiles at root and per-workspace). Pin it to the
  // repo root to silence the warning and make file tracing deterministic.
  outputFileTracingRoot: join(__dirname, ".."),
  async rewrites() {
    return [{
      source: '/api/:path*',
      destination: 'http://localhost:3001/api/:path*',
    }];
  },
};

export default nextConfig;
