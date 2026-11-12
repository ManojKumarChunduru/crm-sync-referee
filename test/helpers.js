/**
 * Builders for in-memory contracts, snapshots and writes, so a test can state a
 * scenario in a few lines. The shapes match what the readers produce.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { validateContract } from "../src/csr/contract.js";
import { makeWrite } from "../src/csr/writes.js";

export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const FIXTURE = join(ROOT, "fixture");
export const SF_DIR = join(FIXTURE, "salesforce");
export const EXT_DIR = join(FIXTURE, "external");
export const CONTRACT_PATH = join(ROOT, "contract", "sync-contract.json");

export const AS_OF = Date.UTC(2026, 10, 10, 0, 0, 0);
export const H = 3_600_000;
export const INTEGRATION_USER = "005Kd000000SYNCAAA";
export const SYNC_ACTOR = "svc-sync-bridge";

/** A raw contract object, minimal but valid, that a test can tweak before validating. */
export function rawContract(overrides = {}) {
  return {
    name: "test contract",
    systems: {
      salesforce: { integration_user: INTEGRATION_USER, change_origin_client: "SyncBridge", reason: "the bridge" },
      external: { name: "ERP", sync_actor: SYNC_ACTOR, reason: "the bridge" },
    },
    clock_skew_tolerance_seconds: 5,
    clock_skew_reason: "policy",
    retention_hours: 72,
    retention_reason: "three days",
    objects: {
      Account: {
        external_entity: "accounts",
        key: { salesforce: "Id", external: "sf_id" },
        fields: {
          Name: { owner: "salesforce", external_field: "name", normalize: ["trim"], reason: "sales owns it" },
          Phone: { owner: "shared", external_field: "phone", normalize: ["us_phone", "empty_as_null"], reason: "both" },
          AccountNumber: { owner: "external", external_field: "account_number", reason: "erp owns it" },
          Rating: { owner: "undeclared", external_field: "rating", reason: "nobody decided" },
        },
      },
    },
    ...overrides,
  };
}

export function contract(overrides) {
  return validateContract(rawContract(overrides));
}

/** A Salesforce snapshot object shaped like loadSalesforce's output, from plain records and events. */
export function sfSnapshot({ records = {}, events = [], asOf = AS_OF } = {}) {
  const maps = {};
  for (const [object, list] of Object.entries(records)) maps[object] = new Map(list.map((r) => [r.Id, r]));
  return { asOf, asOfText: new Date(asOf).toISOString(), orgId: null, records: maps, events };
}

/** One change event in the reader's internal shape. */
export function event({ object = "Account", id, type = "UPDATE", at, user = "005Kd0000000A1BAAU", origin = "com/salesforce/api/rest/62.0", fields = {}, replayId = 1 }) {
  return {
    object, replayId, channel: `/data/${object}ChangeEvent`,
    header: {
      entityName: object, recordIds: [id], changeType: type, changeOrigin: origin, transactionKey: "t", sequenceNumber: 1,
      commitTimestamp: at, commitNumber: 1, commitUser: user, changedFields: type === "UPDATE" ? [...Object.keys(fields), "LastModifiedDate"] : [],
    },
    payload: { ChangeEventHeader: null, ...fields },
  };
}

/** An external snapshot shaped like loadExternal's output. */
export function extSnapshot({ records = {}, audit = [], asOf = AS_OF } = {}) {
  const maps = {};
  for (const [entity, list] of Object.entries(records)) maps[entity] = new Map(list.map((r) => [r.id, r]));
  return { asOf, asOfText: new Date(asOf).toISOString(), system: "ERP", records: maps, audit };
}

export function auditEntry({ id = "aud-1", entity = "accounts", recordId, field, value, actor = "u.amara", at, old = null }) {
  return { id, entity, recordId, field, old, value, actor, at };
}

/** A Write on both sides in one call. */
export function w(side, { at, value, origin = "originating", actor, evidence, object = "Account", key = "001", field = "Phone" }) {
  return makeWrite({
    side, object, key, field, value, at,
    actor: actor ?? (origin === "echo" ? (side === "salesforce" ? INTEGRATION_USER : SYNC_ACTOR) : "someone"),
    origin, evidence: evidence ?? `${side === "salesforce" ? "replayId" : "audit"} ${at}`,
  });
}

/** A temporary directory with the given files (relative path to text). */
export function tempDir(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "csr-"));
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, typeof text === "string" ? text : JSON.stringify(text, null, 2));
  }
  return dir;
}

/** Captures what the CLI writes. */
export function capture() {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    stdout: { write: (t) => { out.stdout += t; return true; } },
    stderr: { write: (t) => { out.stderr += t; return true; } },
  };
}
