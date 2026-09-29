import { parseCommand, type GalleryMessage } from "@animus/protocol/gallery";

export const MAX_GRAVES = 50;

type EpitaphRow = { id: number; name: string; bornAt: Date; deletedAt: Date; farewellReflection: string };

/** `epitaphs` komt nieuwste eerst binnen; de Galerij toont hooguit de laatste MAX_GRAVES. */
export function galleryMessageFor(dynimos: { id: number; name: string; awakeSince: Date | null; bornAt: Date }[], epitaphs: EpitaphRow[]): GalleryMessage {
  return {
    beings: dynimos.map((d) => ({ id: d.id, name: d.name, awake: d.awakeSince !== null, bornAt: d.bornAt.toISOString() })),
    graves: epitaphs.slice(0, MAX_GRAVES).map((e) => ({
      id: e.id,
      name: e.name,
      bornAt: e.bornAt.toISOString(),
      deletedAt: e.deletedAt.toISOString(),
      farewell: e.farewellReflection,
    })),
  };
}

/**
 * Verwerkt een (onbetrouwbaar) commando van het gezichtje en publiceert daarna de nieuwe Galerij.
 * Lopende TTS: birth/wake/sleep/kill sturen NOTIFY, waarop de watcher in agent.ts de sessie onderbreekt.
 */
export function createCommandHandler(options: {
  brain: {
    list: () => Promise<{ id: number; awakeSince: Date | null }[]>;
    wake: (id: number) => Promise<unknown>;
    sleep: () => Promise<void>;
    kill: (id: number, confirmedName: string) => Promise<unknown>;
    bringToLife: () => Promise<unknown>;
  };
  publishGallery: () => void;
  onError: (error: unknown) => void;
}): (payload: unknown) => Promise<void> {
  return async (payload) => {
    const command = parseCommand(payload);
    if (!command) return;
    try {
      if (command.type === "birth") {
        await options.brain.bringToLife();
      } else if (command.type === "wake") {
        await options.brain.wake(command.id);
      } else if (command.type === "kill") {
        await options.brain.kill(command.id, command.name);
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
