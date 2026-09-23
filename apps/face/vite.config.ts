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

// ponytail: alleen een dev-middleware, zonder authenticatie en met één vaste room — veilig zolang
// `vite dev` enkel op localhost luistert (default; start dus niet met --host). Fase 1 kent één
// eigenaar; bij meerdere gebruikers of een productie-build hoort hier een echte, beveiligde backend.
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
