import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSalesforce, writesFromEvents, originOf, clientOf, SalesforceReadError } from "../src/csr/salesforce.js";
import { ORIGINATING, ECHO } from "../src/csr/writes.js";
import { contract, sfSnapshot, event, tempDir, SF_DIR, INTEGRATION_USER, AS_OF } from "./helpers.js";

const c = contract();

function sfDir(overrides = {}) {
  const files = {
    "snapshot.json": { as_of: "2026-11-10T00:00:00.000Z" },
    "Account.json": { records: [{ attributes: { type: "Account" }, Id: "001A", Name: "Acme", Phone: "1", AccountNumber: "A", Rating: "Hot" }] },
    "events/AccountChangeEvent.json": [],
    ...overrides,
  };
  return tempDir(files);
}

test("the committed Salesforce snapshot has 148 accounts, 249 contacts and change events for both", async () => {
  const { loadContract } = await import("../src/csr/contract.js");
  const { CONTRACT_PATH } = await import("./helpers.js");
  const sf = loadSalesforce(SF_DIR, loadContract(CONTRACT_PATH));
  assert.equal(sf.asOf, AS_OF);
  assert.equal(sf.records.Account.size, 148);
  assert.equal(sf.records.Contact.size, 249);
  assert.ok(sf.events.length > 100);
  assert.ok(sf.events.every((e) => Number.isInteger(e.replayId)));
});

test("clientOf reads the client= part of a changeOrigin and returns null without one", () => {
  assert.equal(clientOf("com/salesforce/api/rest/62.0;client=SyncBridge"), "SyncBridge");
  assert.equal(clientOf("com/salesforce/api/soap/49.0;client=Astro"), "Astro");
  assert.equal(clientOf("com/salesforce/api/rest/62.0"), null);
  assert.equal(clientOf(""), null);
  assert.equal(clientOf(undefined), null);
});

test("a change committed by the integration user is an echo whatever its changeOrigin", () => {
  assert.equal(originOf({ commitUser: INTEGRATION_USER, changeOrigin: "" }, c), ECHO);
});

test("a change whose changeOrigin names the bridge client is an echo whoever committed it", () => {
  assert.equal(originOf({ commitUser: "005X", changeOrigin: "com/salesforce/api/rest/62.0;client=SyncBridge" }, c), ECHO);
});

test("a change with an empty changeOrigin by a user is originating: the optimistic reading ADR-005 declares", () => {
  assert.equal(originOf({ commitUser: "005X", changeOrigin: "" }, c), ORIGINATING);
  assert.equal(originOf({ commitUser: "005X" }, c), ORIGINATING);
});

test("an UPDATE event writes exactly the contract fields named in changedFields, with the payload value", () => {
  const sf = sfSnapshot({ events: [event({ id: "001A", at: AS_OF - 1, fields: { Phone: "555", Fax: "x" }, replayId: 7 })] });
  const { writes, gaps } = writesFromEvents(sf, c);
  assert.equal(gaps.length, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].field, "Phone");
  assert.equal(writes[0].value, "555");
  assert.equal(writes[0].evidence, "replayId 7");
  assert.equal(writes[0].origin, ORIGINATING);
  assert.equal(writes[0].client, null);
});

test("a changed field whose payload value is null is a write of null, not a skipped write", () => {
  const sf = sfSnapshot({ events: [event({ id: "001A", at: AS_OF - 1, fields: { Phone: null } })] });
  const { writes } = writesFromEvents(sf, c);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value, null);
});

test("a CREATE event writes every contract field present and non-null in the payload", () => {
  const sf = sfSnapshot({ events: [event({ id: "001A", type: "CREATE", at: AS_OF - 1, fields: { Name: "Acme", Phone: null, AccountNumber: "A1" } })] });
  const { writes } = writesFromEvents(sf, c);
  assert.deepEqual(writes.map((w) => w.field).sort(), ["AccountNumber", "Name"]);
});

test("DELETE and UNDELETE events write nothing", () => {
  const sf = sfSnapshot({ events: [event({ id: "001A", type: "DELETE", at: AS_OF - 1 }), event({ id: "001A", type: "UNDELETE", at: AS_OF - 1 })] });
  assert.equal(writesFromEvents(sf, c).writes.length, 0);
});

test("a gap event is returned apart, with its records, and writes nothing", () => {
  const sf = sfSnapshot({ events: [event({ id: "001A", type: "GAP_UPDATE", at: AS_OF - 1, replayId: 9 })] });
  const { writes, gaps } = writesFromEvents(sf, c);
  assert.equal(writes.length, 0);
  assert.deepEqual(gaps, [{ object: "Account", replayId: 9, changeType: "GAP_UPDATE", recordIds: ["001A"], at: AS_OF - 1 }]);
});

test("an event merged over several recordIds writes each record", () => {
  const e = event({ id: "001A", at: AS_OF - 1, fields: { Phone: "1" } });
  e.header.recordIds = ["001A", "001B"];
  const { writes } = writesFromEvents(sfSnapshot({ events: [e] }), c);
  assert.deepEqual(writes.map((w) => w.key), ["001A", "001B"]);
});

test("the client is carried on the write so explain can show it", () => {
  const e = event({ id: "001A", at: AS_OF - 1, fields: { Phone: "1" }, origin: "com/salesforce/api/soap/62.0;client=DataLoader" });
  assert.equal(writesFromEvents(sfSnapshot({ events: [e] }), c).writes[0].client, "DataLoader");
});

