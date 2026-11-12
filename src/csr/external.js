/**
 * The external side: a snapshot per entity and an audit log, read from a
 * directory. `csr pull` writes this same directory from the REST API, so the
 * referee has one reader for both.
 *
 * Why this file exists: an external system's audit log is the only evidence of
 * who wrote a field over there, and a system that does not record the actor
 * cannot be refereed (ADR-005). The reader insists on the actor and the
 * instant for every entry, and maps the entry to the Salesforce record through
 * the external record's foreign key, so a Write looks the same from either side.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeWrite, ORIGINATING, ECHO } from "./writes.js";
import { objectForEntity, fieldForExternal } from "./contract.js";

export class ExternalReadError extends Error {}

export const EXTERNAL_FILES = ["meta.json", "audit.json"];

function readJson(path, what) {
  if (!existsSync(path)) throw new ExternalReadError(`${what} missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ExternalReadError(`${what} is not JSON: ${path}: ${error.message}`);
  }
}

/** Load the external snapshot: records per entity keyed by the external id, plus the audit entries. */
export function loadExternal(dir, contract) {
  const meta = readJson(join(dir, "meta.json"), "meta.json");
  if (typeof meta.as_of !== "string" || Number.isNaN(Date.parse(meta.as_of))) {
    throw new ExternalReadError(`meta.json: as_of must be an ISO instant, got ${JSON.stringify(meta.as_of)}`);
  }
  const records = {};
  for (const object of Object.values(contract.objects)) {
    const entity = object.externalEntity;
    const file = readJson(join(dir, `${entity}.json`), `${entity}.json`);
    if (!Array.isArray(file.items)) throw new ExternalReadError(`${entity}.json: expected an items array`);
    const map = new Map();
    file.items.forEach((r, i) => {
      if (typeof r.id !== "string" || r.id === "") throw new ExternalReadError(`${entity}.json: items[${i}] has no id`);
      if (map.has(r.id)) throw new ExternalReadError(`${entity}.json: ${r.id} appears twice`);
      map.set(r.id, r);
    });
    records[entity] = map;
  }
  const auditFile = readJson(join(dir, "audit.json"), "audit.json");
  if (!Array.isArray(auditFile.items)) throw new ExternalReadError("audit.json: expected an items array");
  const audit = auditFile.items.map((a, i) => {
    const where = `audit.json[${i}]`;
    for (const k of ["id", "entity", "record_id", "field", "actor", "at"]) {
      if (typeof a[k] !== "string" || a[k] === "") throw new ExternalReadError(`${where}: ${k} must be a non-empty string`);
    }
    const at = Date.parse(a.at);
    if (Number.isNaN(at)) throw new ExternalReadError(`${where}: at ${JSON.stringify(a.at)} is not an ISO instant`);
    if (!("new" in a)) throw new ExternalReadError(`${where}: new is required (null is a write of null)`);
    return {
      id: a.id, entity: a.entity, recordId: a.record_id, field: a.field,
      old: a.old ?? null, value: a.new, actor: a.actor, at,
    };
  });
  return {
    asOf: Date.parse(meta.as_of),
    asOfText: meta.as_of,
    system: meta.system ?? null,
    records,
    audit,
  };
}

/**
 * Reduce audit entries to Writes on contract fields. Entries on entities or
 * fields the contract does not map are skipped and counted; entries whose
 * record is no longer in the snapshot are skipped and counted too, because the
 * record cannot be joined to a Salesforce Id without its current row.
 */
export function writesFromAudit(ext, contract) {
  const writes = [];
  const skipped = { unmappedEntity: 0, unmappedField: 0, recordGone: 0 };
  const syncActor = contract.systems.external.syncActor;
  for (const a of ext.audit) {
    const object = objectForEntity(contract, a.entity);
    if (object === undefined) { skipped.unmappedEntity += 1; continue; }
    const field = fieldForExternal(object, a.field);
    if (field === undefined) { skipped.unmappedField += 1; continue; }
    const record = ext.records[a.entity].get(a.recordId);
    if (record === undefined) { skipped.recordGone += 1; continue; }
    const key = record[object.key.external];
    if (typeof key !== "string" || key === "") { skipped.recordGone += 1; continue; }
    writes.push(makeWrite({
      side: "external", object: object.name, key, field: field.name, value: a.value,
      at: a.at, actor: a.actor, origin: a.actor === syncActor ? ECHO : ORIGINATING,
      evidence: `audit ${a.id}`,
    }));
  }
  return { writes, skipped };
}
