import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't infer a parent dir with a stray lockfile.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
