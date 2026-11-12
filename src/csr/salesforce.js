/**
 * The Salesforce side: a snapshot of records in REST query shape and the Change
 * Data Capture messages a subscriber captured, in CometD shape.
 *
 * Why this file exists: change events are the only persisted record of who
 * wrote a field and from which client, and the fields that say so
 * (ChangeEventHeader.commitUser, changeOrigin, commitTimestamp, changedFields)
 * are validated here against the documented header, so a malformed capture is
 * refused with the replayId named rather than read as a record with no writer.
 * The reader does not know what a verdict is; it produces Writes.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeWrite, ORIGINATING, ECHO } from "./writes.js";

export class SalesforceReadError extends Error {}

const CHANGE_TYPES = new Set(["CREATE", "UPDATE", "DELETE", "UNDELETE", "SNAPSHOT"]);
const GAP_TYPES = new Set(["GAP_CREATE", "GAP_UPDATE", "GAP_DELETE", "GAP_UNDELETE", "GAP_OVERFLOW"]);

function readJson(path, what) {
  if (!existsSync(path)) throw new SalesforceReadError(`${what} missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SalesforceReadError(`${what} is not JSON: ${path}: ${error.message}`);
  }
}

/** Parse the "client=" part of a changeOrigin string, or null. */
export function clientOf(changeOrigin) {
  if (typeof changeOrigin !== "string" || changeOrigin === "") return null;
  const m = /;client=(.*)$/.exec(changeOrigin);
  return m === null ? null : m[1];
}

function validateHeader(header, where) {
  if (header === null || typeof header !== "object") throw new SalesforceReadError(`${where}: payload has no ChangeEventHeader`);
  const h = header;
  if (typeof h.entityName !== "string") throw new SalesforceReadError(`${where}: ChangeEventHeader.entityName must be a string`);
  if (!Array.isArray(h.recordIds) || h.recordIds.some((id) => typeof id !== "string")) {
    throw new SalesforceReadError(`${where}: ChangeEventHeader.recordIds must be an array of strings`);
  }
  if (!CHANGE_TYPES.has(h.changeType) && !GAP_TYPES.has(h.changeType)) {
    throw new SalesforceReadError(`${where}: ChangeEventHeader.changeType ${JSON.stringify(h.changeType)} is not a documented value`);
  }
  if (!Number.isInteger(h.commitTimestamp)) throw new SalesforceReadError(`${where}: ChangeEventHeader.commitTimestamp must be integer milliseconds`);
  if (typeof h.commitUser !== "string") throw new SalesforceReadError(`${where}: ChangeEventHeader.commitUser must be a string`);
  if (h.changeOrigin !== undefined && typeof h.changeOrigin !== "string") {
    throw new SalesforceReadError(`${where}: ChangeEventHeader.changeOrigin must be a string when present`);
  }
  if (h.changedFields !== undefined && (!Array.isArray(h.changedFields) || h.changedFields.some((f) => typeof f !== "string"))) {
    throw new SalesforceReadError(`${where}: ChangeEventHeader.changedFields must be an array of strings`);
  }
  return h;
}

/** Load the snapshot: records per contract object, and the events per object. */
export function loadSalesforce(dir, contract) {
  const meta = readJson(join(dir, "snapshot.json"), "snapshot.json");
  if (typeof meta.as_of !== "string" || Number.isNaN(Date.parse(meta.as_of))) {
    throw new SalesforceReadError(`snapshot.json: as_of must be an ISO instant, got ${JSON.stringify(meta.as_of)}`);
  }
  const records = {};
  const events = [];
  for (const object of Object.values(contract.objects)) {
    const file = readJson(join(dir, `${object.name}.json`), `${object.name}.json`);
    if (!Array.isArray(file.records)) throw new SalesforceReadError(`${object.name}.json: expected a REST query result with a records array`);
    const map = new Map();
    file.records.forEach((r, i) => {
      const id = r[object.key.salesforce];
      if (typeof id !== "string" || id === "") throw new SalesforceReadError(`${object.name}.json: records[${i}] has no ${object.key.salesforce}`);
      if (map.has(id)) throw new SalesforceReadError(`${object.name}.json: ${id} appears twice`);
      map.set(id, r);
    });
    records[object.name] = map;
    const eventsPath = join(dir, "events", `${object.name}ChangeEvent.json`);
    const captured = readJson(eventsPath, `events/${object.name}ChangeEvent.json`);
    if (!Array.isArray(captured)) throw new SalesforceReadError(`events/${object.name}ChangeEvent.json: expected an array of messages`);
    captured.forEach((message, i) => {
      const where = `events/${object.name}ChangeEvent.json[${i}]`;
      const data = message && message.data;
      if (!data || !data.payload || !data.event || !Number.isInteger(data.event.replayId)) {
        throw new SalesforceReadError(`${where}: expected data.payload and data.event.replayId`);
      }
      const header = validateHeader(data.payload.ChangeEventHeader, where);
      if (header.entityName !== object.name) {
        throw new SalesforceReadError(`${where}: entityName ${header.entityName} in the ${object.name} event file`);
      }
      events.push({
        object: object.name, replayId: data.event.replayId, header,
        payload: data.payload, channel: message.channel ?? null,
      });
    });
  }
  return {
    asOf: Date.parse(meta.as_of),
    asOfText: meta.as_of,
    orgId: meta.org_id ?? null,
    records,
    events,
  };
}

/** The origin of an event: an echo when the integration user or its client committed it. */
export function originOf(header, contract) {
  const sys = contract.systems.salesforce;
  if (header.commitUser === sys.integrationUser) return ECHO;
  if (clientOf(header.changeOrigin) === sys.changeOriginClient) return ECHO;
  return ORIGINATING;
}

/**
 * Reduce events to Writes on contract fields. CREATE writes every contract field
 * present in the payload; UPDATE writes the fields named in changedFields; DELETE
 * and UNDELETE write nothing (a missing record is an orphan, not a diff); gap
 * and overflow events are returned apart, because the record's history has a
 * hole the referee must report instead of reading around.
 */
export function writesFromEvents(sf, contract) {
  const writes = [];
  const gaps = [];
  for (const e of sf.events) {
    const object = contract.objects[e.object];
    const h = e.header;
    if (GAP_TYPES.has(h.changeType)) {
      gaps.push({
        object: e.object, replayId: e.replayId, changeType: h.changeType, recordIds: h.recordIds, at: h.commitTimestamp,
      });
      continue;
    }
    if (h.changeType !== "CREATE" && h.changeType !== "UPDATE") continue;
    const fieldNames = h.changeType === "CREATE"
      ? Object.keys(object.fields).filter((f) => f in e.payload && e.payload[f] !== null)
      : (h.changedFields ?? []).filter((f) => f in object.fields);
    const origin = originOf(h, contract);
    for (const recordId of h.recordIds) {
      for (const field of fieldNames) {
        writes.push(makeWrite({
          side: "salesforce", object: e.object, key: recordId, field,
          value: e.payload[field] === undefined ? null : e.payload[field],
          at: h.commitTimestamp, actor: h.commitUser, origin,
          evidence: `replayId ${e.replayId}`, client: clientOf(h.changeOrigin),
        }));
      }
    }
  }
  return { writes, gaps };
}
