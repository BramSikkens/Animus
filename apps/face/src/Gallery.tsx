import { createPortal } from "react-dom";
import { useLocalParticipant } from "@livekit/components-react";
import { ageLabel } from "@animus/brain/age";
import { COMMAND_TOPIC, type GalleryBeing, type GalleryCommand, type GalleryGrave } from "@animus/brain/gallery";

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

// Kaarsje i.p.v. een gezicht.
function CandleIcon() {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className="tile-face">
      <path d="M 100 44 Q 120 70 100 84 Q 80 70 100 44 Z M 100 84 V 92 M 84 92 H 116 V 156 H 84 Z" fill="none" stroke="#f4efe3" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Gallery({ beings, graves, onSelect }: { beings: GalleryBeing[]; graves: GalleryGrave[]; onSelect: (being: GalleryBeing) => void }) {
  // Portal: .screen heeft een transform, waardoor position:fixed daarbinnen niet meer het viewport volgt.
  return createPortal(
    <section className="gallery" aria-label="Dynimo's">
      {beings.length === 0 && graves.length === 0 ? (
        <p className="gallery-empty">Nog geen Dynimo's. Laat er een geboren worden in het dashboard.</p>
      ) : (
        <>
        {beings.length > 0 && <ul>
          {beings.map((being) => (
            <li key={being.id}>
              <button type="button" className="tile" onClick={() => onSelect(being)}>
                {being.awake && <span className="tile-awake" role="img" aria-label="wakker" />}
                <SleepingFace />
                <span>{being.name}</span>
              </button>
            </li>
          ))}
        </ul>}
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
        </>
      )}
    </section>,
    document.body,
  );
}
