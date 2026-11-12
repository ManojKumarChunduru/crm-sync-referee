/**
 * The referee: for every field that differs between the two snapshots, name the
 * stale side and the write that proves it, or say why no side can be named.
 *
 * Why this file exists: this is the third implementation of the declared
 * semantics (ADR-001). The contract says who owns a field; the two change logs
 * say who wrote it and whether the writer was the integration echoing the other
 * side (ADR-002); the retention window and the clock skew tolerance say when
 * the evidence is not good enough (ADR-003). Everything that decides a verdict
 * is in this file, so an interviewer can read the rules in one place.
 */

import { normalizeValue } from "./normalize.js";
import { writesFromEvents } from "./salesforce.js";
import { writesFromAudit } from "./external.js";
import { joinRecords } from "./join.js";
import { indexWrites, writeKey, inWindow, lastOriginating, last, ORIGINATING } from "./writes.js";
import { EXIT_CLEAN, EXIT_STALE, EXIT_UNATTRIBUTABLE } from "./exit_codes.js";

export const VERDICT = Object.freeze({
  NOT_A_DIFF: "not_a_diff",
  EXTERNAL_STALE: "external_stale",
  SALESFORCE_STALE: "salesforce_stale",
  WINDOW_CLOSED: "window_closed",
  WITHIN_CLOCK_SKEW: "within_clock_skew",
  SYNC_TRANSFORM: "sync_transform",
  CONTRACT_SILENT: "contract_silent",
  GAP_EVENT: "gap_event",
});

export const CAUSE = Object.freeze({
  SYNC_LAG: "sync_lag",
  ROGUE_WRITE: "rogue_write",
  ECHO_OF_STALE_VALUE: "echo_of_stale_value",
  LATER_WRITE: "later_write",
  SYNC_TRANSFORM: "sync_transform",
  WINDOW_CLOSED: "window_closed",
});

/** Verdicts that name no side. */
export const UNATTRIBUTABLE = Object.freeze([
  VERDICT.WINDOW_CLOSED, VERDICT.WITHIN_CLOCK_SKEW, VERDICT.SYNC_TRANSFORM, VERDICT.CONTRACT_SILENT, VERDICT.GAP_EVENT,
]);

export const HOUR_MS = 3_600_000;

const OTHER = { salesforce: "external", external: "salesforce" };
const SIDE_LABEL = { salesforce: "Salesforce", external: "the external system" };

function fmt(value) {
  return value === null ? "null" : JSON.stringify(value);
}

function at(w) {
  return new Date(w.at).toISOString();
}

function describe(w) {
  return `${w.origin === ORIGINATING ? "an originating write" : "an echo"} by ${w.actor} at ${at(w)} (${w.evidence}) = ${fmt(w.value)}`;
}

/**
 * Why the stale side holds the value it holds. `staleW` and `authW` are that
 * field's writes in the window on each side; `authO` is the authoritative
 * side's latest originating write, or null.
 */
export function causeFor({ staleW, authW, authO, shared, steps }) {
  const staleLast = last(staleW);
  if (staleLast !== null && staleLast.origin === ORIGINATING) {
    return { cause: shared ? CAUSE.LATER_WRITE : CAUSE.ROGUE_WRITE, decisive: staleLast };
  }
  if (staleLast === null) {
    return authO === null ? { cause: CAUSE.WINDOW_CLOSED, decisive: null } : { cause: CAUSE.SYNC_LAG, decisive: authO };
  }
  if (authO !== null && authO.at > staleLast.at) return { cause: CAUSE.SYNC_LAG, decisive: authO };
  if (authW.length === 0) return { cause: CAUSE.WINDOW_CLOSED, decisive: staleLast };
  const echoValue = normalizeValue(staleLast.value, steps);
  const earlier = authW.find((w) => w.at <= staleLast.at && normalizeValue(w.value, steps) === echoValue);
  if (earlier !== undefined) return { cause: CAUSE.ECHO_OF_STALE_VALUE, decisive: staleLast, matched: earlier };
  return { cause: CAUSE.SYNC_TRANSFORM, decisive: staleLast };
}

function staleVerdict(side) {
  return side === "salesforce" ? VERDICT.SALESFORCE_STALE : VERDICT.EXTERNAL_STALE;
}

