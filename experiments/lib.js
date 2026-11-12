/**
 * Shared plumbing for the experiments: load the fixture, run the referee, write JSON, print a table.
 * Every experiment is deterministic and offline (experiment 5 opens a loopback socket to the mock);
 * the JSON each writes is what the receipts re-measure.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/csr/contract.js";
import { loadSalesforce } from "../src/csr/salesforce.js";
import { loadExternal } from "../src/csr/external.js";
import { referee } from "../src/csr/referee.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE = join(ROOT, "fixture");
export const OUT = join(ROOT, "docs", "experiments");
export const CONTRACT_PATH = join(ROOT, "contract", "sync-contract.json");

export function loadAll() {
  const contract = loadContract(CONTRACT_PATH);
  return { contract, salesforce: loadSalesforce(join(FIXTURE, "salesforce"), contract), external: loadExternal(join(FIXTURE, "external"), contract) };
}

export function fixtureRun(options = {}) {
  const inputs = loadAll();
  return { ...inputs, result: referee({ ...inputs, ...options }) };
}

export function expected() {
  return JSON.parse(readFileSync(join(FIXTURE, "EXPECTED_VERDICTS.json"), "utf8"));
}

export function writeJson(name, data) {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, name);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

export function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd();
  console.log(line(headers));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const row of rows) console.log(line(row));
}

export function pct(part, whole) {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

export const rowKey = (r) => `${r.object}|${r.key}|${r.field}`;
