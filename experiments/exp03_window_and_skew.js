/**
 * Experiment 3: the window and the tolerance.
 * The unattributable share at 24 hours (legacy standard-volume retention), 72 hours (high-volume
 * platform events and change events) and 720 hours (an archiving subscriber), and the within-skew
 * count at 0, 5 and 60 seconds. What archiving buys, and what loosening the tolerance costs.
 */
import { fixtureRun, writeJson, printTable, pct } from "./lib.js";

const windows = [24, 72, 720];
const skews = [0, 5, 60];
const byWindow = windows.map((hours) => {
  const { result } = fixtureRun({ windowHours: hours });
  const c = result.counts;
  return {
    hours, realDiffs: c.realDiffs, attributed: c.attributed, unattributable: c.unattributable,
    unattributablePct: pct(c.unattributable, c.realDiffs), windowClosed: c.byVerdict.window_closed,
    withinSkew: c.byVerdict.within_clock_skew, gapEvent: c.byVerdict.gap_event, contractOnly: c.byCause.window_closed,
  };
});
const bySkew = skews.map((seconds) => {
  const { result } = fixtureRun({ skewSeconds: seconds });
  const c = result.counts;
  return { seconds, attributed: c.attributed, unattributable: c.unattributable, withinSkew: c.byVerdict.within_clock_skew, laterWrites: c.byCause.later_write };
});
const at = (h) => byWindow.find((w) => w.hours === h);
const data = {
  byWindow, bySkew,
  unattributableAt24h: at(24).unattributable,
  unattributableAt72h: at(72).unattributable,
  unattributableAt720h: at(720).unattributable,
  archiveRecovers: at(72).unattributable - at(720).unattributable,
  legacyLoses: at(24).unattributable - at(72).unattributable,
  attributedAtZeroSkew: bySkew[0].attributed,
  withinSkewAt60s: bySkew[2].withinSkew,
  extraUnattributableAt60s: bySkew[2].unattributable - bySkew[1].unattributable,
  note: "Windows are monotone by construction (a longer window reads a superset of the events). The skew sweep compares tolerances none of which contains another in verdict space: a looser tolerance turns decided pairs into undecided ones and nothing else.",
};
writeJson("exp03_window_and_skew.json", data);
console.log(`exp03 window: unattributable ${data.unattributableAt24h} at 24 h, ${data.unattributableAt72h} at 72 h, ${data.unattributableAt720h} at 720 h; an archive recovers ${data.archiveRecovers}, legacy retention loses ${data.legacyLoses} more`);
console.log(`exp03 skew: ${data.attributedAtZeroSkew} attributed at 0 s; ${data.withinSkewAt60s} within clock skew at 60 s (${data.extraUnattributableAt60s} more than at 5 s)`);
printTable(["Window (h)", "Real", "Attributed", "Unattributable", "Share %", "Window closed", "Within skew", "Contract alone"],
  byWindow.map((w) => [w.hours, w.realDiffs, w.attributed, w.unattributable, w.unattributablePct, w.windowClosed, w.withinSkew, w.contractOnly]));
printTable(["Skew (s)", "Attributed", "Unattributable", "Within skew", "Later writes"], bySkew.map((s) => [s.seconds, s.attributed, s.unattributable, s.withinSkew, s.laterWrites]));