test("loadSalesforce reads records keyed by Id and events in replay order", () => {
  const dir = sfDir({
    "events/AccountChangeEvent.json": [{
      channel: "/data/AccountChangeEvent",
      data: { schema: "s", payload: { ChangeEventHeader: { entityName: "Account", recordIds: ["001A"], changeType: "UPDATE", changeOrigin: "", transactionKey: "t", sequenceNumber: 1, commitTimestamp: 1, commitUser: "u", changedFields: ["Phone"] }, Phone: "2" }, event: { replayId: 5 } },
    }],
  });
  const sf = loadSalesforce(dir, c);
  assert.equal(sf.records.Account.get("001A").Name, "Acme");
  assert.equal(sf.events[0].replayId, 5);
  assert.equal(sf.asOfText, "2026-11-10T00:00:00.000Z");
});

test("a missing snapshot.json, record file or event file is refused with its path", () => {
  assert.throws(() => loadSalesforce("/nonexistent", c), (e) => e instanceof SalesforceReadError && /snapshot\.json missing/.test(e.message));
  const dir = tempDir({ "snapshot.json": { as_of: "2026-11-10T00:00:00.000Z" } });
  assert.throws(() => loadSalesforce(dir, c), /Account\.json missing/);
  const dir2 = tempDir({ "snapshot.json": { as_of: "2026-11-10T00:00:00.000Z" }, "Account.json": { records: [] } });
  assert.throws(() => loadSalesforce(dir2, c), /events\/AccountChangeEvent\.json missing/);
});

test("an as_of that is not an instant is refused", () => {
  assert.throws(() => loadSalesforce(sfDir({ "snapshot.json": { as_of: "yesterday" } }), c), /as_of must be an ISO instant/);
});

test("a record file that is not a query result, a record without an Id, and a duplicate Id are refused", () => {
  assert.throws(() => loadSalesforce(sfDir({ "Account.json": [] }), c), /expected a REST query result/);
  assert.throws(() => loadSalesforce(sfDir({ "Account.json": { records: [{ Name: "x" }] } }), c), /records\[0\] has no Id/);
  assert.throws(() => loadSalesforce(sfDir({ "Account.json": { records: [{ Id: "001A" }, { Id: "001A" }] } }), c), /001A appears twice/);
});

test("a file that is not JSON is refused with its path", () => {
  assert.throws(() => loadSalesforce(sfDir({ "Account.json": "{oops" }), c), /Account\.json is not JSON/);
});

function withHeader(header, extra = {}) {
  return [{ channel: "/data/AccountChangeEvent", data: { schema: "s", payload: { ChangeEventHeader: header, ...extra }, event: { replayId: 1 } } }];
}

const GOOD = { entityName: "Account", recordIds: ["001A"], changeType: "UPDATE", changeOrigin: "", transactionKey: "t", sequenceNumber: 1, commitTimestamp: 1, commitUser: "u", changedFields: ["Phone"] };

test("every documented header field is validated and a bad one names the message index", () => {
  const cases = [
    [{ ...GOOD, entityName: 1 }, /entityName must be a string/],
    [{ ...GOOD, recordIds: "001A" }, /recordIds must be an array of strings/],
    [{ ...GOOD, changeType: "MODIFY" }, /changeType "MODIFY" is not a documented value/],
    [{ ...GOOD, commitTimestamp: "2026" }, /commitTimestamp must be integer milliseconds/],
    [{ ...GOOD, commitUser: null }, /commitUser must be a string/],
    [{ ...GOOD, changeOrigin: 5 }, /changeOrigin must be a string when present/],
    [{ ...GOOD, changedFields: "Phone" }, /changedFields must be an array of strings/],
    [{ ...GOOD, entityName: "Contact" }, /entityName Contact in the Account event file/],
  ];
  for (const [header, pattern] of cases) {
    assert.throws(() => loadSalesforce(sfDir({ "events/AccountChangeEvent.json": withHeader(header) }), c), pattern);
  }
  assert.doesNotThrow(() => loadSalesforce(sfDir({ "events/AccountChangeEvent.json": withHeader(GOOD) }), c));
});

test("a message without data.payload, data.event or an integer replayId is refused", () => {
  const bad = [{ channel: "/data/AccountChangeEvent", data: { payload: { ChangeEventHeader: GOOD } } }];
  assert.throws(() => loadSalesforce(sfDir({ "events/AccountChangeEvent.json": bad }), c), /expected data\.payload and data\.event\.replayId/);
  assert.throws(() => loadSalesforce(sfDir({ "events/AccountChangeEvent.json": { not: "an array" } }), c), /expected an array of messages/);
  const noHeader = [{ channel: "x", data: { payload: { Phone: "1" }, event: { replayId: 1 } } }];
  assert.throws(() => loadSalesforce(sfDir({ "events/AccountChangeEvent.json": noHeader }), c), /payload has no ChangeEventHeader/);
});

test("a header without changeOrigin or changedFields is accepted (both are optional in the reference)", () => {
  const header = { ...GOOD };
  delete header.changeOrigin;
  delete header.changedFields;
  const sf = loadSalesforce(sfDir({ "events/AccountChangeEvent.json": withHeader(header) }), c);
  assert.equal(writesFromEvents(sf, c).writes.length, 0);
});
