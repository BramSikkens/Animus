import { cached, fetchCatalog, fetchTier } from "@animus/core/voice-catalog";

// Server-only: de API-key blijft in process.env en gaat nooit naar de client. 1 uur cache; Nederlands is de hoofdtaal.
const key = () => process.env.ELEVENLABS_API_KEY ?? "";
// Abonnement-tier ("" = onbekend): korter gecachet zodat een upgrade snel doorwerkt.
export const getTier = cached(() => fetchTier(fetch, key()), 10 * 60 * 1000);
export const getCatalog = cached(async () => fetchCatalog(fetch, key(), "nl", await getTier()), 60 * 60 * 1000);
