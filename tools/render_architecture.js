/**
 * Renders the architecture diagram from the README's mermaid-source fence to a committed SVG.
 *
 * Rules learned the hard way: htmlLabels off at both levels, or the SVG carries
 * <foreignObject> and fails to load as <img>; explicit width and height from the viewBox;
 * an opaque background so dark-theme readers can see it. Playwright plus mermaid.min.js is
 * the stable path; mmdc is the fallback. The run fails if <foreignObject> is present.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadPlaywright, findMermaid } from "./browser.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "assets", "architecture.svg");

const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const fence = /```mermaid-source\n([\s\S]*?)```/.exec(readme);
if (fence === null) {
  console.error("render_architecture: no mermaid-source fence in README.md");
  process.exit(1);
}
const source = fence[1];

async function renderWithPlaywright(mermaidPath) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: mermaidPath });
  const svg = await page.evaluate(async (src) => {
    window.mermaid.initialize({
      startOnLoad: false, htmlLabels: false, theme: "neutral",
      flowchart: { htmlLabels: false, nodeSpacing: 40, rankSpacing: 60, curve: "basis" },
      themeVariables: { fontFamily: "Inter, Segoe UI, system-ui, sans-serif", fontSize: "14px" },
    });
    const { svg: out } = await window.mermaid.render("architecture", src);
    return out;
  }, source);
  await browser.close();
  return svg;
}

function renderWithMmdc() {
  const config = join(ROOT, "docs", "assets", ".mermaid-config.json");
  writeFileSync(config, JSON.stringify({ htmlLabels: false, flowchart: { htmlLabels: false }, theme: "neutral" }));
  const input = join(ROOT, "docs", "assets", ".architecture.mmd");
  writeFileSync(input, source);
  execFileSync("mmdc", ["-i", input, "-o", OUT, "-c", config, "-b", "white"], { stdio: "inherit" });
  return readFileSync(OUT, "utf8");
}

const mermaidPath = findMermaid();
let svg;
let method;
if (mermaidPath !== null) {
  svg = await renderWithPlaywright(mermaidPath);
  method = `playwright + ${mermaidPath}`;
} else {
  svg = renderWithMmdc();
  method = "mmdc";
}

if (svg.includes("<foreignObject")) {
  console.error("render_architecture: the SVG contains <foreignObject>; htmlLabels did not turn off");
  process.exit(1);
}

// Intrinsic size from the viewBox, an opaque background, and no width="100%".
const viewBox = /viewBox="([\d.\s-]+)"/.exec(svg);
if (viewBox === null) {
  console.error("render_architecture: no viewBox on the rendered SVG");
  process.exit(1);
}
const [, , w, h] = viewBox[1].trim().split(/\s+/).map(Number);
const width = Math.ceil(w);
const height = Math.ceil(h);
svg = svg.replace(/<svg([^>]*)>/, (whole, attrs) => {
  const cleaned = attrs.replace(/\s(width|height|style)="[^"]*"/g, "");
  return `<svg${cleaned} width="${width}" height="${height}">` +
    `<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>`;
});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${svg}\n`);
writeFileSync(join(ROOT, "docs", "assets", "architecture.manifest.json"), `${JSON.stringify({
  source: "README.md mermaid-source fence", method, width, height, foreignObject: false,
}, null, 2)}\n`);
console.log(`render_architecture: ${OUT} (${width}x${height}) via ${method}`);
