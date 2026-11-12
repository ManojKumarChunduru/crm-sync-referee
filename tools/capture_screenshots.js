/**
 * Section-framed screenshots of the real HTML report, with the verdict badge read back.
 *
 * Builds the report with the CLI first, so the screenshot can never be of a stale file.
 * Frames by heading id rather than pixel offset; fails if a heading is missing. Reads the
 * computed style of the verdict badge and fails if it is invisible, because the only thing
 * in the pipeline that can see pixels is this tool. Writes a manifest with the readings.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadPlaywright } from "./browser.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "evidence");
mkdirSync(OUT, { recursive: true });
const html = join(OUT, "report.html");

const run = spawnSync(process.execPath, [
  join(ROOT, "bin", "csr"), "referee", "--salesforce", join(ROOT, "fixture", "salesforce"), "--external", join(ROOT, "fixture", "external"),
  "--contract", join(ROOT, "contract", "sync-contract.json"), "--html", html,
], { encoding: "utf8" });
if (![0, 1, 2].includes(run.status)) {
  console.error(`capture_screenshots: csr referee failed with ${run.status}\n${run.stderr}`);
  process.exit(1);
}

const SHOTS = [
  { name: "report-verdicts.png", from: "header", to: "normalised" },
  { name: "report-normalised-and-orphans.png", from: "normalised", to: null },
];

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`file://${html}`);

const badge = await page.evaluate(() => {
  const el = document.querySelector("#verdict");
  if (!el) return null;
  const style = getComputedStyle(el);
  return { text: el.textContent, colour: style.color, background: style.backgroundColor,
    visible: el.offsetWidth > 0 && el.offsetHeight > 0 };
});
if (badge === null || !badge.visible || badge.colour === badge.background) {
  console.error(`capture_screenshots: the verdict badge is missing or invisible: ${JSON.stringify(badge)}`);
  process.exit(1);
}

const manifest = { report: "docs/evidence/report.html", generatedBy: "tools/capture_screenshots.js", badge, shots: [] };
for (const shot of SHOTS) {
  const box = await page.evaluate(({ from, to }) => {
    const start = document.getElementById(from);
    if (!start) return { error: `heading ${from} not found` };
    const top = start.getBoundingClientRect().top + window.scrollY;
    let bottom;
    if (to === null) {
      bottom = document.documentElement.scrollHeight;
    } else {
      const end = document.getElementById(to);
      if (!end) return { error: `heading ${to} not found` };
      bottom = end.getBoundingClientRect().top + window.scrollY;
    }
    return { x: 0, y: Math.max(0, top - 8), width: document.documentElement.clientWidth, height: bottom - top + 8 };
  }, shot);
  if (box.error) {
    console.error(`capture_screenshots: ${box.error}; the report changed shape`);
    process.exit(1);
  }
  const path = join(OUT, shot.name);
  await page.screenshot({ path, fullPage: true, clip: box });
  manifest.shots.push({ file: `docs/evidence/${shot.name}`, framedBy: [shot.from, shot.to ?? "end of document"], clip: box });
  console.log(`capture_screenshots: ${shot.name} ${Math.round(box.width)}x${Math.round(box.height)}`);
}
await browser.close();
writeFileSync(join(OUT, "screenshots.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`capture_screenshots: badge reads "${badge.text}" ${badge.colour} on ${badge.background}`);
