import type { NextConfig } from "next";

// Zelfde .env als de REPL (repo-root); Next leest standaard enkel apps/dashboard/.env.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url).pathname);
} catch {
  // .env is optioneel.
}

const nextConfig: NextConfig = {
  transpilePackages: ["@animus/db", "@animus/brain"],
};

export default nextConfig;
