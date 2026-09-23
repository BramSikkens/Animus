import type { DisplayState } from "@animus/brain/display";

/**
 * Houdt bij wanneer het gezichtje "reflecterend" toont (Reflectie bij stilte, #28) en zorgt dat een verlopen
 * Reflectie het gezicht van een andere of slapende Dynimo nooit overschrijft. Sleutel = `awakeId:awakeSince`
 * van de Wakker-generatie waarop de Reflectie draait.
 */
export function createReflectionDisplay(deps: {
  getCurrentKey: () => string;
  publishDisplay: (display: DisplayState) => void;
  /** Publiceert de weergavetoestand (wakker/slapend) plus de huidige Stemming, vers gelezen. */
  publishState: () => void;
}) {
  let reflectingKey: string | undefined;

  function restore(): void {
    reflectingKey = undefined;
    deps.publishState();
  }

  return {
    /** Aangeroepen vlak vóór de Reflectie-call; een verouderde sleutel publiceert niets. */
    onStart(key: string): void {
      if (deps.getCurrentKey() !== key) return;
      reflectingKey = key;
      try {
        deps.publishDisplay("reflecterend");
      } catch (error) {
        // Een mislukte publicatie mag de Reflectie niet afbreken.
        console.error("Reflecterend publiceren faalde:", error instanceof Error ? error.message : error);
      }
    },
    /** Een uiting zet het gezicht meteen terug; de Reflectie zelf loopt door. */
    onUtterance(): void {
      if (reflectingKey !== undefined) restore();
    },
    /** Een Dynimo-wissel/slapen beëindigt het reflecterende gezicht zonder eigen publish (de watcher publiceert). */
    onSwitch(): void {
      reflectingKey = undefined;
    },
    /** Reflectie klaar: alleen terugzetten als het gezicht nog voor deze generatie op reflecterend staat. */
    onFinish(key: string): void {
      if (reflectingKey !== key) return;
      if (deps.getCurrentKey() !== key) {
        reflectingKey = undefined;
        return;
      }
      restore();
    },
    /** De weergavetoestand voor een snapshot (bv. late joiner): reflecterend zolang de Reflectie op deze sleutel loopt. */
    displayFor(key: string, base: DisplayState): DisplayState {
      return reflectingKey === key ? "reflecterend" : base;
    },
  };
}
