import { ReadableStream } from "node:stream/web";
import type { Brain } from "@animus/brain";
import { LOOK_TOPIC } from "@animus/brain/perception";
import { SOUND_TOPIC, type SoundMessage } from "@animus/brain/sound";
import { EMOTION_TOPIC, type EmotionMessage } from "@animus/brain/emotion";
import { llm, voice, type ChatContext, type ChatMessage, type JobContext, type ToolContext } from "@livekit/agents";
import { withFaceExpressiveness } from "./state-republish.js";
import { decideGesprekspartner, shouldOverrideGesprekspartner } from "./gesprekspartner.js";
import { createFaces } from "./faces.js";
import type { SpeakerId } from "./speaker-id.js";
import { createSpeakerAudio } from "./speaker-audio.js";
import { textStream } from "./text-stream.js";

// LiveKit genereert enkel een antwoord als er een LLM gezet is (agent_activity.userTurnCompleted:
// `if (this.llm === undefined) return`), ook al vervangt llmNode het LLM-pad volledig. Zonder
// deze placeholder blijft de agent stil na elke beurt. chat() wordt nooit aangeroepen.
class BrainPlaceholderLLM extends llm.LLM {
  label(): string {
    return "animus-brain";
  }

  chat(): never {
    throw new Error("BrainPlaceholderLLM.chat() mag niet aangeroepen worden: llmNode draait het brein.");
  }
}

export class AnimusAgent extends voice.Agent {
  readonly #brain: Brain;
  readonly #room: JobContext["room"];
  readonly #onUtterance: () => void;
  readonly #onMoodValues: (values: EmotionMessage["values"]) => void;
  readonly #getExpressiveness: () => number;
  readonly #onBeurtAfgelopen: (gesprekspartner: number | null | undefined) => void;
  readonly #speaker: { speakerId: SpeakerId; audio: ReturnType<typeof createSpeakerAudio> } | undefined;
  readonly #faces: ReturnType<typeof createFaces>;
  #pendingInitiative: string | undefined;
  // ponytail: hoogstens één lopende inschrijving tegelijk (een scalar, geen wachtrij); twee tegelijk leren kennen
  // in dezelfde sessie komt in de praktijk niet voor.
  #enrollingPersonId: number | undefined;
  // In-flight-guard: voorkomt dat een tweede, snel opvolgende beurt een nieuwe enroll()-aanroep start terwijl de
  // vorige nog loopt (die kan de profiler intern al hebben afgerond en losgelaten).
  #enrolling = false;

  constructor(
    brain: Brain,
    room: JobContext["room"],
    onUtterance: () => void,
    onMoodValues: (values: EmotionMessage["values"]) => void,
    getExpressiveness: () => number = () => 0.5,
    speaker: { speakerId: SpeakerId; audio: ReturnType<typeof createSpeakerAudio> } | undefined,
    faces: ReturnType<typeof createFaces>,
    onBeurtAfgelopen: (gesprekspartner: number | null | undefined) => void = () => {},
  ) {
    // instructions is verplicht op voice.Agent, maar onbenut: llmNode hieronder draait i.p.v. het
    // ingebouwde LLM-pad de brein-kern.
    super({ instructions: "Animus", llm: new BrainPlaceholderLLM() });
    this.#brain = brain;
    this.#room = room;
    this.#onUtterance = onUtterance;
    this.#onMoodValues = onMoodValues;
    this.#getExpressiveness = getExpressiveness;
    this.#speaker = speaker;
    this.#faces = faces;
    this.#onBeurtAfgelopen = onBeurtAfgelopen;
  }

  /** Zet een spontane uiting klaar; de eerstvolgende llmNode (via session.generateReply) draait die i.p.v. een user-turn. */
  queueInitiative(instruction: string): void {
    this.#pendingInitiative = instruction;
  }

  /** Wist de lopende stem-inschrijving (#107): bij `persons:`, een wissel van Dynimo of slapen is ze niet meer geldig. */
  cancelEnrollment(): void {
    this.#enrollingPersonId = undefined;
  }

