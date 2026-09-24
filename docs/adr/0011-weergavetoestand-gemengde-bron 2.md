# Weergavetoestand: LiveKit's ingebouwde AgentState/UserState voor luisterend/spreekt, eigen logica voor reflecterend/slapend

`@livekit/agents` levert al `AgentState` (`idle`/`listening`/`thinking`/`speaking`) en `UserState` (`speaking`/`listening`/`away`) via `AgentStateChanged`/`UserStateChanged`, tot nu toe ongebruikt in `agent.ts`. Voor de nieuwe *luisterend*- en *spreekt*-Weergavetoestanden luiden we die ingebouwde events door naar het gezichtje via het bestaande `DISPLAY_TOPIC`-datachannel, in plaats van zelf iets te bouwen wat LiveKit al bijhoudt.

*Reflecterend* en *slapend* blijven eigen logica: die bestaan niet in LiveKit's voice-state-machine, want Reflectie en de meerdere-Dynimo's-levenscyclus (fase 2a) zijn Animus-specifiek. De Weergavetoestand krijgt dus bewust een gemengde bron — twee toestanden uit LiveKit, twee uit eigen code — in plaats van alles naar één kant te trekken puur voor consistentie.
