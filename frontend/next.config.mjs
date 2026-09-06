import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Keep first-party test fixtures in source/build stages only.
  outputFileTracingExcludes: {
    "/*": ["./tests/**/*", "./**/*.test.*", "./**/*.spec.*"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
