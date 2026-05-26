import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";


const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(configDirectory, "../..");


const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    reactDebugChannel: false,
  },
  turbopack: {
    root: repositoryRoot,
  },
};


export default nextConfig;