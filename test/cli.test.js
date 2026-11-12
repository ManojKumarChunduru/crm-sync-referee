import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { run } from "../src/csr/cli.js";
import { startServer, DEFAULT_CONFIG } from "../mock/server.js";
import { capture, tempDir, SF_DIR, EXT_DIR, CONTRACT_PATH, ROOT } from "./helpers.js";

const BASE = ["--salesforce", SF_DIR, "--external", EXT_DIR, "--contract", CONTRACT_PATH];

async function cli(...argv) {
  const c = capture();
  const code = await run(argv, c.stdout, c.stderr);
  return { code, ...c.out };
}

test("no arguments prints usage and exits 3; --help prints usage and exits 0", async () => {
  const none = await cli();
  assert.equal(none.code, 3);
  assert.match(none.stdout, /^csr: crm-sync-referee/);
  const help = await cli("--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /exit codes:/);
});

test("an unknown command or an unknown option exits 3 with the message and usage on stderr", async () => {
  assert.equal((await cli("diff")).code, 3);
  assert.match((await cli("diff")).stderr, /unknown command diff/);
  const opt = await cli("referee", "--bogus");
  assert.equal(opt.code, 3);
  assert.match(opt.stderr, /Unknown option/);
});

test("referee on the fixture exits 2 and prints the headline, the table and the exit sentence", async () => {
  const r = await cli("referee", ...BASE);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /103 raw differences on 395 joined records; 18 normalise away; 85 real diffs/);
  assert.match(r.stdout, /exit 2: at least one difference has no nameable side/);
  assert.equal(r.stderr, "");
});

test("referee writes the JSON, markdown and HTML files it is asked for", async () => {
  const dir = tempDir();
  const r = await cli("referee", ...BASE, "--json", join(dir, "r.json"), "--markdown", join(dir, "r.md"), "--html", join(dir, "r.html"));
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(readFileSync(join(dir, "r.json"), "utf8")).exitCode, 2);
  assert.match(readFileSync(join(dir, "r.md"), "utf8"), /^## crm-sync-referee/);
  assert.match(readFileSync(join(dir, "r.html"), "utf8"), /<!doctype html>/);
});

test("referee requires the three inputs and names the missing one", async () => {
  const r = await cli("referee", "--salesforce", SF_DIR);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /--external is required/);
});

test("--window and --skew change the run; a bad value exits 3", async () => {
  const wide = await cli("referee", ...BASE, "--window", "720h");
  assert.match(wide.stdout, /window 720 h/);
  assert.match(wide.stdout, /9 no referee can attribute/);
  const tight = await cli("referee", ...BASE, "--skew", "0s");
  assert.match(tight.stdout, /within clock skew 0,/);
  assert.match((await cli("referee", ...BASE, "--window", "0h")).stderr, /--window must be a positive duration/);
  assert.match((await cli("referee", ...BASE, "--window", "soon")).stderr, /--window must be a positive duration/);
  assert.match((await cli("referee", ...BASE, "--skew", "fast")).stderr, /--skew must be a duration/);
});

test("--as-of moves the window and refuses a non-instant", async () => {
  const r = await cli("referee", ...BASE, "--as-of", "2026-11-08T00:00:00Z");
  assert.match(r.stdout, /as of 2026-11-08T00:00:00.000Z/);
  assert.match((await cli("referee", ...BASE, "--as-of", "tomorrow")).stderr, /--as-of must be an ISO instant/);
});

test("--object restricts the run and refuses an object outside the contract", async () => {
  const r = await cli("referee", ...BASE, "--object", "Account");
  assert.match(r.stdout, /on 147 joined records/);
  const bad = await cli("referee", ...BASE, "--object", "Lead");
  assert.equal(bad.code, 3);
  assert.match(bad.stderr, /--object Lead is not in the contract \(Account, Contact\)/);
});

test("an unreadable contract, snapshot or external directory exits 3 with the reader's message", async () => {
  assert.match((await cli("referee", "--salesforce", SF_DIR, "--external", EXT_DIR, "--contract", "/nope.json")).stderr, /cannot read contract/);
  assert.match((await cli("referee", "--salesforce", "/nope", "--external", EXT_DIR, "--contract", CONTRACT_PATH)).stderr, /snapshot\.json missing/);
  assert.match((await cli("referee", "--salesforce", SF_DIR, "--external", "/nope", "--contract", CONTRACT_PATH)).stderr, /meta\.json missing/);
});

