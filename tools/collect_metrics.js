/**
 * Re-measures every published figure and writes docs/metrics.json.
 *
 * Nothing here is typed by hand: the test count comes from the junit report, the
 * coverage from c8's JSON summary, everything else from the experiment JSON that
 * `make experiments` wrote. The anchor phrases beside each metric are the exact
 * wording a document must use; tools/check_numbers.js enforces them. Before
 * writing, the stems are checked against each other, so a collision fails here
 * and never as a false STALE on correct prose.
 *
 * Run through `make receipts` (which runs coverage and the experiments first).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

function fail(message) {
  console.error(`collect_metrics: ${message}`);
  process.exit(1);
}

const junitPath = join(ROOT, "docs", "test-results.xml");
if (!existsSync(junitPath)) fail("docs/test-results.xml is missing; run `make coverage` first");
const junit = readFileSync(junitPath, "utf8");
const testsTotal = (junit.match(/<testcase /g) || []).length;
if (testsTotal === 0) fail("no testcase elements in docs/test-results.xml");

const summaryPath = join(ROOT, "coverage", "coverage-summary.json");
if (!existsSync(summaryPath)) fail("coverage/coverage-summary.json is missing; run `make coverage` first");
const coverage = read("coverage/coverage-summary.json").total.lines.pct;

const exp1 = read("docs/experiments/exp01_diff_census.json");
const exp2 = read("docs/experiments/exp02_attribution.json");
const exp3 = read("docs/experiments/exp03_window_and_skew.json");
const exp4 = read("docs/experiments/exp04_timestamp_baseline.json");
const exp5 = read("docs/experiments/exp05_pull_over_http.json");

const one = (n) => (Math.round(n * 10) / 10).toString();

const metrics = {};
const anchors = {};
const add = (key, value, phrases) => {
  metrics[key] = value;
  anchors[key] = phrases;
};

add("tests_total", testsTotal, ["{} tests"]);
add("coverage_line_pct", one(coverage), ["{}% line coverage"]);
add("records_salesforce", exp1.recordsPerSide.salesforce, ["{} Salesforce records"]);
add("records_external", exp1.recordsPerSide.external, ["{} ERP records"]);
add("joined_records", exp1.joinedRecords, ["{} joined records"]);
add("compared_fields", exp1.comparedFields, ["{} compared fields", "{} field comparisons"]);
add("contract_fields", exp1.contractFields, ["{} contract fields"]);
add("undeclared_fields", exp1.undeclaredFields, ["{} fields with no declared owner", "{} with no declared owner"]);
add("raw_differences", exp1.rawDifferences, ["{} raw differences"]);
add("normalised_away", exp1.normalisedAway, ["{} normalise away"]);
add("normalised_away_pct", one(exp1.normalisedAwayPct), ["{}% of the raw count"]);
add("real_diffs", exp1.realDiffs, ["{} real diffs", "{} real differences"]);
add("orphans_total", exp1.orphans, ["{} orphan records"]);
add("change_events", exp1.writes.salesforce, ["{} field writes from change events"]);
add("audit_writes", exp1.writes.external, ["{} field writes from the audit log"]);
add("stale_external", exp2.staleExternal, ["{} blame the ERP", "{} diffs blame the ERP"]);
add("stale_salesforce", exp2.staleSalesforce, ["{} blame Salesforce", "{} diffs blame Salesforce"]);
add("stale_external_pct", one(exp2.staleExternalPct), ["{}% ERP-side share"]);
add("stale_salesforce_pct", one(exp2.staleSalesforcePct), ["{}% Salesforce-side share"]);
add("attributed_total", exp2.attributed, ["{} diffs attributed", "{} diffs with a named side"]);
add("attributed_pct", one(exp2.attributedPct), ["{}% attributed"]);
add("unattributable_total", exp2.unattributable, ["{} no referee can attribute", "{} diffs no referee can attribute"]);
add("unattributable_pct", one(exp2.unattributablePct), ["{}% of real diffs unattributable", "{}% unattributable at 72 hours"]);
add("window_closed_verdicts", exp2.windowClosed, ["{} diffs outside the window", "{} window closed"]);
add("within_skew_verdicts", exp2.withinSkew, ["{} within clock skew"]);
add("sync_transform_verdicts", exp2.syncTransformVerdicts, ["{} transform verdicts"]);
add("contract_silent_verdicts", exp2.contractSilent, ["{} contract silent"]);
add("gap_event_verdicts", exp2.gapEvent, ["{} gap event"]);
add("named_by_contract_alone", exp2.namedByContractAlone, ["{} named by the contract alone"]);
add("cause_sync_lag", exp2.syncLag, ["{} sync lag"]);
add("cause_rogue", exp2.rogueWrites, ["{} rogue writes"]);
add("cause_echo", exp2.echoes, ["{} echoes of a stale value"]);
add("cause_later_write", exp2.laterWrites, ["{} later writes"]);
add("cause_sync_transform", exp2.byCause.sync_transform, ["{} transformed on the way in"]);
add("planted_verdicts", exp2.groundTruth.planted, ["{} planted verdicts", "floor 1 in {}"]);
add("recovered_verdicts", exp2.groundTruth.truePositives, ["{} of {m:planted_verdicts} recovered"]);
add("wrong_verdicts", exp2.groundTruth.wrongVerdict, ["{} wrong verdicts"]);
add("false_positives", exp2.groundTruth.falsePositives, ["{} false positives"]);
add("false_negatives", exp2.groundTruth.falseNegatives, ["{} false negatives"]);
add("unattributable_at_24h", exp3.unattributableAt24h, ["{} unattributable at 24 hours"]);
add("unattributable_at_720h", exp3.unattributableAt720h, ["{} unattributable at 720 hours"]);
add("archive_recovers", exp3.archiveRecovers, ["an archive recovers {}", "recovers {} of them"]);
add("legacy_loses", exp3.legacyLoses, ["legacy retention loses {} more"]);
add("attributed_at_zero_skew", exp3.attributedAtZeroSkew, ["{} attributed at zero tolerance"]);
add("within_skew_at_60s", exp3.withinSkewAt60s, ["{} undecided pairs at 60 seconds"]);
add("extra_unattributable_at_60s", exp3.extraUnattributableAt60s, ["{} more pairs undecided at 60 seconds"]);
add("naive_rows", exp4.naiveRows, ["{} rows the timestamp referee reports"]);
add("naive_correct", exp4.correct, ["{} the timestamp referee gets right"]);
add("naive_wrong", exp4.wrong, ["{} the timestamp referee gets wrong"]);
add("naive_wrong_real", exp4.wrongReal, ["{} mis-attributed by timestamps", "mis-attributes {} of them"]);
add("naive_wrong_real_pct", one(exp4.wrongRealPct), ["{}% of real diffs mis-attributed", "{}% mis-attributed"]);
add("naive_wrong_echo", exp4.byWhy.echo, ["{} wrong on an echo"]);
add("naive_wrong_rogue", exp4.byWhy.rogue_write, ["{} wrong on a rogue write"]);
add("naive_wrong_normalisation", exp4.byWhy.normalisation, ["{} reported that were not differences"]);
add("naive_decided_undecidable", exp4.decidedTheUndecidable, ["{} decided that cannot be decided"]);
add("naive_wrong_side", exp4.wrongSideNamed, ["{} name the wrong side"]);
add("naive_defaulted", exp4.defaulted, ["{} defaulted to Salesforce"]);
add("naive_by_echo", exp4.decidedByAnEcho, ["{} decided by the integration's own write"]);
add("pull_requests", exp5.requests, ["{} requests in the pull"]);
add("pull_pages", exp5.pages, ["{} pages pulled"]);
add("pull_token_requests", exp5.tokenRequests, ["{} token requests"]);
add("pull_refreshes", exp5.refreshes, ["{} refreshes after 401"]);
add("pull_retries", exp5.retries, ["{} retries after 429"]);
add("pull_page_size", exp5.pageSize, ["{} records per page"]);

// Per-field rows in the README's census table, pinned by the literal field name plus neighbours.
for (const [field, row] of Object.entries(exp1.byField)) {
  const slug = field.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  add(`row_${slug}_raw`, row.raw, [`| \`${field}\` | ${row.owner} | {} | {m:row_${slug}_away} | {m:row_${slug}_real} |`]);
  add(`row_${slug}_away`, row.normalisedAway, [`| \`${field}\` | ${row.owner} | {m:row_${slug}_raw} | {} | {m:row_${slug}_real} |`]);
  add(`row_${slug}_real`, row.real, [`| \`${field}\` | ${row.owner} | {m:row_${slug}_raw} | {m:row_${slug}_away} | {} |`]);
}
// Per-window rows, pinned by the literal window.
for (const w of exp3.byWindow) {
  add(`window_${w.hours}_attributed`, w.attributed, [`| ${w.hours} h | {} | {m:window_${w.hours}_unattributable} | {m:window_${w.hours}_pct}% |`]);
  add(`window_${w.hours}_unattributable`, w.unattributable, [`| ${w.hours} h | {m:window_${w.hours}_attributed} | {} | {m:window_${w.hours}_pct}% |`]);
  add(`window_${w.hours}_pct`, one(w.unattributablePct), [`| ${w.hours} h | {m:window_${w.hours}_attributed} | {m:window_${w.hours}_unattributable} | {}% |`]);
}
for (const s of exp3.bySkew) {
  add(`skew_${s.seconds}_within`, s.withinSkew, [`| ${s.seconds} s | {} | {m:skew_${s.seconds}_later} |`]);
  add(`skew_${s.seconds}_later`, s.laterWrites, [`| ${s.seconds} s | {m:skew_${s.seconds}_within} | {} |`]);
}

// Stem collision check: no alternative may contain another metric's alternative, and no
// alternative may be a suffix of a sibling alternative (tracker notes 5 and 11).
const stem = (phrase) => phrase.replace(/\{m:[a-z0-9_]+\}/g, "0").replace("{}", "0");
const entries = Object.entries(anchors);
for (const [key, phrases] of entries) {
  for (const phrase of phrases) {
    for (const [otherKey, otherPhrases] of entries) {
      for (const other of otherPhrases) {
        if (key === otherKey && phrase === other) continue;
        // A phrase pinned by {m:key} neighbours is a table cell; its twins share a stem by design.
        if (phrase.includes("{m:") && other.includes("{m:")) continue;
        const a = stem(phrase);
        const b = stem(other);
        if (key !== otherKey && a.includes(b)) fail(`anchor collision: "${phrase}" (${key}) contains "${other}" (${otherKey})`);
        if (key === otherKey && a !== b && a.endsWith(b)) fail(`sibling collision: "${other}" is a suffix of "${phrase}" (${key})`);
      }
    }
  }
}

const checkedDocuments = [
  "README.md",
  "fixture/README.md",
  "docs/adr/ADR-001-a-contract-over-two-logs-is-the-referee.md",
  "docs/adr/ADR-002-the-integration-identities-are-part-of-the-contract.md",
  "docs/adr/ADR-003-unattributable-is-a-verdict.md",
  "docs/adr/ADR-004-standard-library-at-runtime-express-in-the-mock.md",
  "docs/adr/ADR-005-what-two-snapshots-cannot-establish.md",
];

const banner = {
  path: "docs/assets/banner.svg",
  figures: {
    real_diffs: "{} real diffs",
    stale_external: "{} blame the ERP",
    stale_salesforce: "{} blame Salesforce",
    unattributable_total: "{} no referee can attribute",
  },
};

writeFileSync(join(ROOT, "docs", "metrics.json"), `${JSON.stringify({
  metrics, anchors, checked_documents: checkedDocuments, banner,
  note: "every value here is produced by running the suite and the experiments; tools/collect_metrics.js wrote it",
}, null, 2)}\n`);
console.log(`collect_metrics: ${Object.keys(metrics).length} metrics written to docs/metrics.json (${testsTotal} tests, ${one(coverage)}% line coverage)`);
