import { createPortal } from "react-dom";
import { useLocalParticipant } from "@livekit/components-react";
import { COMMAND_TOPIC, type GalleryBeing, type GalleryCommand } from "@animus/brain/gallery";

// Dev-only, geen auth: de agent valideert het commando zelf.
function useSendCommand(): (command: GalleryCommand) => void {
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

export function Gallery({ beings }: { beings: GalleryBeing[] }) {
  const send = useSendCommand();
  // Portal: .screen heeft een transform, waardoor position:fixed daarbinnen niet meer het viewport volgt.
  return createPortal(
    <section className="gallery" aria-label="Dynimo's">
      {beings.length === 0 ? (
        <p className="gallery-empty">Nog geen Dynimo's. Laat er een geboren worden in het dashboard.</p>
      ) : (
        <ul>
          {beings.map((being) => (
            <li key={being.id}>
              <button type="button" className="tile" onClick={() => send({ type: "wake", id: being.id })}>
                <SleepingFace />
                <span>{being.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>,
    document.body,
  );
}

export function BackButton({ id }: { id: number }) {
  const send = useSendCommand();
  return (
    <button type="button" onClick={() => send({ type: "sleep", id })}>
      Terug
    </button>
  );
}
