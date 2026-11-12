/**
 * Fails the build when a document quotes a figure the code no longer produces.
 *
 * Reads docs/metrics.json (written by tools/collect_metrics.js) and every checked
 * document. For each metric, at least one anchor phrase with the current value
 * must appear somewhere (else GAP), and no anchor phrase may appear with a
 * different value (STALE, with file and line). A phrase may name other metrics
 * as {m:key}, which pins a table cell by its neighbours; the stale check turns
 * only the {} into a number pattern. The banner's text nodes are checked with
 * their own patterns. Finally the reverse scan reports every number in prose
 * that matches no metric value (UNANCHORED), excluding fenced code, inline
 * code, URLs, numbers glued to a hyphen or a word, and an allowlist that
 * carries a reason per entry.
 *
 * Exit 0 when clean, 1 otherwise. `make verify` runs it.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const payload = JSON.parse(readFileSync(join(ROOT, "docs", "metrics.json"), "utf8"));
const { metrics, anchors, checked_documents: documents, banner } = payload;

/** Numbers that appear in prose and are not measurements. One reason each. */
const ALLOWED_UNANCHORED = new Map([
  ["24", "the legacy standard-volume retention in hours, a documented constant"],
  ["72", "the high-volume and change-event retention in hours, a documented constant"],
  ["720", "the archive window the sweep models, 30 days in hours"],
  ["30", "days of archive, and the README's 30-second scan heading"],
  ["60", "the loosest tolerance in the skew sweep, in seconds, and the ERP title length"],
  ["40", "the bridge's truncation length in characters"],
  ["50", "the subscriber trigger's batch size and the upper bound of a planted gap in seconds"],
  ["2.0", "OAuth 2.0"],
  ["200", "HTTP status"],
  ["401", "HTTP status"],
  ["429", "HTTP status"],
  ["1", "a count of one in prose (one side, one write, a floor of 1 in N)"],
  ["2", "a count of two in prose (two values, two clocks, exit 2)"],
  ["3", "three days of retention, exit 3"],
  ["5", "the contract's 5-second tolerance, a declared policy"],
  ["0", "zero in prose (0 runtime dependencies, exit 0)"],
  ["2026", "the year in the licence, the dates and the snapshot instant"],
  ["11", "the month of the snapshot instant"],
  ["10", "the day of the snapshot instant"],
  ["62.0", "the fixture's API version"],
  ["001", "ADR number in a link title"],
  ["002", "ADR number in a link title"],
  ["003", "ADR number in a link title"],
  ["004", "ADR number in a link title"],
  ["005", "ADR number in a link title"],
  ["7", "ADR-005 item numbers quoted in prose"],
  ["8089", "the mock's example port"],
]);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUMBER = "(\\d+(?:,\\d{3})*(?:\\.\\d+)?)";

function formatted(value) {
  return String(value);
}

function sameNumber(a, b) {
  return Number(String(a).replace(/,/g, "")) === Number(String(b).replace(/,/g, ""));
}

/**
 * Compile a phrase into a regular expression. Literal text is escaped; {m:key} becomes that
 * metric's current value; {} becomes `slot` (the exact value, or the NUMBER pattern).
 */
function compile(phrase, slot) {
  let source = "";
  const parts = phrase.split(/(\{m:[a-z0-9_]+\}|\{\})/);
  for (const part of parts) {
    if (part === "{}") source += slot;
    else if (part.startsWith("{m:")) {
      const key = part.slice(3, -1);
      if (!(key in metrics)) throw new Error(`anchor names unknown metric ${key}`);
      source += escape(formatted(metrics[key]));
    } else source += escape(part);
  }
  return source;
}

function loadDocument(relativePath) {
  const path = join(ROOT, relativePath);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return { path: relativePath, text, lines: text.split("\n") };
}

const problems = [];
const loaded = documents.map(loadDocument);
loaded.forEach((doc, index) => {
  if (doc === null) problems.push(`MISSING ${documents[index]}`);
});
const docs = loaded.filter((d) => d !== null);

let anchoredPhrases = 0;
for (const [key, phrases] of Object.entries(anchors)) {
  const value = formatted(metrics[key]);
  let found = false;
  for (const phrase of phrases) {
    const exactRe = new RegExp(compile(phrase, escape(value)));
    const staleRe = new RegExp(compile(phrase, NUMBER), "g");
    for (const doc of docs) {
      if (exactRe.test(doc.text)) found = true;
      doc.lines.forEach((line, i) => {
        for (const match of line.matchAll(staleRe)) {
          if (!sameNumber(match[1], value)) {
            problems.push(`STALE ${doc.path}:${i + 1}: "${match[0]}" but ${key} is ${value}`);
          }
        }
      });
    }
  }
  if (found) anchoredPhrases += 1;
  else problems.push(`GAP ${key} = ${value}: none of ${phrases.map((p) => `"${p}"`).join(", ")} found in any checked document`);
}

// The banner: strip tags, then check each figure with its own pattern.
if (banner) {
  const svg = loadDocument(banner.path);
  if (svg === null) {
    problems.push(`MISSING ${banner.path}`);
  } else {
    const textOnly = svg.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const [key, pattern] of Object.entries(banner.figures)) {
      const value = formatted(metrics[key]);
      const exact = new RegExp(compile(pattern, escape(value)));
      const stale = new RegExp(compile(pattern, NUMBER), "g");
      if (!exact.test(textOnly)) problems.push(`GAP banner: "${pattern.replace("{}", value)}" not in ${banner.path}`);
      for (const match of textOnly.matchAll(stale)) {
        if (!sameNumber(match[1], value)) problems.push(`STALE banner: "${match[0]}" but ${key} is ${value}`);
      }
    }
  }
}

// Reverse scan: numbers in prose that match no metric.
const metricValues = new Set(Object.values(metrics).map((v) => String(v).replace(/,/g, "")));
const unanchored = [];
for (const doc of docs) {
  // Replace fenced blocks with the same number of newlines so line numbers survive.
  let prose = doc.text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ""));
  prose = prose.replace(/`[^`\n]*`/g, (span) => " ".repeat(span.length));
  prose = prose.replace(/https?:\/\/\S+/g, (url) => " ".repeat(url.length));
  prose = prose.replace(/<[^>\n]+>/g, (tag) => " ".repeat(tag.length));
  prose.split("\n").forEach((line, i) => {
    for (const match of line.matchAll(/(?<![\w.-])(\d+(?:,\d{3})*(?:\.\d+)?)(?![\w-])/g)) {
      const raw = match[1];
      const clean = raw.replace(/,/g, "");
      if (metricValues.has(clean)) continue;
      if (ALLOWED_UNANCHORED.has(raw) || ALLOWED_UNANCHORED.has(clean)) continue;
      unanchored.push(`UNANCHORED ${doc.path}:${i + 1}: ${raw} in "${line.trim().slice(0, 90)}"`);
    }
  });
}
problems.push(...unanchored);

const counts = {
  gap: problems.filter((p) => p.startsWith("GAP")).length,
  stale: problems.filter((p) => p.startsWith("STALE")).length,
  missing: problems.filter((p) => p.startsWith("MISSING")).length,
  unanchored: unanchored.length,
};
for (const problem of problems) console.log(problem);
console.log(`check_numbers: ${Object.keys(metrics).length} metrics, ${anchoredPhrases} anchored, ${docs.length} documents` +
  `${banner ? " plus the banner" : ""}; ${counts.gap} gaps, ${counts.stale} stale, ${counts.missing} missing, ${counts.unanchored} unanchored`);
process.exit(problems.length === 0 ? 0 : 1);