function reasonFor(row, c) {
  const stale = SIDE_LABEL[row.staleSide];
  const auth = SIDE_LABEL[OTHER[row.staleSide]];
  const ownerText = row.owner === "shared" ? "the field is shared, last originating write wins" : `${SIDE_LABEL[row.owner]} owns the field`;
  switch (c.cause) {
    case CAUSE.ROGUE_WRITE:
      return `${ownerText}; the latest write on ${stale} is ${describe(c.decisive)}, a write the contract does not allow there.`;
    case CAUSE.LATER_WRITE:
      return `${ownerText}; ${auth} wrote later: ${describe(row.decidedBy[OTHER[row.staleSide]])}, against ${describe(c.decisive)} on ${stale}.`;
    case CAUSE.SYNC_LAG:
      return `${ownerText}; ${auth} has ${describe(c.decisive)} and nothing applied it to ${stale} afterwards.`;
    case CAUSE.ECHO_OF_STALE_VALUE:
      return `${ownerText}; the latest write on ${stale} is ${describe(c.decisive)}, which is the value ${auth} held at ${at(c.matched)} (${c.matched.evidence}) and no longer holds.`;
    case CAUSE.SYNC_TRANSFORM:
      return `${ownerText}; the latest write on ${stale} is ${describe(c.decisive)}, a value ${auth} never held in the window: the integration changed it on the way.`;
    default:
      return `${ownerText}; neither side has a write to this field inside the window, so the cause is unknown; the stale side is named by the contract alone.`;
  }
}

/**
 * Decide one field of one joined record. Returns null when the raw values are
 * equal (nothing to report), else a verdict row.
 */
export function decideField(input) {
  const { object, key, spec, sfValue, extValue, sfWrites, extWrites, windowFrom, asOf, skewMs, gapRecord } = input;
  const steps = spec.normalize;
  if (sfValue === extValue) return null;
  const sfNorm = normalizeValue(sfValue, steps);
  const extNorm = normalizeValue(extValue, steps);
  const sfW = inWindow(sfWrites, windowFrom, asOf);
  const extW = inWindow(extWrites, windowFrom, asOf);
  const row = {
    object, key, field: spec.name, owner: spec.owner,
    salesforceValue: sfValue, externalValue: extValue,
    normalised: { salesforce: sfNorm, external: extNorm },
    verdict: null, cause: null, staleSide: null, authoritativeValue: null,
    decidedBy: { salesforce: null, external: null },
    evidence: { salesforce: sfW, external: extW },
    reason: "",
  };
  if (sfNorm === extNorm) {
    row.verdict = VERDICT.NOT_A_DIFF;
    row.reason = `${fmt(sfValue)} and ${fmt(extValue)} are the same value once ${steps.map((s) => s.name).join(", ") || "compared"} is applied.`;
    return row;
  }
  if (gapRecord) {
    row.verdict = VERDICT.GAP_EVENT;
    row.reason = `Salesforce delivered a gap event for this record (${gapRecord.changeType}, replayId ${gapRecord.replayId}); its write history has a hole, so no side can be named.`;
    return row;
  }
  if (spec.owner === "undeclared") {
    row.verdict = VERDICT.CONTRACT_SILENT;
    row.reason = "The contract maps this field but declares no owner, so the referee has no rule to apply.";
    return row;
  }
  const sfO = lastOriginating(sfW);
  const extO = lastOriginating(extW);
  row.decidedBy = { salesforce: sfO, external: extO };
  if (spec.owner === "shared") {
    if (sfO !== null && extO !== null) {
      const gap = Math.abs(sfO.at - extO.at);
      if (gap <= skewMs) {
        row.verdict = VERDICT.WITHIN_CLOCK_SKEW;
        row.reason = `The field is shared and the two latest originating writes are ${gap} ms apart (${sfO.evidence} at ${at(sfO)}, ${extO.evidence} at ${at(extO)}), inside the ${skewMs} ms tolerance, so two clocks cannot order them.`;
        return row;
      }
      row.staleSide = sfO.at > extO.at ? "external" : "salesforce";
    } else if (sfO !== null) {
      row.staleSide = "external";
    } else if (extO !== null) {
      row.staleSide = "salesforce";
    } else {
      const sfL = last(sfW);
      const extL = last(extW);
      if (sfL !== null && extL !== null) {
        row.verdict = VERDICT.SYNC_TRANSFORM;
        row.reason = `The field is shared and the only writes in the window on both sides are the integration's own (${sfL.evidence} = ${fmt(sfL.value)}, ${extL.evidence} = ${fmt(extL.value)}), so the bridge produced two values and neither side is stale.`;
        return row;
      }
      row.verdict = VERDICT.WINDOW_CLOSED;
      row.reason = `The field is shared and neither side has an originating write inside the window (from ${new Date(windowFrom).toISOString()}), so the later write cannot be identified.`;
      return row;
    }
  } else {
    row.staleSide = OTHER[spec.owner];
  }
  const authSide = OTHER[row.staleSide];
  const c = causeFor({
    staleW: row.staleSide === "salesforce" ? sfW : extW,
    authW: authSide === "salesforce" ? sfW : extW,
    authO: authSide === "salesforce" ? sfO : extO,
    shared: spec.owner === "shared",
    steps,
  });
  row.verdict = staleVerdict(row.staleSide);
  row.cause = c.cause;
  row.authoritativeValue = authSide === "salesforce" ? sfValue : extValue;
  row.reason = reasonFor(row, c);
  return row;
}

