import { test } from "node:test";
import assert from "node:assert/strict";
import { loadExternal, writesFromAudit, ExternalReadError } from "../src/csr/external.js";
import { loadContract } from "../src/csr/contract.js";
import { ORIGINATING, ECHO } from "../src/csr/writes.js";
import { contract, extSnapshot, auditEntry, tempDir, EXT_DIR, CONTRACT_PATH, SYNC_ACTOR, AS_OF } from "./helpers.js";

const c = contract();

function extDir(overrides = {}) {
  return tempDir({
    "meta.json": { as_of: "2026-11-10T00:00:00.000Z", system: "ERP" },
    "accounts.json": { items: [{ id: "E1", sf_id: "001A", name: "Acme", phone: "1", account_number: "A", rating: "Hot" }] },
    "audit.json": { items: [] },
    ...overrides,
  });
}

test("the committed external snapshot loads: 149 accounts, 249 contacts and the audit log", () => {
  const ext = loadExternal(EXT_DIR, loadContract(CONTRACT_PATH));
  assert.equal(ext.asOf, AS_OF);
  assert.equal(ext.records.accounts.size, 149);
  assert.equal(ext.records.contacts.size, 249);
  assert.ok(ext.audit.length > 100);
  assert.equal(ext.system, "ERP");
});

test("an audit entry becomes a write keyed by the Salesforce Id the external record carries", () => {
  const ext = extSnapshot({
    records: { accounts: [{ id: "E1", sf_id: "001A", phone: "2" }] },
    audit: [auditEntry({ recordId: "E1", field: "phone", value: "2", at: AS_OF - 1, id: "aud-9" })],
  });
  const { writes, skipped } = writesFromAudit(ext, c);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "001A");
  assert.equal(writes[0].field, "Phone");
  assert.equal(writes[0].evidence, "audit aud-9");
  assert.equal(writes[0].origin, ORIGINATING);
  assert.deepEqual(skipped, { unmappedEntity: 0, unmappedField: 0, recordGone: 0 });
});

test("an entry by the sync actor is an echo", () => {
  const ext = extSnapshot({
    records: { accounts: [{ id: "E1", sf_id: "001A" }] },
    audit: [auditEntry({ recordId: "E1", field: "phone", value: "2", at: AS_OF - 1, actor: SYNC_ACTOR })],
  });
  assert.equal(writesFromAudit(ext, c).writes[0].origin, ECHO);
});

test("entries on an unmapped entity, an unmapped field, or a record no longer in the snapshot are skipped and counted", () => {
  const ext = extSnapshot({
    records: { accounts: [{ id: "E1", sf_id: "001A" }, { id: "E2" }] },
    audit: [
      auditEntry({ recordId: "O1", entity: "orders", field: "total", value: "1", at: 1 }),
      auditEntry({ recordId: "E1", field: "fax", value: "1", at: 1 }),
      auditEntry({ recordId: "E9", field: "phone", value: "1", at: 1 }),
      auditEntry({ recordId: "E2", field: "phone", value: "1", at: 1 }),
    ],
  });
  const { writes, skipped } = writesFromAudit(ext, c);
  assert.equal(writes.length, 0);
  assert.deepEqual(skipped, { unmappedEntity: 1, unmappedField: 1, recordGone: 2 });
});

test("loadExternal keeps the old value, parses the instant, and accepts a null new value", () => {
  const dir = extDir({ "audit.json": { items: [{ id: "a1", entity: "accounts", record_id: "E1", field: "phone", old: "1", new: null, actor: "u", at: "2026-11-09T00:00:00Z" }] } });
  const ext = loadExternal(dir, c);
  assert.equal(ext.audit[0].old, "1");
  assert.equal(ext.audit[0].value, null);
  assert.equal(ext.audit[0].at, Date.UTC(2026, 10, 9));
});

test("a missing meta.json, entity file or audit file is refused with its path", () => {
  assert.throws(() => loadExternal("/nonexistent", c), (e) => e instanceof ExternalReadError && /meta\.json missing/.test(e.message));
  const dir = tempDir({ "meta.json": { as_of: "2026-11-10T00:00:00.000Z" } });
  assert.throws(() => loadExternal(dir, c), /accounts\.json missing/);
  const dir2 = tempDir({ "meta.json": { as_of: "2026-11-10T00:00:00.000Z" }, "accounts.json": { items: [] } });
  assert.throws(() => loadExternal(dir2, c), /audit\.json missing/);
});

test("a bad as_of, a non-array items, a record without an id, and a duplicate id are refused", () => {
  assert.throws(() => loadExternal(extDir({ "meta.json": { as_of: "soon" } }), c), /as_of must be an ISO instant/);
  assert.throws(() => loadExternal(extDir({ "accounts.json": [] }), c), /expected an items array/);
  assert.throws(() => loadExternal(extDir({ "accounts.json": { items: [{ sf_id: "x" }] } }), c), /items\[0\] has no id/);
  assert.throws(() => loadExternal(extDir({ "accounts.json": { items: [{ id: "E1" }, { id: "E1" }] } }), c), /E1 appears twice/);
  assert.throws(() => loadExternal(extDir({ "audit.json": { items: "no" } }), c), /audit\.json: expected an items array/);
});

test("an audit entry missing any required field, with a bad instant, or without new is refused by index", () => {
  const base = { id: "a1", entity: "accounts", record_id: "E1", field: "phone", new: "1", actor: "u", at: "2026-11-09T00:00:00Z" };
  for (const k of ["id", "entity", "record_id", "field", "actor", "at"]) {
    const entry = { ...base };
    delete entry[k];
    assert.throws(() => loadExternal(extDir({ "audit.json": { items: [entry] } }), c), new RegExp(`audit\\.json\\[0\\]: ${k} must be a non-empty string`));
  }
  assert.throws(() => loadExternal(extDir({ "audit.json": { items: [{ ...base, at: "noon" }] } }), c), /is not an ISO instant/);
  const noNew = { ...base };
  delete noNew.new;
  assert.throws(() => loadExternal(extDir({ "audit.json": { items: [noNew] } }), c), /new is required/);
});

test("a file that is not JSON is refused with its path", () => {
  assert.throws(() => loadExternal(extDir({ "audit.json": "{" }), c), /audit\.json is not JSON/);
});
