// Spraakvolume (RMS, 0..1) ligt in de praktijk laag (~0.05-0.4); de gain vult het bereik van de mond.
const VOLUME_GAIN = 3;

/** Mondopening 0..1 als pure functie van het volume 0..1 van de agent-audiotrack (geen fonetische lipsync). */
export function mouthOpenForVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume * VOLUME_GAIN));
}
