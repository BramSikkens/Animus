import type { NextConfig } from "next";

// Zelfde .env als de REPL (repo-root); Next leest standaard enkel apps/dashboard/.env.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url).pathname);
} catch {
  // .env is optioneel.
}

const nextConfig: NextConfig = {
  transpilePackages: ["@animus/db", "@animus/brain"],
  // @animus/brain importeert zijn eigen bestanden als "./x.js" (NodeNext); Turbopack mapt dat niet naar .ts.
  // Daarom draait het dashboard op webpack (zie de scripts in package.json).
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
