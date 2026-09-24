import { parseCommand, type GalleryMessage } from "@animus/brain/gallery";

export function galleryMessageFor(dynimos: { id: number; name: string; awakeSince: Date | null }[]): GalleryMessage {
  return { beings: dynimos.map((d) => ({ id: d.id, name: d.name, awake: d.awakeSince !== null })) };
}

/**
 * Verwerkt een (onbetrouwbaar) commando van het gezichtje en publiceert daarna de nieuwe Galerij.
 * Lopende TTS: wake/sleep sturen NOTIFY, waarop de watcher in agent.ts de sessie onderbreekt.
 */
export function createCommandHandler(options: {
  brain: {
    list: () => Promise<{ id: number; awakeSince: Date | null }[]>;
    wake: (id: number) => Promise<unknown>;
    sleep: () => Promise<void>;
  };
  publishGallery: () => void;
  onError: (error: unknown) => void;
}): (payload: unknown) => Promise<void> {
  return async (payload) => {
    const command = parseCommand(payload);
    if (!command) return;
    try {
      if (command.type === "wake") {
        await options.brain.wake(command.id);
      } else {
        // brain.sleep() legt iedereen slapen; enkel als dit echt de wakkere is, anders is de Terug verlopen.
        const awake = (await options.brain.list()).find((d) => d.awakeSince);
        if (awake?.id === command.id) await options.brain.sleep();
      }
      options.publishGallery();
    } catch (error) {
      options.onError(error);
    }
  };
}
