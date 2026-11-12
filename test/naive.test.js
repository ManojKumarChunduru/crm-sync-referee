import { test } from "node:test";
import assert from "node:assert/strict";
import { naiveReferee } from "../src/csr/naive.js";
import { contract, sfSnapshot, extSnapshot, event, auditEntry, AS_OF, H, INTEGRATION_USER } from "./helpers.js";

const c = contract();
const t = (hoursAgo) => AS_OF - hoursAgo * H;

function run({ sfEvents = [], audit = [], sfPhone = "1", extPhone = "2" }) {
  const sf = sfSnapshot({ records: { Account: [{ Id: "001A", Phone: sfPhone, Name: "n", AccountNumber: "a", Rating: "r" }] }, events: sfEvents });
  const ext = extSnapshot({ records: { accounts: [{ id: "E1", sf_id: "001A", phone: extPhone, name: "n", account_number: "a", rating: "r" }] }, audit });
  return naiveReferee({ contract: c, salesforce: sf, external: ext });
}

test("the naive referee reports a raw difference even when normalisation would remove it", () => {
  const rows = run({ sfPhone: "+1 555 010 1234", extPhone: "5550101234" });
  assert.equal(rows.length, 1);
});

test("with no writes anywhere it defaults to Salesforce as the system of record", () => {
  const rows = run({});
  assert.equal(rows[0].staleSide, "external");
  assert.equal(rows[0].defaulted, true);
  assert.equal(rows[0].decidedBy, null);
});

test("it takes the later write whoever wrote it, so a later echo decides against the originating side", () => {
  const rows = run({
    audit: [auditEntry({ recordId: "E1", field: "phone", value: "2", at: t(20) })],
    sfEvents: [event({ id: "001A", at: t(10), user: INTEGRATION_USER, fields: { Phone: "1" } })],
  });
  assert.equal(rows[0].staleSide, "external");
  assert.equal(rows[0].decidedBy.origin, "echo");
});

test("it reads the full log with no window, so an expired write still decides", () => {
  const rows = run({ audit: [auditEntry({ recordId: "E1", field: "phone", value: "2", at: t(1000) })] });
  assert.equal(rows[0].staleSide, "salesforce");
});

test("a tie in time goes to Salesforce", () => {
  const rows = run({
    audit: [auditEntry({ recordId: "E1", field: "phone", value: "2", at: t(10) })],
    sfEvents: [event({ id: "001A", at: t(10), fields: { Phone: "1" } })],
  });
  assert.equal(rows[0].staleSide, "external");
});

test("only one side having a write decides for that side", () => {
  assert.equal(run({ sfEvents: [event({ id: "001A", at: t(10), fields: { Phone: "1" } })] })[0].staleSide, "external");
  assert.equal(run({ audit: [auditEntry({ recordId: "E1", field: "phone", value: "2", at: t(10) })] })[0].staleSide, "salesforce");
});
