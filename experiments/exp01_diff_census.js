/**
 * Experiment 1: the diff census.
 * What a plain diff reports against what is real: raw differences, the ones that normalise away,
 * the real differences by object, field and owner, and the orphans.
 */
import { fixtureRun, writeJson, printTable, pct } from "./lib.js";

const { result, contract } = fixtureRun();
const real = result.rows.filter((r) => r.verdict !== "not_a_diff");
const notDiff = result.rows.filter((r) => r.verdict === "not_a_diff");

const byField = {};
for (const object of Object.values(contract.objects)) {
  for (const field of Object.values(object.fields)) {
    const k = `${object.name}.${field.name}`;
    byField[k] = { owner: field.owner, raw: 0, normalisedAway: 0, real: 0 };
  }
}
for (const r of result.rows) {
  const row = byField[`${r.object}.${r.field}`];
  row.raw += 1;
  if (r.verdict === "not_a_diff") row.normalisedAway += 1;
  else row.real += 1;
}
const byOwner = {};
for (const r of real) byOwner[r.owner] = (byOwner[r.owner] || 0) + 1;
const byObject = {};
for (const r of real) byObject[r.object] = (byObject[r.object] || 0) + 1;
const normalisedByReason = {};
for (const r of notDiff) {
  const steps = contract.objects[r.object].fields[r.field].normalize.map((s) => s.name).join("+");
  normalisedByReason[steps] = (normalisedByReason[steps] || 0) + 1;
}

const data = {
  recordsPerSide: { salesforce: result.compared.records + result.orphans.filter((o) => o.side === "salesforce").length,
    external: result.compared.records + result.orphans.filter((o) => o.side === "external").length },
  joinedRecords: result.compared.records,
  comparedFields: result.compared.fields,
  contractFields: Object.keys(byField).length,
  undeclaredFields: Object.values(contract.objects).reduce((n, o) => n + Object.values(o.fields).filter((f) => f.owner === "undeclared").length, 0),
  rawDifferences: result.rows.length,
  normalisedAway: notDiff.length,
  normalisedAwayPct: pct(notDiff.length, result.rows.length),
  realDiffs: real.length,
  realDiffsPctOfCompared: pct(real.length, result.compared.fields),
  byOwner, byObject, normalisedByReason, byField,
  orphans: result.orphans.length,
  orphansBySide: { salesforce: result.orphans.filter((o) => o.side === "salesforce").length, external: result.orphans.filter((o) => o.side === "external").length },
  writes: result.writes,
  skippedAudit: result.skippedAudit,
};
writeJson("exp01_diff_census.json", data);
console.log(`exp01 diff census: ${data.rawDifferences} raw differences over ${data.comparedFields} compared fields on ${data.joinedRecords} joined records; ${data.normalisedAway} normalise away (${data.normalisedAwayPct}%); ${data.realDiffs} real diffs; ${data.orphans} orphan records`);
printTable(["Field", "Owner", "Raw", "Normalise away", "Real"], Object.entries(byField).map(([k, v]) => [k, v.owner, v.raw, v.normalisedAway, v.real]));
