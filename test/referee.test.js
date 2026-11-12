import { test } from "node:test";
import assert from "node:assert/strict";
import { decideField, causeFor, referee, countRows, exitCodeFor, parseDuration, VERDICT, CAUSE, UNATTRIBUTABLE, HOUR_MS } from "../src/csr/referee.js";
import { EXIT_CLEAN, EXIT_STALE, EXIT_UNATTRIBUTABLE } from "../src/csr/exit_codes.js";
import { contract, sfSnapshot, extSnapshot, event, auditEntry, w, AS_OF, H, INTEGRATION_USER, SYNC_ACTOR } from "./helpers.js";

const c = contract();
const WINDOW_FROM = AS_OF - 72 * H;
const SKEW = 5000;

function decide({ field = "Phone", sfValue, extValue, sfWrites = [], extWrites = [], skewMs = SKEW, gapRecord = null, spec }) {
  return decideField({
    object: "Account", key: "001", spec: spec ?? c.objects.Account.fields[field], sfValue, extValue,
    sfWrites, extWrites, windowFrom: WINDOW_FROM, asOf: AS_OF, skewMs, gapRecord,
  });
}

const t = (hoursAgo) => AS_OF - Math.round(hoursAgo * H);

test("equal raw values produce no row at all", () => {
  assert.equal(decide({ sfValue: "1", extValue: "1" }), null);
});

test("values that differ only before normalisation are not a diff, and the reason names the normalisers", () => {
  const row = decide({ sfValue: "+1 (555) 010-1234", extValue: "5550101234" });
  assert.equal(row.verdict, VERDICT.NOT_A_DIFF);
  assert.equal(row.staleSide, null);
  assert.match(row.reason, /us_phone, empty_as_null/);
});

test("null against an empty string on a field with empty_as_null is not a diff", () => {
  assert.equal(decide({ sfValue: null, extValue: "" }).verdict, VERDICT.NOT_A_DIFF);
});

test("a Salesforce-owned field with a Salesforce originating write and nothing on the other side: external stale through sync lag", () => {
  const row = decide({ field: "Name", sfValue: "New", extValue: "Old", sfWrites: [w("salesforce", { at: t(10), value: "New", field: "Name" })] });
  assert.equal(row.verdict, VERDICT.EXTERNAL_STALE);
  assert.equal(row.cause, CAUSE.SYNC_LAG);
  assert.equal(row.staleSide, "external");
  assert.equal(row.authoritativeValue, "New");
  assert.match(row.reason, /Salesforce owns the field; Salesforce has an originating write/);
});

test("an external-owned field written by the external side: Salesforce stale through sync lag", () => {
  const row = decide({ field: "AccountNumber", sfValue: "A1", extValue: "A2", extWrites: [w("external", { at: t(10), value: "A2", field: "AccountNumber" })] });
  assert.equal(row.verdict, VERDICT.SALESFORCE_STALE);
  assert.equal(row.cause, CAUSE.SYNC_LAG);
  assert.equal(row.authoritativeValue, "A2");
});

test("an originating write on the non-owner side as the latest write is a rogue write, whatever the owner did", () => {
  const row = decide({
    field: "Name", sfValue: "Sales", extValue: "Erp",
    sfWrites: [w("salesforce", { at: t(20), value: "Sales", field: "Name" })],
    extWrites: [w("external", { at: t(10), value: "Erp", field: "Name" })],
  });
  assert.equal(row.verdict, VERDICT.EXTERNAL_STALE);
  assert.equal(row.cause, CAUSE.ROGUE_WRITE);
  assert.match(row.reason, /a write the contract does not allow there/);
});

