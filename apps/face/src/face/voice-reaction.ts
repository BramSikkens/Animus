/** Reactie-parameters 0..1 op de stem van de Gesprekspartner (volumevenster, oud→nieuw, ~1 sample/100ms). */
export type VoiceReaction = { startle: number; lean: number; alert: number };

const STARTLE_RATIO = 2.5; // sample >= 2,5× het lopende gemiddelde ervoor
const STARTLE_MIN = 0.3; // en absoluut boven deze drempel
const STARTLE_PULSE = 4; // samples (~400ms) waarover de puls afneemt

const LEAN_WINDOW = 20; // samples (~2s) die 'aanhoudend' vormen
const WHISPER_MIN = 0.02; // onder dit gemiddelde is het stilte
const WHISPER_MAX = 0.12; // erboven is het gewoon spreken

const ALERT_WINDOW = 10; // samples (~1s)
const PEAK_RISE = 0.15; // stijging tussen twee samples die als piek telt
const ALERT_PEAKS_FROM = 2; // pieken tot hier: gewoon praten
const ALERT_PEAKS_FULL = 5; // vanaf hier volledig alert

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function voiceReaction({ samples, baseline }: { samples: number[]; baseline: number }): VoiceReaction {
  const s = samples.map((v) => Math.max(0, v - baseline));
  let startle = 0;
  for (let age = 0; age < STARTLE_PULSE && age < s.length - 1; age++) {
    const i = s.length - 1 - age;
    const prior = mean(s.slice(0, i));
    if (s[i] >= STARTLE_MIN && s[i - 1] < STARTLE_MIN && s[i] >= STARTLE_RATIO * prior) startle = Math.max(startle, 1 - age / STARTLE_PULSE);
  }
  const recent = s.slice(-LEAN_WINDOW);
  const avg = recent.length === LEAN_WINDOW ? mean(recent) : 0;
  const lean = avg > WHISPER_MIN && avg < WHISPER_MAX ? 1 : 0;
  const w = s.slice(-ALERT_WINDOW);
  let peaks = 0;
  for (let i = 1; i < w.length; i++) if (w[i] - w[i - 1] >= PEAK_RISE) peaks++;
  const alert = Math.min(1, Math.max(0, (peaks - ALERT_PEAKS_FROM) / (ALERT_PEAKS_FULL - ALERT_PEAKS_FROM)));
  return { startle, lean, alert };
}
