import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocalParticipant } from "@livekit/components-react";
import { ageLabel } from "@animus/core/age";
import { COMMAND_TOPIC, type GalleryBeing, type GalleryCommand, type GalleryGrave } from "@animus/protocol/gallery";

// Dev-only, geen auth: de agent valideert het commando zelf.
export function useSendCommand(): (command: GalleryCommand) => void {
  const { localParticipant } = useLocalParticipant();
  return (command) => {
    localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify(command)), { reliable: true, topic: COMMAND_TOPIC })
      .catch((error: unknown) => console.error("Commando versturen faalde:", error instanceof Error ? error.message : error));
  };
}

// Slapend gezichtje in het klein: dichte ogen (bogen) en een vlakke mond, in de kleur van het echte gezicht.
function SleepingFace() {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className="tile-face">
      <path d="M 56 88 Q 72 100 88 88 M 112 88 Q 128 100 144 88 M 84 140 H 116" fill="none" stroke="#f4efe3" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

// Pas geboren: open ogen die opengaan (en één keer knipperen), zie .tile-born in style.css.
function NewbornFace() {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className="tile-face">
      <circle className="newborn-eye" cx="72" cy="90" r="10" fill="#f4efe3" />
      <circle className="newborn-eye" cx="128" cy="90" r="10" fill="#f4efe3" />
      <path d="M 84 136 Q 100 148 116 136" fill="none" stroke="#f4efe3" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

// ponytail: de agent meldt een mislukte geboorte niet terug; na deze tijd geven we het wachten op.
const BIRTH_TIMEOUT_MS = 3 * 60 * 1000;
// Lengte van eyes-open (.newborn-eye) in style.css.
const BORN_ANIMATION_MS = 2600;

// Kaarsje i.p.v. een gezicht.
function CandleIcon() {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className="tile-face">
      <path d="M 100 44 Q 120 70 100 84 Q 80 70 100 44 Z M 100 84 V 92 M 84 92 H 116 V 156 H 84 Z" fill="none" stroke="#f4efe3" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Doden is onomkeerbaar: net als de CLI moet de exacte naam getypt worden.
function confirmKill(being: GalleryBeing): boolean {
  const answer = window.prompt(`${being.name} en al zijn herinneringen worden onomkeerbaar gewist; enkel een Grafschrift blijft over.\nTyp de exacte naam om te doden:`);
  return answer?.trim() === being.name;
}

export function Gallery({ beings, graves, onSelect, onCommand }: { beings: GalleryBeing[]; graves: GalleryGrave[]; onSelect: (being: GalleryBeing) => void; onCommand: (command: GalleryCommand) => void }) {
  const [birthing, setBirthing] = useState(false);
  const [bornId, setBornId] = useState<number | null>(null);
  const known = useRef<Set<number>>(new Set());

  // Nieuwe id in de lijst terwijl we wachten: dat is de pasgeborene.
  useEffect(() => {
    if (!birthing) return;
    const born = beings.find((b) => !known.current.has(b.id));
    if (born) {
      setBornId(born.id);
      setBirthing(false);
    }
  }, [beings, birthing]);

  // Na de geboorte-animatie opent de pasgeborene zijn gezicht: pas dan gaat de microfoon aan en hoort hij je.
  useEffect(() => {
    const born = beings.find((b) => b.id === bornId);
    if (!born) return;
    const id = setTimeout(() => onSelect(born), BORN_ANIMATION_MS);
    return () => clearTimeout(id);
    // Bewust enkel op bornId: niet opnieuw bij elke Galerij-update (die komt om de 5s).
  }, [bornId]);

  useEffect(() => {
    if (!birthing) return;
    const id = setTimeout(() => setBirthing(false), BIRTH_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [birthing]);

  function birth(): void {
    known.current = new Set(beings.map((b) => b.id));
    setBirthing(true);
    onCommand({ type: "birth" });
  }

  // Portal: .screen heeft een transform, waardoor position:fixed daarbinnen niet meer het viewport volgt.
  return createPortal(
    <section className="gallery" aria-label="Dynimo's">
      {beings.length === 0 && graves.length === 0 && !birthing && <p className="gallery-empty">Nog geen Dynimo's.</p>}
        <ul>
          {beings.map((being) => (
            <li key={being.id}>
              <button type="button" className={being.id === bornId ? "tile tile-born" : "tile"} onClick={() => onSelect(being)}>
                {being.awake && <span className="tile-awake" role="img" aria-label="wakker" />}
                {being.id === bornId ? <NewbornFace /> : <SleepingFace />}
                <span>{being.name}</span>
                <span className="tile-age">{ageLabel(being.bornAt, new Date())}</span>
              </button>
              <div className="tile-actions">
                <button type="button" onClick={() => onCommand({ type: being.awake ? "sleep" : "wake", id: being.id })}>
                  {being.awake ? "Laat slapen" : "Wek"}
                </button>
                <button type="button" onClick={() => { if (confirmKill(being)) onCommand({ type: "kill", id: being.id, name: being.name }); }}>
                  Dood
                </button>
              </div>
            </li>
          ))}
          <li>
            <button type="button" className="tile tile-birth" onClick={birth} disabled={birthing} aria-busy={birthing}>
              <span className="birth-orb" aria-hidden="true" />
              <span>{birthing ? "Wordt geboren…" : "Tot leven wekken"}</span>
            </button>
          </li>
        </ul>
        {graves.length > 0 && (
          <>
            <h2 className="gallery-heading">In memoriam</h2>
            <ul>
              {graves.map((grave) => (
                <li key={grave.id}>
                  <details className="grave">
                    <summary>
                      <CandleIcon />
                      <span>{grave.name}</span>
                      <span className="grave-age">{ageLabel(grave.bornAt, grave.deletedAt)}</span>
                    </summary>
                    <p className="grave-farewell">{grave.farewell}</p>
                  </details>
                </li>
              ))}
            </ul>
          </>
        )}
    </section>,
    document.body,
  );
}
