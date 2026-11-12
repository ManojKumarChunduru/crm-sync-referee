/**
 * The Express mock on a loopback port, and csr pull against it. These are the only
 * tests that open a socket; every one binds 127.0.0.1 port 0.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { startServer, DEFAULT_CONFIG } from "../mock/server.js";
import { pull } from "../src/csr/pull.js";
import { createClient } from "../src/csr/http_client.js";
import { loadContract } from "../src/csr/contract.js";
import { loadExternal } from "../src/csr/external.js";
import { tempDir, EXT_DIR, CONTRACT_PATH } from "./helpers.js";

const contract = loadContract(CONTRACT_PATH);
let fixed;
let clock;
let ticking;

before(async () => {
  fixed = await startServer({ port: 0 });
  clock = { now: 1_000_000 };
  ticking = await startServer({
    port: 0, now: () => clock.now, config: { ...DEFAULT_CONFIG, token_lifetime_seconds: 10, rate_limit_every: 0 },
  });
});

after(async () => {
  await fixed.close();
  await ticking.close();
});

async function token(server, id = DEFAULT_CONFIG.client_id, secret = DEFAULT_CONFIG.client_secret) {
  const r = await fetch(`${server.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  return { status: r.status, body: await r.json() };
}

test("the mock listens on loopback only", () => {
  assert.equal(fixed.server.address().address, "127.0.0.1");
});

test("the token endpoint issues a bearer for the fixture client and refuses a wrong secret or grant", async () => {
  const ok = await token(fixed);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.token_type, "Bearer");
  assert.equal(ok.body.expires_in, DEFAULT_CONFIG.token_lifetime_seconds);
  assert.deepEqual((await token(fixed, "x", "y")).body, { error: "invalid_client" });
  const r = await fetch(`${fixed.baseUrl}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=password" });
  assert.equal(r.status, 400);
});

test("every API route needs a bearer, and a bad or missing one is a 401 with WWW-Authenticate", async () => {
  const r = await fetch(`${fixed.baseUrl}/api/v1/meta`);
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate"), /invalid_token/);
  const r2 = await fetch(`${fixed.baseUrl}/api/v1/meta`, { headers: { Authorization: "Bearer nope" } });
  assert.equal(r2.status, 401);
});

test("an expired token is a 401 that says so, driven by the injected clock and never by waiting", async () => {
  const { body } = await token(ticking);
  const live = await fetch(`${ticking.baseUrl}/api/v1/meta`, { headers: { Authorization: `Bearer ${body.access_token}` } });
  assert.equal(live.status, 200);
  clock.now += 10_000;
  const dead = await fetch(`${ticking.baseUrl}/api/v1/meta`, { headers: { Authorization: `Bearer ${body.access_token}` } });
  assert.equal(dead.status, 401);
  assert.equal((await dead.json()).expired, true);
});

test("pages are cursor-paginated, the limit is capped at the page size, and the last page has a null cursor", async () => {
  const { body } = await token(fixed);
  const h = { Authorization: `Bearer ${body.access_token}` };
  const first = await (await fetch(`${fixed.baseUrl}/api/v1/accounts?limit=10`, { headers: h })).json();
  assert.equal(first.items.length, 10);
  assert.ok(first.next_cursor);
  const second = await (await fetch(`${fixed.baseUrl}/api/v1/accounts?limit=10&cursor=${first.next_cursor}`, { headers: h })).json();
  assert.equal(second.items[0].id, "ERP-A-0011");
  const big = await (await fetch(`${fixed.baseUrl}/api/v1/accounts?limit=5000`, { headers: h })).json();
  assert.equal(big.items.length, DEFAULT_CONFIG.page_size);
  const bad = await fetch(`${fixed.baseUrl}/api/v1/accounts?cursor=%2F%2F`, { headers: h });
  assert.equal(bad.status, 400);
  const missing = await fetch(`${fixed.baseUrl}/api/v1/orders`, { headers: h });
  assert.equal(missing.status, 404);
  const nowhere = await fetch(`${fixed.baseUrl}/nowhere`);
  assert.equal(nowhere.status, 404);
});

test("every Nth API request is a 429 with Retry-After, so a client has to back off", async () => {
  const server = await startServer({ port: 0, config: { ...DEFAULT_CONFIG, rate_limit_every: 3 } });
  try {
    const { body } = await token(server);
    const h = { Authorization: `Bearer ${body.access_token}` };
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await fetch(`${server.baseUrl}/api/v1/meta`, { headers: h })).status);
    assert.deepEqual(statuses, [200, 200, 429, 200, 200, 429]);
    assert.equal(server.stats.rateLimited, 2);
  } finally {
    await server.close();
  }
});

test("csr pull reproduces the committed external directory byte for byte, through pagination and back-off", async () => {
  const server = await startServer({ port: 0, config: { ...DEFAULT_CONFIG, rate_limit_every: 7 } });
  try {
    const out = tempDir();
    const sleeps = [];
    const client = createClient({
      baseUrl: server.baseUrl, clientId: DEFAULT_CONFIG.client_id, clientSecret: DEFAULT_CONFIG.client_secret,
      sleep: async (s) => { sleeps.push(s); },
    });
    const result = await pull({ contract, outDir: out, limit: 20, client });
    assert.deepEqual(result.files, ["meta.json", "accounts.json", "contacts.json", "audit.json"]);
    for (const name of readdirSync(EXT_DIR)) {
      assert.equal(readFileSync(join(out, name), "utf8"), readFileSync(join(EXT_DIR, name), "utf8"), name);
    }
    assert.ok(result.stats.retries > 0, "the 429 cadence was hit");
    assert.equal(sleeps.length, result.stats.retries);
    assert.ok(result.stats.pages >= 30);
    const ext = loadExternal(out, contract);
    assert.equal(ext.records.accounts.size, 149);
  } finally {
    await server.close();
  }
});

test("csr pull refreshes its token when the mock expires it mid-pull", async () => {
  const out = tempDir();
  let calls = 0;
  const client = createClient({
    baseUrl: ticking.baseUrl, clientId: DEFAULT_CONFIG.client_id, clientSecret: DEFAULT_CONFIG.client_secret,
    fetch: (url, init) => { calls += 1; clock.now += 4_000; return fetch(url, init); },
  });
  const result = await pull({ contract, outDir: out, limit: 50, client });
  assert.ok(result.stats.refreshes >= 1, `refreshes ${result.stats.refreshes} over ${calls} calls`);
  assert.equal(readFileSync(join(out, "audit.json"), "utf8"), readFileSync(join(EXT_DIR, "audit.json"), "utf8"));
});

test("the mock's stats count tokens, requests and rejections", async () => {
  const server = await startServer({ port: 0 });
  try {
    await token(server);
    await fetch(`${server.baseUrl}/api/v1/meta`);
    assert.equal(server.stats.tokensIssued, 1);
    assert.equal(server.stats.requests, 1);
    assert.equal(server.stats.rejected401, 1);
  } finally {
    await server.close();
  }
});
