// PLACEHOLDER-geluiden voor #40: korte gesynthetiseerde WAV's (16-bit PCM mono, 16 kHz).
// De eigenaar vervangt deze door echte opnames met dezelfde bestandsnamen.
// Gebruik: node AI_utils/generate-placeholder-sounds.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 16000;
const OUT = new URL("../apps/face/public/sounds/", import.meta.url);

// kirren: korte stijgende tjirp; zuchten: dalende ruis-achtige toon; brommen: lage brom.
const SOUNDS = {
  "kirren-1": { dur: 0.35, f0: 700, f1: 1100, vib: 0 },
  "kirren-2": { dur: 0.3, f0: 800, f1: 1300, vib: 0 },
  "zuchten-1": { dur: 0.7, f0: 400, f1: 180, vib: 0 },
  "zuchten-2": { dur: 0.6, f0: 350, f1: 150, vib: 0 },
  "brommen-1": { dur: 0.8, f0: 90, f1: 80, vib: 12 },
  "brommen-2": { dur: 0.7, f0: 110, f1: 95, vib: 9 },
};

function wav({ dur, f0, f1, vib }) {
  const n = Math.floor(dur * RATE);
  const data = Buffer.alloc(n * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = f0 + (f1 - f0) * t + (vib ? 6 * Math.sin(2 * Math.PI * vib * (i / RATE)) : 0);
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.sin(Math.PI * t) ** 2; // zachte in- en uitfade
    const sample = env * 0.5 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
    data.writeInt16LE(Math.round(sample * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, spec] of Object.entries(SOUNDS)) writeFileSync(new URL(`${name}.wav`, OUT), wav(spec));
