import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { AccessToken } from "livekit-server-sdk";
import { defineConfig, type Plugin } from "vite";

// Zelfde .env als de andere apps (repo-root).
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // .env is optioneel.
}
process.env.LIVEKIT_URL ??= "ws://localhost:7880";
process.env.LIVEKIT_API_KEY ??= "devkey";
process.env.LIVEKIT_API_SECRET ??= "secret";

const ROOM_NAME = "animus";

// ponytail: alleen een dev-middleware, geen productie-backend — in #7 is er nog geen server om
// tokens uit te geven, en dit endpoint bestaat dan ook enkel tijdens `vite dev`.
function tokenEndpoint(): Plugin {
  return {
    name: "animus-token-endpoint",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/token", (_req, res) => {
        void (async () => {
          const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
            identity: `eigenaar-${randomUUID()}`,
          });
          at.addGrant({ roomJoin: true, room: ROOM_NAME });
          const token = await at.toJwt();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ serverUrl: process.env.LIVEKIT_URL, token }));
        })().catch((error: unknown) => {
          console.error("Token aanmaken faalde:", error);
          res.statusCode = 500;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tokenEndpoint()],
  server: { port: 5173, strictPort: true },
});