test("the echo of a stale value: the external side wrote v1 then v2, the bridge echoed v1 into Salesforce later, Salesforce is stale", () => {
  const row = decide({
    field: "AccountNumber", sfValue: "v1", extValue: "v2",
    extWrites: [w("external", { at: t(30), value: "v1", field: "AccountNumber" }), w("external", { at: t(20), value: "v2", field: "AccountNumber" })],
    sfWrites: [w("salesforce", { at: t(10), value: "v1", origin: "echo", field: "AccountNumber" })],
  });
  assert.equal(row.verdict, VERDICT.SALESFORCE_STALE);
  assert.equal(row.cause, CAUSE.ECHO_OF_STALE_VALUE);
  assert.match(row.reason, /the value the external system held at .* and no longer holds/);
});

test("an echo carrying a value the owner never held in the window is a sync transform, with the stale side still named by the contract", () => {
  const row = decide({
    field: "AccountNumber", sfValue: "ACC-1", extValue: "ACC-10001",
    extWrites: [w("external", { at: t(20), value: "ACC-10001", field: "AccountNumber" })],
    sfWrites: [w("salesforce", { at: t(10), value: "ACC-1", origin: "echo", field: "AccountNumber" })],
  });
  assert.equal(row.verdict, VERDICT.SALESFORCE_STALE);
  assert.equal(row.cause, CAUSE.SYNC_TRANSFORM);
});

test("an owned field with no write on either side in the window: the contract names the stale side, the cause is window closed", () => {
  const row = decide({ field: "Name", sfValue: "A", extValue: "B" });
  assert.equal(row.verdict, VERDICT.EXTERNAL_STALE);
  assert.equal(row.cause, CAUSE.WINDOW_CLOSED);
  assert.match(row.reason, /named by the contract alone/);
});

test("an owned field whose non-owner side has only an echo and whose owner has no write in the window: cause window closed, not transform", () => {
  const row = decide({
    field: "Name", sfValue: "A", extValue: "B",
    extWrites: [w("external", { at: t(10), value: "B", origin: "echo", field: "Name" })],
  });
  assert.equal(row.cause, CAUSE.WINDOW_CLOSED);
});

test("a shared field: the later originating write wins and the other side is stale through a later write", () => {
  const row = decide({
    sfValue: "1", extValue: "2",
    sfWrites: [w("salesforce", { at: t(10), value: "1" })],
    extWrites: [w("external", { at: t(20), value: "2" })],
  });
  assert.equal(row.verdict, VERDICT.EXTERNAL_STALE);
  assert.equal(row.cause, CAUSE.LATER_WRITE);
  assert.equal(row.decidedBy.salesforce.value, "1");
  assert.match(row.reason, /the field is shared, last originating write wins; Salesforce wrote later/);
});

test("a shared field with only one side writing in the window: that side wins, the other is stale through sync lag", () => {
  const row = decide({ sfValue: "1", extValue: "2", extWrites: [w("external", { at: t(20), value: "2" })] });
  assert.equal(row.verdict, VERDICT.SALESFORCE_STALE);
  assert.equal(row.cause, CAUSE.SYNC_LAG);
});

test("two originating writes inside the skew tolerance cannot be ordered: within clock skew, no side named", () => {
  const row = decide({
    sfValue: "1", extValue: "2",
    sfWrites: [w("salesforce", { at: t(10), value: "1" })],
    extWrites: [w("external", { at: t(10) + 4999, value: "2" })],
  });
  assert.equal(row.verdict, VERDICT.WITHIN_CLOCK_SKEW);
  assert.equal(row.staleSide, null);
  assert.match(row.reason, /4999 ms apart/);
});

test("a gap of exactly the tolerance is within it; one millisecond more decides", () => {
  const at = t(10);
  const sf = [w("salesforce", { at, value: "1" })];
  const withGap = (ms) => decide({ sfValue: "1", extValue: "2", sfWrites: sf, extWrites: [w("external", { at: at + ms, value: "2" })] });
  assert.equal(withGap(5000).verdict, VERDICT.WITHIN_CLOCK_SKEW);
  assert.equal(withGap(5001).verdict, VERDICT.SALESFORCE_STALE);
});