export function parseDuration(text, unit) {
  const m = /^(\d+(?:\.\d+)?)\s*([smhd])?$/.exec(String(text).trim());
  if (m === null) return null;
  const n = Number(m[1]);
  const u = m[2] ?? unit;
  const seconds = { s: 1, m: 60, h: 3600, d: 86400 }[u] * n;
  return unit === "h" ? seconds / 3600 : seconds;
}

/** The whole run. Pure given its inputs; the clock is never read. */
export function referee({ contract, salesforce, external, windowHours, skewSeconds, asOf, object: objectFilter } = {}) {
  const hours = windowHours ?? contract.retentionHours;
  const skew = skewSeconds ?? contract.skewSeconds;
  const asOfMs = asOf ?? salesforce.asOf;
  const windowFrom = asOfMs - hours * HOUR_MS;
  const skewMs = Math.round(skew * 1000);
  const sfWrites = writesFromEvents(salesforce, contract);
  const extWrites = writesFromAudit(external, contract);
  const index = indexWrites([...sfWrites.writes, ...extWrites.writes]);
  const gapByRecord = new Map();
  for (const g of sfWrites.gaps) {
    if (g.at < windowFrom || g.at > asOfMs) continue;
    for (const id of g.recordIds) if (!gapByRecord.has(id)) gapByRecord.set(id, g);
  }
  const { pairs, orphans } = joinRecords(salesforce, external, contract);
  const rows = [];
  let comparedFields = 0;
  let comparedRecords = 0;
  for (const pair of pairs) {
    if (objectFilter !== undefined && pair.object !== objectFilter) continue;
    comparedRecords += 1;
    const object = contract.objects[pair.object];
    for (const spec of Object.values(object.fields)) {
      comparedFields += 1;
      const entry = index.get(writeKey(pair.object, pair.key, spec.name)) ?? { salesforce: [], external: [] };
      const sfValue = pair.salesforce[spec.name] === undefined ? null : pair.salesforce[spec.name];
      const extValue = pair.external[spec.externalField] === undefined ? null : pair.external[spec.externalField];
      const row = decideField({
        object: pair.object, key: pair.key, spec, sfValue, extValue,
        sfWrites: entry.salesforce, extWrites: entry.external, windowFrom, asOf: asOfMs, skewMs,
        gapRecord: gapByRecord.get(pair.key) ?? null,
      });
      if (row !== null) rows.push(row);
    }
  }
  const filteredOrphans = objectFilter === undefined ? orphans : orphans.filter((o) => o.object === objectFilter);
  return {
    contract: { name: contract.name, external: contract.systems.external.name },
    asOf: asOfMs,
    asOfText: new Date(asOfMs).toISOString(),
    externalAsOfText: external.asOfText,
    windowHours: hours,
    windowFrom: new Date(windowFrom).toISOString(),
    skewSeconds: skew,
    compared: { records: comparedRecords, fields: comparedFields, rawDifferences: rows.length },
    rows,
    orphans: filteredOrphans,
    gaps: sfWrites.gaps,
    skippedAudit: extWrites.skipped,
    writes: { salesforce: sfWrites.writes.length, external: extWrites.writes.length },
    counts: countRows(rows, filteredOrphans),
  };
}

/** Summary counts shared by every rendering and every experiment. */
export function countRows(rows, orphans = []) {
  const byVerdict = {};
  for (const v of Object.values(VERDICT)) byVerdict[v] = 0;
  const byCause = {};
  for (const c of Object.values(CAUSE)) byCause[c] = 0;
  let staleSalesforce = 0;
  let staleExternal = 0;
  for (const r of rows) {
    byVerdict[r.verdict] += 1;
    if (r.cause !== null) byCause[r.cause] += 1;
    if (r.staleSide === "salesforce") staleSalesforce += 1;
    if (r.staleSide === "external") staleExternal += 1;
  }
  const real = rows.length - byVerdict[VERDICT.NOT_A_DIFF];
  const unattributable = UNATTRIBUTABLE.reduce((n, v) => n + byVerdict[v], 0);
  return {
    rawDifferences: rows.length,
    notADiff: byVerdict[VERDICT.NOT_A_DIFF],
    realDiffs: real,
    staleSalesforce,
    staleExternal,
    attributed: staleSalesforce + staleExternal,
    unattributable,
    byVerdict,
    byCause,
    orphans: orphans.length,
  };
}

export function exitCodeFor(result) {
  const c = result.counts;
  if (c.unattributable > 0) return EXIT_UNATTRIBUTABLE;
  if (c.attributed > 0 || c.orphans > 0) return EXIT_STALE;
  return EXIT_CLEAN;
}
