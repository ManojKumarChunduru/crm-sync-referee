import { test } from "node:test";
import assert from "node:assert/strict";
import { joinRecords } from "../src/csr/join.js";
import { contract, sfSnapshot, extSnapshot } from "./helpers.js";

const c = contract();

test("records join through the external record's sf_id, in object then key order", () => {
  const sf = sfSnapshot({ records: { Account: [{ Id: "001B" }, { Id: "001A" }] } });
  const ext = extSnapshot({ records: { accounts: [{ id: "E2", sf_id: "001B" }, { id: "E1", sf_id: "001A" }] } });
  const { pairs, orphans } = joinRecords(sf, ext, c);
  assert.deepEqual(pairs.map((p) => p.key), ["001A", "001B"]);
  assert.equal(pairs[0].external.id, "E1");
  assert.deepEqual(orphans, []);
});

test("an external record with no sf_id, or with one Salesforce does not have, is an external orphan", () => {
  const sf = sfSnapshot({ records: { Account: [{ Id: "001A" }] } });
  const ext = extSnapshot({ records: { accounts: [{ id: "E1", sf_id: "001A" }, { id: "E2" }, { id: "E3", sf_id: "001Z" }] } });
  const { orphans } = joinRecords(sf, ext, c);
  assert.deepEqual(orphans, [
    { object: "Account", side: "external", id: "E2", key: null },
    { object: "Account", side: "external", id: "E3", key: "001Z" },
  ]);
});

test("a Salesforce record no external record points at is a Salesforce orphan", () => {
  const sf = sfSnapshot({ records: { Account: [{ Id: "001A" }, { Id: "001B" }] } });
  const ext = extSnapshot({ records: { accounts: [{ id: "E1", sf_id: "001A" }] } });
  const { orphans } = joinRecords(sf, ext, c);
  assert.deepEqual(orphans, [{ object: "Account", side: "salesforce", id: "001B", key: "001B" }]);
});

test("two external records pointing at one Salesforce record join the first and report the second as a duplicate orphan", () => {
  const sf = sfSnapshot({ records: { Account: [{ Id: "001A" }] } });
  const ext = extSnapshot({ records: { accounts: [{ id: "E1", sf_id: "001A" }, { id: "E2", sf_id: "001A" }] } });
  const { pairs, orphans } = joinRecords(sf, ext, c);
  assert.equal(pairs.length, 1);
  assert.equal(orphans[0].duplicateOf, "001A");
});