test("a zero tolerance orders any two writes that are not simultaneous", () => {
  const at = t(10);
  const row = decide({ sfValue: "1", extValue: "2", skewMs: 0, sfWrites: [w("salesforce", { at, value: "1" })], extWrites: [w("external", { at: at + 1, value: "2" })] });
  assert.equal(row.verdict, VERDICT.SALESFORCE_STALE);
});

test("a shared field with no originating write on either side in the window: window closed", () => {
  const row = decide({ sfValue: "1", extValue: "2" });
  assert.equal(row.verdict, VERDICT.WINDOW_CLOSED);
  assert.equal(row.cause, null);
  assert.match(row.reason, new RegExp(`from ${new Date(WINDOW_FROM).toISOString()}`));
});

test("a shared field where the only writes in the window on both sides are echoes: sync transform, neither side stale", () => {
  const row = decide({
    sfValue: "1", extValue: "2",
    sfWrites: [w("salesforce", { at: t(10), value: "1", origin: "echo" })],
    extWrites: [w("external", { at: t(9), value: "2", origin: "echo" })],
  });
  assert.equal(row.verdict, VERDICT.SYNC_TRANSFORM);
  assert.equal(row.staleSide, null);
});

test("a shared field with an echo on one side and nothing on the other is window closed, because the originating write expired", () => {
  const row = decide({ sfValue: "1", extValue: "2", sfWrites: [w("salesforce", { at: t(10), value: "1", origin: "echo" })] });
  assert.equal(row.verdict, VERDICT.WINDOW_CLOSED);
});

test("a shared field where the stale side's latest write is a later echo of an older value: echo of a stale value", () => {
  const row = decide({
    sfValue: "1", extValue: "2",
    extWrites: [w("external", { at: t(30), value: "1" }), w("external", { at: t(20), value: "2" })],
    sfWrites: [w("salesforce", { at: t(10), value: "1", origin: "echo" })],
  });
  assert.equal(row.verdict, VERDICT.SALESFORCE_STALE);
  assert.equal(row.cause, CAUSE.ECHO_OF_STALE_VALUE);
});

test("writes outside the window are ignored even when they would decide", () => {
  const row = decide({ sfValue: "1", extValue: "2", sfWrites: [w("salesforce", { at: WINDOW_FROM - 1, value: "1" })] });
  assert.equal(row.verdict, VERDICT.WINDOW_CLOSED);
  assert.deepEqual(row.evidence.salesforce, []);
});

test("writes after the snapshot instant are ignored, because the snapshot cannot have seen them", () => {
  const row = decide({ sfValue: "1", extValue: "2", sfWrites: [w("salesforce", { at: AS_OF + 1, value: "1" })] });
  assert.equal(row.verdict, VERDICT.WINDOW_CLOSED);
});

test("a field the contract maps without an owner is contract silent", () => {
  const row = decide({ field: "Rating", sfValue: "Hot", extValue: "Cold", extWrites: [w("external", { at: t(1), value: "Cold", field: "Rating" })] });
  assert.equal(row.verdict, VERDICT.CONTRACT_SILENT);
  assert.equal(row.staleSide, null);
});

test("a record with a gap event in the window gets a gap event verdict on every real difference, and still not a diff where normalisation decides", () => {
  const gap = { changeType: "GAP_UPDATE", replayId: 77 };
  assert.equal(decide({ sfValue: "1", extValue: "2", gapRecord: gap }).verdict, VERDICT.GAP_EVENT);
  assert.equal(decide({ sfValue: "+1 555 010 1234", extValue: "5550101234", gapRecord: gap }).verdict, VERDICT.NOT_A_DIFF);
  assert.match(decide({ sfValue: "1", extValue: "2", gapRecord: gap }).reason, /GAP_UPDATE, replayId 77/);
});

