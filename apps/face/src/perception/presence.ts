/** Pure aanwezigheidsdetector: gezicht-in-beeld-frames → Waarneming, met debounce tegen flikkeren. */
export function createPresence({ debounceMs }: { debounceMs: number }) {
  let candidate: boolean | undefined;
  let candidateSince = 0;
  let lastReported: "aanwezig" | "afwezig" | undefined;

  return {
    update(faceVisible: boolean, t: number): "aanwezig" | "afwezig" | null {
      if (candidate !== faceVisible) {
        candidate = faceVisible;
        candidateSince = t;
      }
      if (t - candidateSince < debounceMs) return null;
      const settled = faceVisible ? "aanwezig" : "afwezig";
      if (settled === lastReported) return null;
      lastReported = settled;
      return settled;
    },
  };
}
