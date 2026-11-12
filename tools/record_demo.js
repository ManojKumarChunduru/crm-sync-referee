/**
 * Records the demo: a replay of captured stdout, not a screen recording.
 *
 * Runs each command, captures its real stdout, stderr, exit code and wall time; builds a
 * self-contained HTML player that types the command and reveals the captured output paced by
 * the measured wall time (clamped so a long command does not stall the replay, and the clamp
 * is recorded in the manifest); records the page with Playwright; transcodes with ffmpeg to an
 * MP4 and a two-pass palette GIF (6 fps, 800 px wide, 32 colours) that stays under 5 MB.
 * Every line of terminal text in the video is captured output. None is hand-written.
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { loadPlaywright } from "./browser.js";
import { startServer, DEFAULT_CONFIG } from "../mock/server.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "evidence");
mkdirSync(OUT, { recursive: true });

const FIX = ["--salesforce", "fixture/salesforce", "--external", "fixture/external", "--contract", "contract/sync-contract.json"];
const FIX_TEXT = FIX.join(" ");
const expected = JSON.parse(readFileSync(join(ROOT, "fixture", "EXPECTED_VERDICTS.json"), "utf8"));
const echoRow = expected.rows.find((r) => r.cause === "echo_of_stale_value");

// The pull segment talks to the mock external system. It has to be a separate process: the segments are
// captured with spawnSync, which blocks this process's event loop, and an Express server started in here
// would never answer (the first recording produced UND_ERR_HEADERS_TIMEOUT for exactly that reason).
const probe = await startServer({ port: 0 });
const mockPort = probe.port;
await probe.close();
const mockProcess = spawn(process.execPath, ["mock/server.js", "--port", String(mockPort)], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve, reject) => {
  mockProcess.stdout.on("data", (chunk) => { if (String(chunk).includes("listening")) resolve(); });
  mockProcess.on("exit", (code) => reject(new Error(`mock exited with ${code} before listening`)));
});
const mock = { baseUrl: `http://127.0.0.1:${mockPort}` };
const pullOut = join(tmpdir(), "csr-demo-erp");
rmSync(pullOut, { recursive: true, force: true });

const SEGMENTS = [
  { title: "The contract: who owns each field, and which writes are the integration's own", command: "node bin/csr contract --contract contract/sync-contract.json", args: ["bin/csr", "contract", "--contract", "contract/sync-contract.json"], tailLines: 22 },
  { title: "Every difference, with the stale side named or the reason no side can be", command: `node bin/csr referee ${FIX_TEXT}`, args: ["bin/csr", "referee", ...FIX], tailLines: 24 },
  { title: "One field: the echo of a stale value a timestamp comparison gets backwards", command: `node bin/csr explain ${echoRow.object}.${echoRow.field} ${echoRow.key} ${FIX_TEXT}`, args: ["bin/csr", "explain", `${echoRow.object}.${echoRow.field}`, echoRow.key, ...FIX] },
  { title: "The same run with a 30-day archive of change events instead of the 72-hour bus", command: `node bin/csr referee ${FIX_TEXT} --window 720h`, args: ["bin/csr", "referee", ...FIX, "--window", "720h"], tailLines: 3 },
  { title: "The external side pulled over REST with a client-credentials token, paginated, backing off on 429", command: `node bin/csr pull --from ${mock.baseUrl} --client-id sf-sync-bridge --client-secret fixture-secret-not-a-secret --contract contract/sync-contract.json --out ${pullOut} --limit 20`, args: ["bin/csr", "pull", "--from", mock.baseUrl, "--client-id", DEFAULT_CONFIG.client_id, "--client-secret", DEFAULT_CONFIG.client_secret, "--contract", "contract/sync-contract.json", "--out", pullOut, "--limit", "20"] },
  { title: "The receipts: every figure in the docs checked against the code", command: "node tools/check_numbers.js", args: ["tools/check_numbers.js"] },
];

// Warm the module cache so the first segment does not pay for it.
spawnSync(process.execPath, ["bin/csr", "--help"], { cwd: ROOT, stdio: "ignore" });

const MIN_SECONDS = 2.2;
const MAX_SECONDS = 7;
const captured = SEGMENTS.map((segment) => {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, segment.args, { cwd: ROOT, encoding: "utf8" });
  const wallSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  let lines = `${result.stdout}${result.stderr}`.replace(/\n+$/, "").split("\n");
  let truncated = false;
  if (segment.tailLines && lines.length > segment.tailLines) {
    lines = lines.slice(0, segment.tailLines).concat([`... (${lines.length - segment.tailLines} more lines)`]);
    truncated = true;
  }
  const replaySeconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, wallSeconds * 4));
  return { ...segment, exitCode: result.status, wallSeconds: Math.round(wallSeconds * 1000) / 1000,
    replaySeconds, lines, truncated };
});

mockProcess.kill();
rmSync(pullOut, { recursive: true, force: true });

const TYPE_SECONDS = 1.2;
const PAUSE_SECONDS = 2.6;
const player = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: #0f1623; }
#term { width: 960px; height: 564px; box-sizing: border-box; padding: 18px 22px; background: #0f1623; color: #d7dde7; font: 13px/1.36 ui-monospace, Menlo, Consolas, monospace; overflow: hidden; white-space: pre; }
.title { color: #9fc1ff; font-weight: 600; }
.prompt { color: #4ad17d; }
.cmd { color: #ffffff; }
.cmdline { white-space: pre-wrap; overflow-wrap: anywhere; }
.out { color: #d7dde7; }
.exit { color: #f4b942; }
#wrap { position: relative; }
#cursor { display: inline-block; width: 9px; height: 17px; background: #d7dde7; vertical-align: -3px; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
</style></head><body><div id="term"><div id="wrap"></div></div>
<script>
const segments = ${JSON.stringify(captured.map((c) => ({
    title: c.title, command: c.command, lines: c.lines, exitCode: c.exitCode, replaySeconds: c.replaySeconds,
  })))};
const TYPE = ${TYPE_SECONDS}, PAUSE = ${PAUSE_SECONDS};
const term = document.getElementById("term");
const wrap = document.getElementById("wrap");
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
function add(cls, text) { const d = document.createElement("div"); d.className = cls; d.textContent = text; wrap.appendChild(d); term.scrollTop = term.scrollHeight; return d; }
async function play() {
  await sleep(0.8);
  for (const seg of segments) {
    wrap.innerHTML = "";
    add("title", "# " + seg.title);
    add("", "");
    const line = add("cmdline", "");
    const prompt = document.createElement("span"); prompt.className = "prompt"; prompt.textContent = "$ "; line.appendChild(prompt);
    const cmd = document.createElement("span"); cmd.className = "cmd"; line.appendChild(cmd);
    const cursor = document.createElement("span"); cursor.id = "cursor"; line.appendChild(cursor);
    for (let i = 1; i <= seg.command.length; i += 1) { cmd.textContent = seg.command.slice(0, i); await sleep(TYPE / seg.command.length); }
    await sleep(0.35);
    cursor.remove();
    const per = seg.replaySeconds / Math.max(1, seg.lines.length);
    for (const l of seg.lines) { add("out", l); await sleep(per); }
    add("exit", "[exit " + seg.exitCode + "]");
    await sleep(PAUSE);
  }
  document.body.setAttribute("data-done", "1");
}
play();
</script></body></html>`;
const playerPath = join(OUT, "demo-player.html");
writeFileSync(playerPath, player);

const total = captured.reduce((n, c) => n + TYPE_SECONDS + 0.35 + c.replaySeconds + PAUSE_SECONDS, 0.8) + 1;
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const videoDir = join(OUT, "video-tmp");
rmSync(videoDir, { recursive: true, force: true });
const context = await browser.newContext({
  viewport: { width: 960, height: 564 }, recordVideo: { dir: videoDir, size: { width: 960, height: 564 } },
});
const page = await context.newPage();
await page.goto(`file://${playerPath}`);
await page.waitForSelector("body[data-done='1']", { timeout: (total + 30) * 1000 });
await page.waitForTimeout(800);
await context.close();
await browser.close();
const webm = readdirSync(videoDir).find((f) => f.endsWith(".webm"));
const webmPath = join(OUT, "demo.webm");
renameSync(join(videoDir, webm), webmPath);
rmSync(videoDir, { recursive: true, force: true });

const mp4 = join(OUT, "demo.mp4");
const gif = join(OUT, "demo.gif");
const palette = join(OUT, "palette.png");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webmPath, "-vf", "scale=960:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", mp4]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webmPath, "-vf", "fps=6,scale=800:-1:flags=lanczos,palettegen=max_colors=32", palette]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webmPath, "-i", palette, "-lavfi",
  "fps=6,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5", gif]);
rmSync(palette);
if (!process.env.KEEP_WEBM) rmSync(webmPath);

const manifest = {
  generatedBy: "tools/record_demo.js",
  note: "A replay of captured stdout paced by measured wall time, clamped between MIN and MAX seconds per segment; the wall times are pacing data, not benchmarks.",
  pacing: { minSeconds: MIN_SECONDS, maxSeconds: MAX_SECONDS, multiplier: 4, typeSeconds: TYPE_SECONDS,
    pauseSeconds: PAUSE_SECONDS },
  gif: { fps: 6, width: 800, colours: 32, bytes: statSync(gif).size },
  mp4: { bytes: statSync(mp4).size },
  segments: captured.map((c) => ({
    title: c.title, command: c.command, exitCode: c.exitCode, wallSeconds: c.wallSeconds,
    replaySeconds: c.replaySeconds, lines: c.lines.length, truncated: c.truncated,
  })),
};
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`record_demo: ${captured.length} segments, GIF ${(manifest.gif.bytes / 1e6).toFixed(2)} MB, MP4 ${(manifest.mp4.bytes / 1e6).toFixed(2)} MB`);
