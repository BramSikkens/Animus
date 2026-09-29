// Downloadt het sherpa-onnx-spreekherkenningsmodel naar apps/agent/models/ (niet gecommit, zie .gitignore) als het
// nog niet bestaat, en verifieert de SHA-256 tegen de hash uit checksum.txt van de release (ADR-0020).
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { get } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_NAME = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx";
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/${MODEL_NAME}`;
// Geverifieerd tegen checksum.txt van dezelfde release, en zelf nagerekend met `shasum -a 256` na download.
const EXPECTED_SHA256 = "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2";

const modelsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "models");
const dest = join(modelsDir, MODEL_NAME);
const tmp = `${dest}.tmp`;

if (existsSync(dest)) {
  console.log(`Model al aanwezig: ${dest}`);
  process.exit(0);
}

function download(url, file) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      // GitHub releases redirecten naar objects.githubusercontent.com.
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, file).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} bij downloaden van ${url}`));
        return;
      }
      const out = createWriteStream(file);
      res.pipe(out);
      out.on("finish", () => out.close(resolve));
      out.on("error", reject);
    }).on("error", reject);
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const rs = createReadStream(file);
    rs.on("data", (chunk) => hash.update(chunk));
    rs.on("end", () => resolve(hash.digest("hex")));
    rs.on("error", reject);
  });
}

mkdirSync(modelsDir, { recursive: true });

console.log(`Downloaden: ${MODEL_URL}`);
await download(MODEL_URL, tmp);

const actual = await sha256(tmp);
if (actual !== EXPECTED_SHA256) {
  unlinkSync(tmp);
  console.error(`SHA-256-mismatch voor ${MODEL_NAME}: verwacht ${EXPECTED_SHA256}, gekregen ${actual}.`);
  process.exit(1);
}

renameSync(tmp, dest);
console.log(`Model gedownload en geverifieerd: ${dest}`);
