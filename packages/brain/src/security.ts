// Node-only (leest env-vars); geen browser-import zoals gallery.ts.

/** Identity-prefix voor de enige (Fase 1) gebruiker; de face-tokenroute genereert `${EIGENAAR_PREFIX}${uuid}`. */
export const EIGENAAR_PREFIX = "eigenaar-";

/** Enkel deze identity mag commando's sturen, Waarnemingen sturen en gevolgd worden (microfoon/camera). */
export function isEigenaar(identity: string): boolean {
  return identity.startsWith(EIGENAAR_PREFIX);
}

export type LivekitEnv = { url: string; apiKey: string; apiSecret: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * LIVEKIT_URL valt terug op de lokale dev-server; LIVEKIT_API_KEY/SECRET vallen enkel terug op
 * devkey/secret als die URL naar localhost wijst. Bij een niet-lokale host zonder key/secret: een
 * duidelijke fout i.p.v. stilzwijgend devkey/secret gebruiken tegen een echte server.
 */
export function livekitEnv(env: Record<string, string | undefined>): LivekitEnv {
  const url = env.LIVEKIT_URL ?? "ws://localhost:7880";
  const isLocal = LOCAL_HOSTS.has(new URL(url).hostname);
  const apiKey = env.LIVEKIT_API_KEY ?? (isLocal ? "devkey" : undefined);
  const apiSecret = env.LIVEKIT_API_SECRET ?? (isLocal ? "secret" : undefined);
  if (!apiKey || !apiSecret) {
    throw new Error("LIVEKIT_API_KEY en LIVEKIT_API_SECRET zijn verplicht als LIVEKIT_URL niet naar localhost wijst.");
  }
  return { url, apiKey, apiSecret };
}
