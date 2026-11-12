/**
 * Experiment 2: attribution, the headline.
 * The share of real differences that blame each side, the cause behind each, the unattributable
 * share split by reason, and recall against the planted truth with the resolution floor stated.
 */
import { fixtureRun, writeJson, printTable, pct, expected, rowKey } from "./lib.js";
import { UNATTRIBUTABLE } from "../src/csr/referee.js";

const { result } = fixtureRun();
const truth = expected();
const real = result.rows.filter((r) => r.verdict !== "not_a_diff");
const c = result.counts;

const plantedMap = new Map(truth.rows.map((r) => [rowKey(r), r]));
const reported = new Map(result.rows.map((r) => [rowKey(r), r]));
let truePositives = 0;
let wrongVerdict = 0;
for (const [k, r] of reported) {
  const p = plantedMap.get(k);
  if (p === undefined) continue;
  if (p.verdict === r.verdict && p.cause === r.cause && p.staleSide === r.staleSide) truePositives += 1;
  else wrongVerdict += 1;
}
const falsePositives = [...reported.keys()].filter((k) => !plantedMap.has(k)).length;
const falseNegatives = [...plantedMap.keys()].filter((k) => !reported.has(k)).length;

const contractOnly = real.filter((r) => r.cause === "window_closed").length;
const data = {
  realDiffs: real.length,
  staleExternal: c.staleExternal,
  staleSalesforce: c.staleSalesforce,
  staleExternalPct: pct(c.staleExternal, real.length),
  staleSalesforcePct: pct(c.staleSalesforce, real.length),
  attributed: c.attributed,
  attributedPct: pct(c.attributed, real.length),
  unattributable: c.unattributable,
  unattributablePct: pct(c.unattributable, real.length),
  byVerdict: c.byVerdict,
  byCause: c.byCause,
  windowClosed: c.byVerdict.window_closed,
  windowClosedPct: pct(c.byVerdict.window_closed, real.length),
  withinSkew: c.byVerdict.within_clock_skew,
  syncTransformVerdicts: c.byVerdict.sync_transform,
  contractSilent: c.byVerdict.contract_silent,
  gapEvent: c.byVerdict.gap_event,
  namedByContractAlone: contractOnly,
  echoes: c.byCause.echo_of_stale_value,
  rogueWrites: c.byCause.rogue_write,
  syncLag: c.byCause.sync_lag,
  laterWrites: c.byCause.later_write,
  groundTruth: {
    planted: truth.rows.length, reported: reported.size, truePositives, wrongVerdict, falsePositives, falseNegatives,
    recall: pct(truePositives, truth.rows.length), resolutionFloor: `1 in ${truth.rows.length}`,
    note: "A fixture written by the referee's author checks the rule arithmetic, not discovery; zero false positives, zero false negatives and zero wrong verdicts are each a rate below 1 in the planted count.",
  },
  rows: real.map((r) => ({ key: r.key, field: `${r.object}.${r.field}`, owner: r.owner, verdict: r.verdict, cause: r.cause, staleSide: r.staleSide })),
};
writeJson("exp02_attribution.json", data);
console.log(`exp02 attribution: ${data.realDiffs} real diffs; ${data.staleExternal} blame the external system (${data.staleExternalPct}%), ${data.staleSalesforce} blame Salesforce (${data.staleSalesforcePct}%), ${data.unattributable} no referee can attribute (${data.unattributablePct}%)`);
console.log(`unattributable: ${data.windowClosed} window closed, ${data.withinSkew} within clock skew, ${data.syncTransformVerdicts} sync transform, ${data.contractSilent} contract silent, ${data.gapEvent} gap event; ${data.namedByContractAlone} named by the contract alone`);
console.log(`ground truth: ${truePositives} of ${truth.rows.length} planted verdicts recovered, ${wrongVerdict} wrong, ${falsePositives} false positives, ${falseNegatives} false negatives (floor 1 in ${truth.rows.length})`);
printTable(["Verdict", "Rows"], Object.entries(c.byVerdict).filter(([v]) => v !== "not_a_diff").map(([v, n]) => [v + (UNATTRIBUTABLE.includes(v) ? " (unattributable)" : ""), n]));
printTable(["Cause", "Rows"], Object.entries(c.byCause).map(([k, n]) => [k, n]));
