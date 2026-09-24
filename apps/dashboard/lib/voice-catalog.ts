import { cached, fetchCatalog } from "@animus/brain/voice-catalog";

// Server-only: de API-key blijft in process.env en gaat nooit naar de client. 1 uur cache; Nederlands is de hoofdtaal.
export const getCatalog = cached(() => fetchCatalog(fetch, process.env.ELEVENLABS_API_KEY ?? "", "nl"), 60 * 60 * 1000);
