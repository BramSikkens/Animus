# Stemming is een vector van alle emoties, geen enkele winnaar

De Stemming was één Emotie met een intensiteit: een nieuwe Emotie verving haar enkel bij strikt hogere intensiteit. Daardoor bleef een sterke emotie (boos op 96) hangen terwijl de Gesprekspartner geruststelde, want een zwakkere Emotie kon haar nooit verdringen en een Emotie kon niet actief omlaag. We slaan nu voor elke Emotie een waarde 0–100 op (plus een tijdstip), de hoogste is de zichtbare Emotie, en Type1 levert per uiting delta's per Emotie (ook negatief) die worden opgeteld en geclampt.

Uitdoven gebeurt per Emotie, exponentieel naar een ruststand (Basisemotie 30, rest 0) met een halveringstijd van 3 minuten in plaats van 10, zodat de Stemming vlotter meebeweegt met het gesprek. De vector staat als `jsonb` in `dynimos.mood_values` naast `mood_at`; bestaande rijen zijn gemigreerd (oude intensiteit × 100 op de oude Emotie, rest 0). Het data-channel-bericht naar het gezichtje draagt de volledige vector plus de dominante Emotie, zodat het gezichtje de bijmenging kan tonen zonder de winnaar zelf te hoeven bepalen.

Bewust niet gewijzigd: de Ontwaakstemming en de Droom (Reflectie) blijven één Emotie met een intensiteit; bij het wekken wordt die één Emotie de vector (die Emotie op intensiteit × 100, de rest op 0).