test("explain prints one field's story and exits with that row's code", async () => {
  const expected = JSON.parse(readFileSync(join(ROOT, "fixture", "EXPECTED_VERDICTS.json"), "utf8"));
  const echo = expected.rows.find((r) => r.cause === "echo_of_stale_value");
  const r = await cli("explain", `${echo.object}.${echo.field}`, echo.key, ...BASE);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /cause echo of a stale value/);
  const closed = expected.rows.find((r) => r.verdict === "window_closed");
  assert.equal((await cli("explain", `${closed.object}.${closed.field}`, closed.key, ...BASE)).code, 2);
  const clean = await cli("explain", "Account.Name", "001Kd0000000001AAA", ...BASE);
  assert.equal(clean.code, 0);
  assert.match(clean.stdout, /no difference/);
});

test("explain refuses a malformed target and a field outside the contract", async () => {
  assert.match((await cli("explain", "Account", ...BASE)).stderr, /explain needs <Object>\.<Field> <recordId>/);
  assert.match((await cli("explain", "Account.Fax", "001", ...BASE)).stderr, /Account\.Fax is not in the contract/);
});

test("contract prints the policy with reasons and refuses a missing file", async () => {
  const r = await cli("contract", "--contract", CONTRACT_PATH);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Salesforce to ERP account and contact sync/);
  assert.match(r.stdout, /ERP_Status__c\s+external/);
  assert.equal((await cli("contract")).code, 3);
  assert.equal((await cli("contract", "--contract", "/nope.json")).code, 3);
});

let server;
before(async () => { server = await startServer({ port: 0, config: { ...DEFAULT_CONFIG, rate_limit_every: 9 } }); });
after(async () => { await server.close(); });

test("pull fetches the external directory over HTTP and reports its request counts", async () => {
  const out = tempDir();
  const r = await cli("pull", "--from", server.baseUrl, "--client-id", DEFAULT_CONFIG.client_id, "--client-secret", DEFAULT_CONFIG.client_secret, "--contract", CONTRACT_PATH, "--out", out, "--limit", "25");
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /pulled meta\.json, accounts\.json, contacts\.json, audit\.json into .*: \d+ requests, \d+ pages, 1 token requests, 0 refreshes after 401, \d+ retries after 429/);
  assert.equal(readFileSync(join(out, "contacts.json"), "utf8"), readFileSync(join(EXT_DIR, "contacts.json"), "utf8"));
});

test("pull with a wrong secret exits 3 with the token endpoint's answer, and a missing option names itself", async () => {
  const r = await cli("pull", "--from", server.baseUrl, "--client-id", "x", "--client-secret", "y", "--contract", CONTRACT_PATH, "--out", tempDir());
  assert.equal(r.code, 3);
  assert.match(r.stderr, /token endpoint answered 401/);
  assert.match((await cli("pull", "--from", server.baseUrl)).stderr, /--client-id is required for pull/);
  assert.match((await cli("pull", "--from", server.baseUrl, "--client-id", "a", "--client-secret", "b", "--contract", CONTRACT_PATH, "--out", "x", "--limit", "0")).stderr, /--limit must be a positive whole number/);
});

test("pull against a port nobody listens on exits 3 with the socket error rather than a stack trace", async () => {
  const gone = await startServer({ port: 0 });
  const port = gone.port;
  await gone.close();
  const r = await cli("pull", "--from", `http://127.0.0.1:${port}`, "--client-id", "a", "--client-secret", "b", "--contract", CONTRACT_PATH, "--out", tempDir());
  assert.equal(r.code, 3);
  assert.match(r.stderr, /ECONNREFUSED/);
});

test("the bin entry point runs the fixture and exits 2 from a child process", () => {
  let code = 0;
  let stdout;
  try {
    stdout = execFileSync("node", [join(ROOT, "bin", "csr"), "referee", ...BASE], { encoding: "utf8" });
  } catch (error) {
    code = error.status;
    stdout = error.stdout;
  }
  assert.equal(code, 2);
  assert.match(stdout, /exit 2/);
  assert.ok(existsSync(join(ROOT, "bin", "csr")));
});