test("causeFor on a shared field with an originating write as the stale side's latest is a later write, not a rogue write", () => {
  const stale = [w("salesforce", { at: t(10), value: "1" })];
  const auth = [w("external", { at: t(5), value: "2" })];
  const input = { staleW: stale, authW: auth, authO: auth[0], steps: [] };
  assert.equal(causeFor({ ...input, shared: true }).cause, CAUSE.LATER_WRITE);
  assert.equal(causeFor({ ...input, shared: false }).cause, CAUSE.ROGUE_WRITE);
});

test("the unattributable verdicts are exactly the five that name no side", () => {
  assert.deepEqual([...UNATTRIBUTABLE], ["window_closed", "within_clock_skew", "sync_transform", "contract_silent", "gap_event"]);
});

test("parseDuration reads hours with a default unit, days, minutes and seconds, and refuses the rest", () => {
  assert.equal(parseDuration("72h", "h"), 72);
  assert.equal(parseDuration("3d", "h"), 72);
  assert.equal(parseDuration("36", "h"), 36);
  assert.equal(parseDuration("5s", "s"), 5);
  assert.equal(parseDuration("1m", "s"), 60);
  assert.equal(parseDuration("0.5h", "s"), 1800);
  assert.equal(parseDuration("soon", "h"), null);
  assert.equal(parseDuration("-1h", "h"), null);
});

test("countRows splits attributed from unattributable and counts causes", () => {
  const rows = [
    { verdict: VERDICT.EXTERNAL_STALE, cause: CAUSE.SYNC_LAG, staleSide: "external" },
    { verdict: VERDICT.SALESFORCE_STALE, cause: CAUSE.ROGUE_WRITE, staleSide: "salesforce" },
    { verdict: VERDICT.NOT_A_DIFF, cause: null, staleSide: null },
    { verdict: VERDICT.WINDOW_CLOSED, cause: null, staleSide: null },
  ];
  const counts = countRows(rows, [{ id: "x" }]);
  assert.equal(counts.rawDifferences, 4);
  assert.equal(counts.realDiffs, 3);
  assert.equal(counts.attributed, 2);
  assert.equal(counts.unattributable, 1);
  assert.equal(counts.byCause.sync_lag, 1);
  assert.equal(counts.orphans, 1);
});

test("exit codes: 0 with nothing real, 1 with attributed rows or orphans, 2 as soon as one row is unattributable", () => {
  const base = { attributed: 0, unattributable: 0, orphans: 0 };
  assert.equal(exitCodeFor({ counts: base }), EXIT_CLEAN);
  assert.equal(exitCodeFor({ counts: { ...base, attributed: 1 } }), EXIT_STALE);
  assert.equal(exitCodeFor({ counts: { ...base, orphans: 1 } }), EXIT_STALE);
  assert.equal(exitCodeFor({ counts: { ...base, attributed: 9, unattributable: 1 } }), EXIT_UNATTRIBUTABLE);
});

function smallRun(overrides = {}) {
  const sf = sfSnapshot({
    records: { Account: [{ Id: "001A", Name: "Acme", Phone: "1", AccountNumber: "A1", Rating: "Hot" }, { Id: "001B", Name: "Bee", Phone: "2", AccountNumber: "B1", Rating: "Hot" }] },
    events: [
      event({ id: "001A", at: t(10), fields: { Name: "Acme" }, replayId: 1 }),
      event({ id: "001B", at: t(100), fields: { Phone: "2" }, replayId: 2 }),
    ],
    ...overrides.sf,
  });
  const ext = extSnapshot({
    records: { accounts: [{ id: "E1", sf_id: "001A", name: "Acme Old", phone: "1", account_number: "A1", rating: "Hot" }, { id: "E2", sf_id: "001B", name: "Bee", phone: "3", account_number: "B1", rating: "Hot" }] },
    audit: [auditEntry({ id: "a1", recordId: "E2", field: "phone", value: "3", at: t(90) })],
    ...overrides.ext,
  });
  return referee({ contract: c, salesforce: sf, external: ext, ...overrides.options });
}

