import { test } from "node:test";
import assert from "node:assert/strict";
import { NORMALISERS, normalizeValue, normalizedEqual, validateStep, NormaliserError } from "../src/csr/normalize.js";

test("trim removes leading and trailing whitespace and leaves the inside alone", () => {
  assert.equal(normalizeValue("  Acme  Inc ", [{ name: "trim" }]), "Acme  Inc");
});

test("lower folds case", () => {
  assert.equal(normalizeValue("Ada.Lovelace@Example.COM", [{ name: "lower" }]), "ada.lovelace@example.com");
});

test("digits keeps only the digits, so punctuation and a plus sign do not make a difference", () => {
  assert.equal(normalizeValue("+1 (555) 010-1234", [{ name: "digits" }]), "15550101234");
});

test("us_phone drops a leading country code 1 only when eleven digits remain", () => {
  assert.equal(normalizeValue("+1 (555) 010-1234", [{ name: "us_phone" }]), "5550101234");
  assert.equal(normalizeValue("555-010-1234", [{ name: "us_phone" }]), "5550101234");
  assert.equal(normalizeValue("1555010", [{ name: "us_phone" }]), "1555010");
});

test("empty_as_null makes an empty string and null the same absence", () => {
  assert.equal(normalizeValue("", [{ name: "empty_as_null" }]), null);
  assert.equal(normalizeValue(null, [{ name: "empty_as_null" }]), null);
  assert.equal(normalizeValue("x", [{ name: "empty_as_null" }]), "x");
});

test("picklist maps a code to its label and leaves an unmapped value as is", () => {
  const step = { name: "picklist", map: { US: "United States" } };
  assert.equal(normalizeValue("US", [step]), "United States");
  assert.equal(normalizeValue("United States", [step]), "United States");
  assert.equal(normalizeValue("Narnia", [step]), "Narnia");
});

test("null stays null through every normaliser", () => {
  for (const name of Object.keys(NORMALISERS)) {
    const step = name === "picklist" ? { name, map: {} } : { name };
    assert.equal(normalizeValue(null, [step]), null, name);
  }
});

test("undefined is read as null", () => {
  assert.equal(normalizeValue(undefined, [{ name: "trim" }]), null);
});

test("a number is compared as its text", () => {
  assert.equal(normalizeValue(42, [{ name: "trim" }]), "42");
});

test("steps apply in order, so trim then lower equals lower then trim here but picklist after trim sees the trimmed code", () => {
  const steps = [{ name: "trim" }, { name: "picklist", map: { GB: "United Kingdom" } }];
  assert.equal(normalizeValue(" GB ", steps), "United Kingdom");
});

test("normalizedEqual treats two nulls as equal and a null against a value as different", () => {
  assert.equal(normalizedEqual(null, null, []), true);
  assert.equal(normalizedEqual(null, "x", []), false);
});

test("validateStep accepts a bare name and returns a step object", () => {
  assert.deepEqual(validateStep("trim", "f"), { name: "trim" });
});

test("validateStep refuses an unknown normaliser with the known list in the message", () => {
  assert.throws(() => validateStep("shout", "contract.x"), (e) => e instanceof NormaliserError && /contract\.x: unknown normaliser "shout"; known: trim/.test(e.message));
});

test("validateStep refuses a picklist without a map, and a map whose values are not strings", () => {
  assert.throws(() => validateStep({ name: "picklist" }, "f"), NormaliserError);
  assert.throws(() => validateStep({ name: "picklist", map: { US: 1 } }, "f"), NormaliserError);
});

test("validateStep keeps the picklist map and nothing else", () => {
  assert.deepEqual(validateStep({ name: "picklist", map: { A: "a" }, extra: 1 }, "f"), { name: "picklist", map: { A: "a" } });
});
