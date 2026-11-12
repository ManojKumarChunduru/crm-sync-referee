/**
 * One Write shape for both sides, and the index the referee reads them from.
 *
 * Why this file exists: a change event and an audit entry describe the same
 * thing in two vocabularies. The referee only ever asks "who wrote this field
 * of this record, when, with what value, and was it the integration", so both
 * readers reduce to this shape and the referee never sees a payload or a
 * header again. The origin is decided here and nowhere else (ADR-002).
 */

export const ORIGINATING = "originating";
export const ECHO = "echo";

/**
 * @param {object} w
 * @param {"salesforce"|"external"} w.side
 * @param {string} w.object the Salesforce object name the contract uses
 * @param {string} w.key the Salesforce record Id, the join key on both sides
 * @param {string} w.field the contract field name (Salesforce API name)
 * @param {*} w.value the value written (null is a write of null)
 * @param {number} w.at milliseconds since the epoch, that side's clock
 * @param {string} w.actor the user or actor id
 * @param {"originating"|"echo"} w.origin
 * @param {string} w.evidence the id a reviewer can look up: "replayId 1234" or "audit aud-000012"
 * @param {string} [w.client] the changeOrigin client on the Salesforce side
 */
export function makeWrite(w) {
  for (const k of ["side", "object", "key", "field", "at", "actor", "origin", "evidence"]) {
    if (w[k] === undefined) throw new TypeError(`write is missing ${k}`);
  }
  if (!["salesforce", "external"].includes(w.side)) throw new TypeError(`write side ${w.side}`);
  if (![ORIGINATING, ECHO].includes(w.origin)) throw new TypeError(`write origin ${w.origin}`);
  if (!Number.isInteger(w.at)) throw new TypeError(`write at must be integer milliseconds, got ${w.at}`);
  return Object.freeze({
    side: w.side, object: w.object, key: w.key, field: w.field,
    value: w.value === undefined ? null : w.value,
    at: w.at, actor: w.actor, origin: w.origin, evidence: w.evidence, client: w.client ?? null,
  });
}

export function writeKey(object, key, field) {
  return `${object}|${key}|${field}`;
}

/** Deterministic order: by time, then evidence id, so two reads give one answer. */
export function compareWrites(a, b) {
  if (a.at !== b.at) return a.at - b.at;
  return a.evidence < b.evidence ? -1 : a.evidence > b.evidence ? 1 : 0;
}

/** Map of writeKey to {salesforce: Write[], external: Write[]}, each sorted ascending. */
export function indexWrites(writes) {
  const index = new Map();
  for (const w of writes) {
    const k = writeKey(w.object, w.key, w.field);
    if (!index.has(k)) index.set(k, { salesforce: [], external: [] });
    index.get(k)[w.side].push(w);
  }
  for (const entry of index.values()) {
    entry.salesforce.sort(compareWrites);
    entry.external.sort(compareWrites);
  }
  return index;
}

/** The writes of one side within [from, to], keeping order. */
export function inWindow(writes, from, to) {
  return writes.filter((w) => w.at >= from && w.at <= to);
}

export function lastOriginating(writes) {
  for (let i = writes.length - 1; i >= 0; i -= 1) if (writes[i].origin === ORIGINATING) return writes[i];
  return null;
}

export function last(writes) {
  return writes.length === 0 ? null : writes[writes.length - 1];
}