test("referee runs end to end: the window and skew default to the contract, rows are decided, counts and exit agree", () => {
  const result = smallRun();
  assert.equal(result.windowHours, 72);
  assert.equal(result.skewSeconds, 5);
  assert.equal(result.windowFrom, new Date(AS_OF - 72 * HOUR_MS).toISOString());
  assert.equal(result.compared.records, 2);
  assert.equal(result.compared.fields, 8);
  assert.deepEqual(result.rows.map((r) => [r.key, r.field, r.verdict]), [
    ["001A", "Name", "external_stale"], ["001B", "Phone", "window_closed"],
  ]);
  assert.equal(exitCodeFor(result), EXIT_UNATTRIBUTABLE);
});

test("a wider window turns the expired pair into a decided one", () => {
  const result = smallRun({ options: { windowHours: 200 } });
  assert.equal(result.rows[1].verdict, VERDICT.SALESFORCE_STALE);
  assert.equal(result.rows[1].cause, CAUSE.LATER_WRITE);
  assert.equal(exitCodeFor(result), EXIT_STALE);
});

test("an explicit as-of moves the window and is reported", () => {
  const result = smallRun({ options: { asOf: AS_OF - 50 * H } });
  assert.equal(result.asOfText, new Date(AS_OF - 50 * H).toISOString());
  // The Name write 10 hours before the real snapshot is now after as-of, so it is ignored;
  // the Phone pair is now inside the window.
  assert.deepEqual(result.rows.map((r) => r.verdict), ["external_stale", "salesforce_stale"]);
  assert.equal(result.rows[0].cause, CAUSE.WINDOW_CLOSED);
  assert.equal(result.rows[1].cause, CAUSE.LATER_WRITE);
});

test("the object filter restricts rows and orphans to one object", () => {
  const result = smallRun({ options: { object: "Account" } });
  assert.equal(result.rows.length, 2);
  const none = smallRun({ options: { object: "Contact" } });
  assert.equal(none.rows.length, 0);
  assert.equal(none.compared.records, 0);
});

test("a gap event in the window marks the record; outside the window it does not", () => {
  const gapIn = smallRun({ sf: { events: [event({ id: "001A", type: "GAP_UPDATE", at: t(1), replayId: 3 })] } });
  assert.equal(gapIn.rows[0].verdict, VERDICT.GAP_EVENT);
  assert.equal(gapIn.gaps.length, 1);
  const gapOut = smallRun({ sf: { events: [event({ id: "001A", type: "GAP_UPDATE", at: t(100), replayId: 3 })] } });
  assert.equal(gapOut.rows[0].verdict, VERDICT.EXTERNAL_STALE);
});

test("the result carries the write counts per side and the skipped audit entries", () => {
  const result = smallRun();
  assert.deepEqual(result.writes, { salesforce: 2, external: 1 });
  assert.deepEqual(result.skippedAudit, { unmappedEntity: 0, unmappedField: 0, recordGone: 0 });
});

test("echo identities come from the contract: a write by the integration user never decides a shared field", () => {
  const sf = sfSnapshot({
    records: { Account: [{ Id: "001A", Phone: "1" }] },
    events: [event({ id: "001A", at: t(1), user: INTEGRATION_USER, fields: { Phone: "1" } })],
  });
  const ext = extSnapshot({
    records: { accounts: [{ id: "E1", sf_id: "001A", phone: "2" }] },
    audit: [auditEntry({ recordId: "E1", field: "phone", value: "2", at: t(50), actor: SYNC_ACTOR })],
  });
  const result = referee({ contract: c, salesforce: sf, external: ext });
  assert.equal(result.rows[0].verdict, VERDICT.SYNC_TRANSFORM);
});
