/**
 * Experiment 4: the timestamp referee.
 * The naive referee (latest write on either side wins, no contract, no echo suppression, no
 * normalisation, no window, Salesforce by default) on the same fixture, against the planted
 * truth: the rows it gets wrong, grouped by why.
 */
import { loadAll, writeJson, printTable, pct, expected, rowKey } from "./lib.js";
import { naiveReferee } from "../src/csr/naive.js";

const inputs = loadAll();
const naive = naiveReferee(inputs);
const truth = new Map(expected().rows.map((r) => [rowKey(r), r]));

const classes = {
  normalisation: 0, echo: 0, rogue_write: 0, within_skew: 0, window_closed: 0,
  sync_transform: 0, contract_silent: 0, gap_event: 0, other: 0,
};
let correct = 0;
const wrong = [];
for (const row of naive) {
  const t = truth.get(rowKey(row));
  if (t === undefined) throw new Error(`naive reported an unplanted row ${rowKey(row)}`);
  let why;
  if (t.verdict === "not_a_diff") why = "normalisation";
  else if (t.staleSide !== null) {
    if (t.staleSide === row.staleSide) { correct += 1; continue; }
    if (row.decidedBy !== null && row.decidedBy.origin === "echo") why = "echo";
    else if (t.cause === "rogue_write") why = "rogue_write";
    else why = "other";
  } else if (t.verdict === "within_clock_skew") why = "within_skew";
  else why = t.verdict;
  classes[why] += 1;
  wrong.push({ key: row.key, field: `${row.object}.${row.field}`, naive: row.staleSide, truth: t.verdict, cause: t.cause, why });
}
const real = naive.length - classes.normalisation;
const data = {
  naiveRows: naive.length,
  correct,
  correctPct: pct(correct, real),
  wrong: wrong.length,
  wrongReal: wrong.length - classes.normalisation,
  wrongRealPct: pct(wrong.length - classes.normalisation, real),
  byWhy: classes,
  defaulted: naive.filter((r) => r.defaulted).length,
  decidedByAnEcho: naive.filter((r) => r.decidedBy !== null && r.decidedBy.origin === "echo").length,
  wrongSideNamed: classes.echo + classes.rogue_write + classes.other,
  decidedTheUndecidable: classes.within_skew + classes.window_closed + classes.sync_transform
    + classes.contract_silent + classes.gap_event,
  rows: wrong,
};
writeJson("exp04_timestamp_baseline.json", data);
console.log(`exp04 timestamp baseline: ${data.naiveRows} rows reported, ${data.correct} right, ${data.wrong} wrong: ${classes.normalisation} were not differences, ${data.wrongSideNamed} named the wrong side (${classes.echo} on an echo, ${classes.rogue_write} on a rogue write, ${classes.other} other), ${data.decidedTheUndecidable} decided what cannot be decided`);
console.log(`of the ${real} real diffs the timestamp referee mis-attributes ${data.wrongReal} (${data.wrongRealPct}%); ${data.defaulted} defaulted to Salesforce, ${data.decidedByAnEcho} decided by the integration's own write`);
printTable(["Why wrong", "Rows"], Object.entries(classes).map(([k, n]) => [k, n]));
