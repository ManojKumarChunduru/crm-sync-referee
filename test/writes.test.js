import { test } from "node:test";
import assert from "node:assert/strict";
import { makeWrite, indexWrites, writeKey, inWindow, lastOriginating, last, compareWrites, ORIGINATING, ECHO } from "../src/csr/writes.js";
import { w } from "./helpers.js";

test("a write needs every field that identifies it, and names the missing one", () => {
  assert.throws(() => makeWrite({ side: "salesforce", object: "A", key: "k", field: "f", at: 1, actor: "a", origin: ORIGINATING }), /missing evidence/);
});

test("a write refuses an unknown side, an unknown origin, and a non-integer instant", () => {
  const base = { side: "salesforce", object: "A", key: "k", field: "f", at: 1, actor: "a", origin: ORIGINATING, evidence: "e" };
  assert.throws(() => makeWrite({ ...base, side: "erp" }), /write side erp/);
  assert.throws(() => makeWrite({ ...base, origin: "copy" }), /write origin copy/);
  assert.throws(() => makeWrite({ ...base, at: "2026" }), /integer milliseconds/);
});

test("an undefined value is stored as null and a write is frozen", () => {
  const x = makeWrite({ side: "external", object: "A", key: "k", field: "f", at: 1, actor: "a", origin: ECHO, evidence: "e" });
  assert.equal(x.value, null);
  assert.equal(x.client, null);
  assert.equal(Object.isFrozen(x), true);
});

test("the index groups writes by object, key and field, and sorts each side by instant then evidence", () => {
  const writes = [
    w("salesforce", { at: 30, value: "c", evidence: "replayId 3" }),
    w("salesforce", { at: 10, value: "a", evidence: "replayId 1" }),
    w("external", { at: 20, value: "b" }),
    w("salesforce", { at: 10, value: "a2", evidence: "replayId 0" }),
    w("salesforce", { at: 5, value: "other", key: "002" }),
  ];
  const index = indexWrites(writes);
  const entry = index.get(writeKey("Account", "001", "Phone"));
  assert.deepEqual(entry.salesforce.map((x) => x.evidence), ["replayId 0", "replayId 1", "replayId 3"]);
  assert.deepEqual(entry.external.map((x) => x.value), ["b"]);
  assert.equal(index.get(writeKey("Account", "002", "Phone")).salesforce.length, 1);
});

test("compareWrites orders by instant first and evidence second, and is zero only for the same write", () => {
  const a = w("salesforce", { at: 1, value: "x", evidence: "replayId 1" });
  const b = w("salesforce", { at: 1, value: "x", evidence: "replayId 2" });
  assert.ok(compareWrites(a, b) < 0);
  assert.ok(compareWrites(b, a) > 0);
  assert.equal(compareWrites(a, a), 0);
});

test("inWindow keeps writes at both bounds inclusive and drops the rest", () => {
  const writes = [w("salesforce", { at: 9, value: "a" }), w("salesforce", { at: 10, value: "b" }), w("salesforce", { at: 20, value: "c" }), w("salesforce", { at: 21, value: "d" })];
  assert.deepEqual(inWindow(writes, 10, 20).map((x) => x.value), ["b", "c"]);
});

test("lastOriginating skips trailing echoes and returns null when every write is an echo", () => {
  const writes = [w("salesforce", { at: 1, value: "a" }), w("salesforce", { at: 2, value: "b", origin: ECHO })];
  assert.equal(lastOriginating(writes).value, "a");
  assert.equal(lastOriginating([writes[1]]), null);
  assert.equal(lastOriginating([]), null);
});

test("last returns the latest write or null", () => {
  assert.equal(last([]), null);
  assert.equal(last([w("salesforce", { at: 1, value: "a" }), w("salesforce", { at: 2, value: "b" })]).value, "b");
});
