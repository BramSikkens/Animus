import { afterEach, vi } from "vitest";
import * as animusModule from "../src/index.js";

// #109: hear() slaat de Herinnering (en lastRecalledAt/toldAt) nu op de achtergrond op, ná het einde van de
// stream. Een test die niet zelf op settled() wacht mag geen Animus-instantie achterlaten met een nog-lopende
// schrijfactie: die botst anders (deadlock, want TRUNCATE wil een ACCESS EXCLUSIVE lock) met de volgende test
// z'n truncateAll() in beforeEach. Deze afterEach vangt dat generiek op, voor elke test in de hele suite.
const created = new Set<ReturnType<typeof animusModule.createAnimus>>();
const echt = animusModule.createAnimus;
// ponytail: leunt op vitest's SSR-modultransform, die named exports van een bronbestand herschrijft naar
// schrijfbare bindings — daardoor kan vi.spyOn hier het namespace-object zelf patchen, zonder dat elk testbestand
// zijn createAnimus-import hoeft te vervangen. Stopt dat ooit stil (bv. na een vitest-upgrade die de transform
// verandert): geen testfout, gewoon een spy die nooit iets onderschept. Upgradepad dan: een expliciete registry
// (bv. createAnimus zelf een optionele `onCreate`-hook geven, of elk testbestand een lokale `trackedCreateAnimus`-
// wrapper laten gebruiken i.p.v. deze globale spy). Handmatig geverifieerd dat de spy nu wél onderschept: elke
// createAnimus()-aanroep in de suite loggen (tijdelijk) gaf één regel per aanroep.
vi.spyOn(animusModule, "createAnimus").mockImplementation((...args: Parameters<typeof echt>) => {
  const animus = echt(...args);
  created.add(animus);
  return animus;
});

afterEach(async () => {
  await Promise.allSettled([...created].map((animus) => animus.settled()));
  created.clear();
});
