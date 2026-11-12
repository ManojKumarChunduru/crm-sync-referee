import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { validateContract, loadContract, ContractError, objectForEntity, fieldForExternal, contractFields, OWNERS } from "../src/csr/contract.js";
import { rawContract, tempDir, CONTRACT_PATH } from "./helpers.js";

test("a valid contract validates and is frozen", () => {
  const c = validateContract(rawContract());
  assert.equal(c.name, "test contract");
  assert.equal(Object.isFrozen(c), true);
  assert.equal(Object.isFrozen(c.objects.Account.fields.Name), true);
});

test("the committed contract loads and names 14 fields over two objects", () => {
  const c = loadContract(CONTRACT_PATH);
  assert.deepEqual(Object.keys(c.objects), ["Account", "Contact"]);
  assert.equal(contractFields(c).length, 14);
  assert.equal(contractFields(c).filter((f) => f.spec.owner === "undeclared").length, 2);
});

test("the four owners are the only owners", () => {
  assert.deepEqual(OWNERS, ["salesforce", "external", "shared", "undeclared"]);
});

test("a misspelt owner is refused, never read as shared", () => {
  const raw = rawContract();
  raw.objects.Account.fields.Name.owner = "salesforce ";
  assert.throws(() => validateContract(raw), (e) => e instanceof ContractError && /fields\.Name\.owner/.test(e.message));
});

test("a field without a reason is refused", () => {
  const raw = rawContract();
  delete raw.objects.Account.fields.Name.reason;
  assert.throws(() => validateContract(raw), /fields\.Name\.reason/);
});

test("an unknown normaliser is refused as a contract error naming the field", () => {
  const raw = rawContract();
  raw.objects.Account.fields.Name.normalize = ["shout"];
  assert.throws(() => validateContract(raw), (e) => e instanceof ContractError && /Name\.normalize\[0\]/.test(e.message));
});

test("normalize must be an array", () => {
  const raw = rawContract();
  raw.objects.Account.fields.Name.normalize = "trim";
  assert.throws(() => validateContract(raw), /normalize: expected an array/);
});

test("two fields mapped to the same external field are refused", () => {
  const raw = rawContract();
  raw.objects.Account.fields.Phone.external_field = "name";
  assert.throws(() => validateContract(raw), /external_field: name is already mapped to Name/);
});

test("two objects mapped to the same external entity are refused", () => {
  const raw = rawContract();
  raw.objects.Contact = { ...raw.objects.Account };
  assert.throws(() => validateContract(raw), /external_entity: accounts is already the entity of Account/);
});

test("the integration identities are required on both sides", () => {
  for (const [path, key] of [["salesforce", "integration_user"], ["salesforce", "change_origin_client"], ["external", "sync_actor"]]) {
    const raw = rawContract();
    delete raw.systems[path][key];
    assert.throws(() => validateContract(raw), new RegExp(`systems\\.${path}\\.${key}`));
  }
});

test("the skew tolerance may be zero but not negative, and the retention must be at least an hour", () => {
  assert.equal(validateContract(rawContract({ clock_skew_tolerance_seconds: 0 })).skewSeconds, 0);
  assert.throws(() => validateContract(rawContract({ clock_skew_tolerance_seconds: -1 })), /clock_skew_tolerance_seconds/);
  assert.throws(() => validateContract(rawContract({ retention_hours: 0 })), /retention_hours/);
  assert.throws(() => validateContract(rawContract({ retention_hours: "72" })), /retention_hours/);
});

test("an object with no fields, and a contract with no objects, are refused", () => {
  const raw = rawContract();
  raw.objects.Account.fields = {};
  assert.throws(() => validateContract(raw), /at least one field/);
  assert.throws(() => validateContract(rawContract({ objects: {} })), /at least one object/);
});

test("non-object inputs are refused at every level", () => {
  assert.throws(() => validateContract(null), /contract: expected an object/);
  assert.throws(() => validateContract(rawContract({ systems: [] })), /contract\.systems: expected an object/);
  const raw = rawContract();
  raw.objects.Account.key = "Id";
  assert.throws(() => validateContract(raw), /key: expected an object/);
});

test("loadContract refuses a missing file and a file that is not JSON, naming the path", () => {
  assert.throws(() => loadContract("/nonexistent/contract.json"), (e) => e instanceof ContractError && /cannot read contract/.test(e.message));
  const dir = tempDir({ "c.json": "{ not json" });
  assert.throws(() => loadContract(join(dir, "c.json")), /is not JSON/);
});

test("objectForEntity and fieldForExternal find the mapping or return undefined", () => {
  const c = validateContract(rawContract());
  assert.equal(objectForEntity(c, "accounts").name, "Account");
  assert.equal(objectForEntity(c, "orders"), undefined);
  assert.equal(fieldForExternal(c.objects.Account, "phone").name, "Phone");
  assert.equal(fieldForExternal(c.objects.Account, "fax"), undefined);
});

test("a normaliser step given as an object with a map is kept with its map", () => {
  const raw = rawContract();
  raw.objects.Account.fields.Name.normalize = [{ name: "picklist", map: { A: "Alpha" } }];
  const c = validateContract(raw);
  assert.deepEqual(c.objects.Account.fields.Name.normalize, [{ name: "picklist", map: { A: "Alpha" } }]);
});
