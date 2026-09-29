import { test } from "node:test";
import assert from "node:assert/strict";
import { browserCandidates, findBrowser, kioskArgs } from "./kiosk.mjs";

test("browserCandidates: darwin geeft Chrome en Chromium app-paden", () => {
  assert.deepEqual(browserCandidates("darwin"), [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]);
});

test("browserCandidates: linux geeft chromium/chromium-browser/google-chrome commando's", () => {
  assert.deepEqual(browserCandidates("linux"), ["chromium", "chromium-browser", "google-chrome"]);
});

test("browserCandidates: overig platform geeft lege lijst", () => {
  assert.deepEqual(browserCandidates("win32"), []);
});

test("findBrowser: geeft eerste kandidaat waarvoor exists true is", () => {
  const exists = (candidate) => candidate === "chromium-browser";
  assert.equal(findBrowser("linux", exists), "chromium-browser");
});

test("findBrowser: geeft null als geen enkele kandidaat bestaat", () => {
  assert.equal(
    findBrowser("darwin", () => false),
    null,
  );
});

test("kioskArgs: bouwt de verwachte argumentenlijst", () => {
  assert.deepEqual(kioskArgs({ url: "http://localhost:5173/?kiosk=1", profileDir: "/tmp/profiel" }), [
    "--kiosk",
    "--user-data-dir=/tmp/profiel",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--no-first-run",
    "--no-default-browser-check",
    "http://localhost:5173/?kiosk=1",
  ]);
});
