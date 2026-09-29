// Opent het gezichtje schermvullend in Chrome/Chromium kiosk-mode (issue #122).
// Plain ESM, alleen Node-stdlib: geen extra dependency voor dit ene scriptje.
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEV_SERVER_URL = "http://localhost:5173";
const FACE_URL = `${DEV_SERVER_URL}/?kiosk=1`;
const PROFILE_DIR = path.join(os.homedir(), ".animus-kiosk");
const WAIT_TIMEOUT_MS = 20_000;
const WAIT_INTERVAL_MS = 500;

export function browserCandidates(platform) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  if (platform === "linux") {
    return ["chromium", "chromium-browser", "google-chrome"];
  }
  return [];
}

export function findBrowser(platform, exists) {
  return browserCandidates(platform).find((candidate) => exists(candidate)) ?? null;
}

export function kioskArgs({ url, profileDir }) {
  return [
    "--kiosk",
    `--user-data-dir=${profileDir}`,
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ];
}

// exists-check die zowel absolute paden (macOS-app-bundels) als kale commando's (Linux, via PATH) aankan.
function candidateExists(candidate) {
  if (path.isAbsolute(candidate)) return existsSync(candidate);
  return spawnSync("which", [candidate]).status === 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(WAIT_INTERVAL_MS * 4) });
      return true;
    } catch {
      await wait(WAIT_INTERVAL_MS);
    }
  }
  return false;
}

async function main() {
  const browser = findBrowser(process.platform, candidateExists);
  if (!browser) {
    console.error(
      `Geen Chrome of Chromium gevonden. Gezocht op: ${browserCandidates(process.platform).join(", ")}. Installeer Google Chrome of Chromium.`,
    );
    process.exit(1);
  }

  const serverReady = await waitForDevServer(DEV_SERVER_URL, WAIT_TIMEOUT_MS);
  if (!serverReady) {
    console.error(`De dev-server op ${DEV_SERVER_URL} antwoordt niet. Start eerst \`pnpm dev\` of \`pnpm face\`.`);
    process.exit(1);
  }

  const child = spawn(browser, kioskArgs({ url: FACE_URL, profileDir: PROFILE_DIR }), { stdio: "ignore" });

  // Scherm niet laten slapen zolang de kiosk draait; stopt vanzelf zodra de browser stopt.
  let caffeinate;
  if (process.platform === "darwin") {
    caffeinate = spawn("caffeinate", ["-d", "-w", String(child.pid)], { stdio: "ignore" });
  }

  child.on("error", (err) => {
    console.error(`Kon ${browser} niet starten: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    caffeinate?.kill();
    process.exit(code ?? 0);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
