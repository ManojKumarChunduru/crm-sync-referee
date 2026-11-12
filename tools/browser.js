/**
 * Finds Playwright for Node and the mermaid library wherever they are installed, so the
 * evidence tools run without declaring either as a dependency of the package.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);

function candidateRoots() {
  const roots = [join(process.cwd(), "node_modules")];
  if (process.env.NODE_PATH) roots.push(...process.env.NODE_PATH.split(":"));
  try {
    roots.push(execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    // npm is not on the path; the fixed locations below may still hold the libraries.
  }
  roots.push("/opt/npm-tools/node_modules", "/usr/lib/node_modules", "/usr/local/lib/node_modules");
  return roots.filter(existsSync);
}

/** The playwright module, or an error naming where it was looked for. */
export function loadPlaywright() {
  const roots = candidateRoots();
  for (const root of roots) {
    const path = join(root, "playwright");
    if (existsSync(path)) return require(path);
  }
  throw new Error(`playwright for Node was not found under ${roots.join(", ")}; install it with npm install -g playwright and run npx playwright install chromium`);
}

/** Path to mermaid.min.js, or null. */
export function findMermaid() {
  for (const root of candidateRoots()) {
    const path = join(root, "mermaid", "dist", "mermaid.min.js");
    if (existsSync(path)) return path;
  }
  return null;
}
