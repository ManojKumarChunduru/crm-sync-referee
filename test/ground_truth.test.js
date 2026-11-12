/**
 * The whole fixture report against the planted truth, and the fixture against itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadContract } from "../src/csr/contract.js";
import { loadSalesforce, writesFromEvents } from "../src/csr/salesforce.js";
import { loadExternal, writesFromAudit } from "../src/csr/external.js";
import { referee, exitCodeFor, VERDICT } from "../src/csr/referee.js";
import { renderJson } from "../src/csr/report.js";
import { indexWrites, writeKey, last } from "../src/csr/writes.js";
import { generate, formatJson, FIELDS } from "../fixture/generate.js";
import { FIXTURE, SF_DIR, EXT_DIR, CONTRACT_PATH } from "./helpers.js";

const contract = loadContract(CONTRACT_PATH);
const expected = JSON.parse(readFileSync(join(FIXTURE, "EXPECTED_VERDICTS.json"), "utf8"));
const salesforce = loadSalesforce(SF_DIR, contract);
const external = loadExternal(EXT_DIR, contract);
const result = referee({ contract, salesforce, external });
const key = (r) => `${r.object}|${r.key}|${r.field}`;

test("the referee's rows are exactly the planted rows: same set, same verdict, same cause, same stale side", () => {
  const got = new Map(result.rows.map((r) => [key(r), r]));
  assert.equal(got.size, expected.rows.length);
  for (const e of expected.rows) {
    const g = got.get(key(e));
    assert.ok(g, `missing ${key(e)}`);
    assert.deepEqual({ verdict: g.verdict, cause: g.cause, staleSide: g.staleSide }, { verdict: e.verdict, cause: e.cause, staleSide: e.staleSide }, `${e.scenario}: ${key(e)}`);
  }
});

test("the orphans are exactly the planted orphans", () => {
  assert.deepEqual(result.orphans.map((o) => `${o.object}|${o.side}|${o.id}`), expected.orphans.map((o) => `${o.object}|${o.side}|${o.id}`));
});

test("the fixture exits 2, because planted differences exist that no referee can attribute", () => {
  assert.equal(exitCodeFor(result), 2);
  assert.ok(result.counts.unattributable > 0);
  assert.ok(result.counts.attributed > 0);
});

test("the planted truth covers every verdict the referee can give", () => {
  const seen = new Set(expected.rows.map((r) => r.verdict));
  for (const v of Object.values(VERDICT)) assert.ok(seen.has(v), v);
});

test("regenerating the fixture reproduces every committed file byte for byte", () => {
  const out = generate();
  for (const [dir, files] of [["salesforce", out.salesforce], ["external", out.external]]) {
    for (const [name, value] of Object.entries(files)) {
      assert.equal(formatJson(value), readFileSync(join(FIXTURE, dir, name), "utf8"), `${dir}/${name}`);
    }
  }
  assert.equal(formatJson(out.expected), readFileSync(join(FIXTURE, "EXPECTED_VERDICTS.json"), "utf8"));
});

test("two reads of the fixture give byte-identical JSON reports", () => {
  const again = referee({
    contract, salesforce: loadSalesforce(SF_DIR, contract), external: loadExternal(EXT_DIR, contract),
  });
  assert.equal(renderJson(again), renderJson(result));
});

test("every snapshot value equals the last write to that field on its own side, so the history is consistent with both snapshots", () => {
  const sf = loadSalesforce(SF_DIR, contract);
  const ext = loadExternal(EXT_DIR, contract);
  const index = indexWrites([...writesFromEvents(sf, contract).writes, ...writesFromAudit(ext, contract).writes]);
  let checked = 0;
  for (const [k, entry] of index) {
    const [object, id, field] = k.split("|");
    const spec = contract.objects[object].fields[field];
    const sfLast = last(entry.salesforce);
    if (sfLast !== null && sf.records[object].has(id)) {
      assert.equal(sf.records[object].get(id)[field] ?? null, sfLast.value, `salesforce ${k}`);
      checked += 1;
    }
    const extLast = last(entry.external);
    if (extLast !== null) {
      const record = [...ext.records[contract.objects[object].externalEntity].values()].find((r) => r.sf_id === id);
      assert.equal(record[spec.externalField] ?? null, extLast.value, `external ${k}`);
      checked += 1;
    }
  }
  assert.ok(checked > 200, `checked ${checked}`);
  void writeKey;
});

test("the fixture field map and the contract agree field for field", () => {
  for (const [object, fields] of Object.entries(FIELDS)) {
    for (const [name, spec] of Object.entries(fields)) {
      const c = contract.objects[object].fields[name];
      assert.ok(c, `${object}.${name} in the contract`);
      assert.equal(c.externalField, spec.ext);
      assert.equal(c.owner, spec.owner);
    }
  }
});

test("the fixture is the size the README says: 148 and 249 Salesforce records, 149 and 249 external records, 112 change events, 169 audit entries", () => {
  assert.equal(result.compared.records, 395);
  assert.equal(JSON.parse(readFileSync(join(SF_DIR, "Account.json"), "utf8")).records.length, 148);
  assert.equal(JSON.parse(readFileSync(join(SF_DIR, "Contact.json"), "utf8")).records.length, 249);
  assert.equal(JSON.parse(readFileSync(join(EXT_DIR, "accounts.json"), "utf8")).items.length, 149);
  assert.equal(JSON.parse(readFileSync(join(EXT_DIR, "contacts.json"), "utf8")).items.length, 249);
  const events = readdirSync(join(SF_DIR, "events")).reduce((n, f) => n + JSON.parse(readFileSync(join(SF_DIR, "events", f), "utf8")).length, 0);
  assert.equal(events, 112);
  assert.equal(JSON.parse(readFileSync(join(EXT_DIR, "audit.json"), "utf8")).items.length, 169);
});

test("no fixture file is larger than a quarter of a megabyte, so the repository stays clonable in seconds", () => {
  for (const dir of [SF_DIR, join(SF_DIR, "events"), EXT_DIR]) {
    for (const f of readdirSync(dir)) {
      const path = join(dir, f);
      if (statSync(path).isFile()) assert.ok(statSync(path).size < 262_144, `${path} is ${statSync(path).size} bytes`);
    }
  }
});