  override async llmNode(chatCtx: ChatContext, _toolCtx: ToolContext): Promise<ReadableStream<string> | null> {
    const isUserMessage = (item: ChatContext["items"][number]): item is ChatMessage =>
      item.type === "message" && item.role === "user";
    const initiative = this.#pendingInitiative;
    this.#pendingInitiative = undefined;

    // Altijd draineren zodra er een speaker-module is — ook bij initiatief of een overgeslagen beurt (geen tekst)
    // — anders lekt audio van een periode die niet gebruikt werd door naar een latere identify/enroll.
    const pcm = this.#speaker?.audio.drain();

    const text = initiative ?? chatCtx.items.filter(isUserMessage).at(-1)?.textContent;
    if (!text) return null;
    this.#onUtterance();

    // Gezichten (#93): wie is nu in beeld/aanwezig, ongeacht stemherkenning (ook bij initiatief).
    const now = Date.now();
    const facesInView = this.#faces.inView(now);
    const aanwezig = this.#faces.present(now);

    // Stemherkenning (#92): enkel bij een echte beurt (niet bij initiatief, dan spreekt de Dynimo zelf).
    let identified: { personId: number; score: number } | null = null;
    if (this.#speaker && initiative === undefined && pcm && pcm.length > 0) {
      try {
        identified = this.#speaker.speakerId.identify(pcm);
      } catch (error) {
        // Nooit de beurt breken op een identificatiefout: gedraagt zich als geen match (onbekend/eigenaar-regel).
        console.warn("Stem identificeren faalde:", error instanceof Error ? error.message : error);
      }
    }
    const hasSpeaker = this.#speaker !== undefined && initiative === undefined;
    // Beslisregel (#92/#93): stem zeker → die Persoon; anders precies één bekend gezicht in beeld → die; anders
    // onbekend. Zonder enig signaal (geen stemherkenning én geen gezicht in beeld) wordt gesprekspartner weggelaten
    // (hear() valt dan terug op de eigenaar) — dat is het enige geval dat exact het gedrag van vóór stem-/
    // gezichtsherkenning blijft. Met camera én zonder stemherkenning is de eigenaar zelf (nog zonder gezichts-
    // embeddings) géén uitzondering: hij begint ook als onbekend gezicht, en de nieuwe Persoon die daaruit ontstaat
    // moet nadien via het dashboard (#95) weer met "eigenaar" samengevoegd worden.
    let gesprekspartner: number | null | undefined;
    if (shouldOverrideGesprekspartner({ hasSpeaker, faces: facesInView })) {
      gesprekspartner = decideGesprekspartner({ voice: hasSpeaker ? identified && { personId: identified.personId, sure: true } : null, faces: facesInView });
    }
    if (hasSpeaker && pcm) {
      // Onzeker terwijl er een inschrijving loopt: dan is dit hoogstwaarschijnlijk nog steeds die Persoon (zijn
      // profiel is nog niet compleet genoeg om zichzelf te herkennen).
      if (identified === null && this.#enrollingPersonId !== undefined) gesprekspartner = this.#enrollingPersonId;
      // Enkel voeden als déze beurt ook echt aan de ingeschreven Persoon werd toegeschreven (niet bv. een andere,
      // al bekende stem die net het gesprek overnam), en niet terwijl een vorige enroll()-aanroep nog loopt.
      if (gesprekspartner === this.#enrollingPersonId && this.#enrollingPersonId !== undefined && pcm.length > 0 && !this.#enrolling) {
        const enrollingPersonId = this.#enrollingPersonId;
        this.#enrolling = true;
        this.#speaker!.speakerId
          .enroll(enrollingPersonId, pcm)
          .then((status) => {
            // Klaar of opgegeven (#107): niet meer inschrijvend. Enkel als het nog dezelfde inschrijving is (intussen
            // gewist of een nieuwe Persoon leren kennen mag deze late afloop niet overschrijven).
            if (status !== "bezig" && this.#enrollingPersonId === enrollingPersonId) this.#enrollingPersonId = undefined;
          })
          .catch((error: unknown) => console.warn("Stemprofiel opbouwen faalde:", error instanceof Error ? error.message : error))
          .finally(() => {
            this.#enrolling = false;
          });
      }
    }

    // tool-*-events uit brain.hear() worden hier genegeerd (ticket #7).
    return textStream(this.#brain.hear(text, { initiatief: initiative !== undefined, ...(gesprekspartner !== undefined && { gesprekspartner }), ...(aanwezig.length > 0 && { aanwezig }) }), {
      // Na afloop van de beurt (#105): de kenmerken opnieuw publiceren met de Gesprekspartner van déze beurt,
      // want de Vertrouwdheid kan tijdens de beurt verschoven zijn.
      onDone: () => this.#onBeurtAfgelopen(gesprekspartner),
      onPersoon: (personId) => {
        // Net leren kennen (#92): het stemprofiel van deze nieuwe Persoon beginnen opbouwen. hear() bindt de rest
        // van déze beurt aan de nieuwe Persoon (reviewfix #105): de Gesprekspartner die onDone hierboven straks
        // rapporteert moet dus ook bijgewerkt worden, ongeacht wat vóór het antwoord bekend was (onbekend/geen signaal).
        this.#enrollingPersonId = personId;
        gesprekspartner = personId;
      },
      onMood: (message) => {
        // Vóór de eerste tekst (dus vóór de TTS-context van deze beurt opent): emotie in de stem.
        this.#onMoodValues(message.values);
        const participant = this.#room.localParticipant;
        if (!participant) {
          console.error("Emotie niet gepubliceerd: agent is (nog) niet verbonden met de room.");
          return;
        }
        // Fire-and-forget: een mislukte publicatie mag de beurt niet breken.
        participant
          .publishData(new TextEncoder().encode(JSON.stringify(withFaceExpressiveness(message, this.#getExpressiveness()))), { reliable: true, topic: EMOTION_TOPIC })
          .catch((error: unknown) => {
            console.error("Emotie publiceren faalde:", error instanceof Error ? error.message : error);
          });
      },
      onSound: (kind) => {
        const participant = this.#room.localParticipant;
        if (!participant) return;
        const message: SoundMessage = { kind };
        participant
          .publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: SOUND_TOPIC })
          .catch((error: unknown) => {
            console.error("Geluid publiceren faalde:", error instanceof Error ? error.message : error);
          });
      },
      onLook: () => {
        const participant = this.#room.localParticipant;
        if (!participant) return;
        participant
          .publishData(new TextEncoder().encode(JSON.stringify({})), { reliable: true, topic: LOOK_TOPIC })
          .catch((error: unknown) => {
            console.error("Kijk-event publiceren faalde:", error instanceof Error ? error.message : error);
          });
      },
    });
  }
}
