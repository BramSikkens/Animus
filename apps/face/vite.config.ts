import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { AccessToken, AgentDispatchClient, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { defineConfig, type Plugin } from "vite";
import { EIGENAAR_PREFIX, livekitEnv } from "@animus/brain/security";

// Zelfde .env als de andere apps (repo-root).
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // .env is optioneel.
}
const livekit = livekitEnv(process.env);
process.env.LIVEKIT_URL = livekit.url;
process.env.LIVEKIT_API_KEY = livekit.apiKey;
process.env.LIVEKIT_API_SECRET = livekit.apiSecret;

const ROOM_NAME = "animus";
const AGENT_KIND = 4; // ParticipantInfo.Kind.AGENT (livekit-protocol), niet re-exported door de SDK
// Een verse room krijgt de agent automatisch; zo lang wachten we voor we zelf dispatchen.
const AGENT_JOIN_GRACE_S = 15;

// LiveKit dispatcht alleen bij het aanmaken van de room. Herstart de agent terwijl een face de room
// open houdt, dan blijft die room zonder agent (lege Galerij). Dan sturen we hem er expliciet in.
let lastDispatch = 0;
async function ensureAgent(): Promise<void> {
  const host = process.env.LIVEKIT_URL!.replace(/^ws/, "http");
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const rooms = new RoomServiceClient(host, key, secret);
  const [room] = await rooms.listRooms([ROOM_NAME]);
  if (!room || Date.now() / 1000 - Number(room.creationTime) < AGENT_JOIN_GRACE_S) return;
  const participants = await rooms.listParticipants(ROOM_NAME);
  if (participants.some((p) => p.kind === AGENT_KIND)) return;
  // De face vraagt dit herhaald zolang er geen agent is; een net gestuurde agent krijgt tijd om te joinen.
  if (Date.now() - lastDispatch < AGENT_JOIN_GRACE_S * 1000) return;
  lastDispatch = Date.now();
  await new AgentDispatchClient(host, key, secret).createDispatch(ROOM_NAME, "");
}

// ponytail: alleen een dev-middleware, zonder authenticatie en met één vaste room — veilig zolang
// `vite dev` enkel op localhost luistert (default; start dus niet met --host). Fase 1 kent één
// eigenaar; bij meerdere gebruikers of een productie-build hoort hier een echte, beveiligde backend.
function tokenEndpoint(): Plugin {
  return {
    name: "animus-token-endpoint",
    apply: "serve",
    configureServer(server) {
      // Face zonder agent in de room (bv. na een herstart van de agent terwijl de tab verbonden bleef).
      server.middlewares.use("/api/agent", (_req, res) => {
        ensureAgent()
          .catch((error: unknown) => console.error("Agent dispatchen faalde:", error))
          .finally(() => {
            res.statusCode = 204;
            res.end();
          });
      });
      server.middlewares.use("/api/token", (_req, res) => {
        void (async () => {
          await ensureAgent().catch((error: unknown) => console.error("Agent dispatchen faalde:", error));
          const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
            identity: `${EIGENAAR_PREFIX}${randomUUID()}`,
          });
          // Enkel wat het gezichtje echt nodig heeft: microfoon/camera publiceren, commando's/Waarnemingen
          // via data (canPublishData), geen eigen metadata-updates.
          at.addGrant({
            roomJoin: true,
            room: ROOM_NAME,
            canSubscribe: true,
            canPublish: true,
            canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA],
            canPublishData: true,
            canUpdateOwnMetadata: false,
          });
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
