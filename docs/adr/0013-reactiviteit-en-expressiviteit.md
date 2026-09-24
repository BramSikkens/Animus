# Reactiviteit en expressiviteit als extra persoonlijkheidsassen

De vier MBTI-assen kunnen 'robot met weinig emoties' of 'schattig wezentje' niet uitdrukken. We voegen twee assen toe, `axis_reactivity` en `axis_expressiveness` (real 0–1, NOT NULL, default 0.5, dus bestaande Dynimo's blijven zoals ze waren). Ze zitten niet in het MBTI-type (`mbtiType` kijkt enkel naar ie/sn/tf/jp) en worden niet door genesis of backfill bepaald: ze starten op 0.5 en verschuiven daarna via de Reflectie, binnen dezelfde grens (±0.02 per Reflectie) als de andere assen.

Reactiviteit r schaalt met één factor `0.25 + 1.5·r` (0 → 0.25, 0.5 → 1, 1 → 1.75) zowel de Type1-delta's in `applyDeltas` als de halveringstijd van het uitdoven in `currentMood`: een reactieve Dynimo beweegt sterker en dooft langzamer uit. Bij r = 0.5 verandert er niets aan ADR-0012. Expressiviteit wordt voorlopig enkel opgeslagen en in de Type2-prompt gebruikt; stem en gezicht volgen in latere tickets.

De Type2-prompt kreeg in dezelfde stap concrete gedragsregels per as-uiteinde (harde, controleerbare instructies bij sterke waarden, zachte neigingen bij gematigde, niets rond het midden) in plaats van een MBTI-label met vage richtlijnen.
