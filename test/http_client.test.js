/**
 * The REST client against a scripted fetch: no socket, no clock, no timer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, HttpClientError } from "../src/csr/http_client.js";

function response(status, body, headers = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (k) => map.get(k.toLowerCase()) ?? null }, json: async () => body };
}

/** A fetch that answers from a queue per URL path and records every call. */
function scripted(script) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ path, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const key = Object.keys(script).find((k) => path.startsWith(k));
    const queue = script[key];
    if (!queue || queue.length === 0) throw new Error(`no scripted response for ${path}`);
    const next = queue.shift();
    return typeof next === "function" ? next(init) : next;
  };
  return { fetch, calls };
}

const TOKEN = response(200, { access_token: "tok-1", token_type: "Bearer", expires_in: 300 });
const TOKEN2 = response(200, { access_token: "tok-2", token_type: "Bearer", expires_in: 300 });

function client(script, extra = {}) {
  const s = scripted(script);
  const slept = [];
  const c = createClient({ baseUrl: "http://mock.test/", clientId: "id", clientSecret: "secret", fetch: s.fetch, sleep: async (n) => { slept.push(n); }, now: () => 1000, ...extra });
  return { c, calls: s.calls, slept };
}

test("the client needs a base url, a client id and a secret", () => {
  assert.throws(() => createClient({ baseUrl: "x", clientId: "y" }), (e) => e instanceof HttpClientError && /needs clientSecret/.test(e.message));
});

test("the first call fetches a token with HTTP Basic client authentication and the client_credentials grant, then sends it as a bearer", async () => {
  const { c, calls } = client({ "/oauth/token": [TOKEN], "/api/v1/meta": [response(200, { ok: 1 })] });
  const body = await c.getJson("/api/v1/meta");
  assert.deepEqual(body, { ok: 1 });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from("id:secret").toString("base64")}`);
  assert.equal(calls[0].body, "grant_type=client_credentials");
  assert.equal(calls[1].headers.Authorization, "Bearer tok-1");
  assert.equal(c.token.value, "tok-1");
  assert.equal(c.token.obtainedAt, 1000);
});

test("the token is reused across calls, so two gets cost one token request", async () => {
  const { c } = client({ "/oauth/token": [TOKEN], "/api/v1/meta": [response(200, {}), response(200, {})] });
  await c.getJson("/api/v1/meta");
  await c.getJson("/api/v1/meta");
  assert.equal(c.stats.tokenRequests, 1);
  assert.equal(c.stats.requests, 2);
});

test("a 401 refreshes the token exactly once and retries; a second 401 is an error", async () => {
  const { c, calls } = client({ "/oauth/token": [TOKEN, TOKEN2], "/api/v1/meta": [response(401, { error: "invalid_token" }), response(200, { ok: 2 })] });
  assert.deepEqual(await c.getJson("/api/v1/meta"), { ok: 2 });
  assert.equal(c.stats.refreshes, 1);
  assert.equal(calls.at(-1).headers.Authorization, "Bearer tok-2");
  const twice = client({ "/oauth/token": [TOKEN, TOKEN2], "/api/v1/meta": [response(401, {}), response(401, { error: "still" })] });
  await assert.rejects(twice.c.getJson("/api/v1/meta"), (e) => e.status === 401 && /answered 401 after 0 retries/.test(e.message));
});

test("a 429 is retried after the Retry-After seconds, with the sleep injected and counted", async () => {
  const { c, slept } = client({ "/oauth/token": [TOKEN], "/api/v1/meta": [response(429, {}, { "Retry-After": "3" }), response(200, { ok: 3 })] });
  assert.deepEqual(await c.getJson("/api/v1/meta"), { ok: 3 });
  assert.deepEqual(slept, [3]);
  assert.equal(c.stats.retries, 1);
  assert.equal(c.stats.slept, 3);
});

test("a 429 without a usable Retry-After waits the default second", async () => {
  const { c, slept } = client({ "/oauth/token": [TOKEN], "/api/v1/meta": [response(429, {}, { "Retry-After": "soon" }), response(200, {})] });
  await c.getJson("/api/v1/meta");
  assert.deepEqual(slept, [1]);
});

test("after the retry cap a 429 is an error that says how many retries were made", async () => {
  const many = Array.from({ length: 3 }, () => response(429, { error: "rate_limited" }, { "Retry-After": "0" }));
  const { c } = client({ "/oauth/token": [TOKEN], "/api/v1/meta": many }, { maxRetries: 2 });
  await assert.rejects(c.getJson("/api/v1/meta"), (e) => e.status === 429 && /after 2 retries/.test(e.message));
});

test("a token response that is not a 200, has no access_token, or is not a Bearer is refused", async () => {
  for (const bad of [response(401, { error: "invalid_client" }), response(200, { token_type: "Bearer" }), response(200, { access_token: "t", token_type: "MAC" })]) {
    const { c } = client({ "/oauth/token": [bad] });
    await assert.rejects(c.getJson("/api/v1/meta"), HttpClientError);
  }
});

test("a non-JSON body on an error is reported as null rather than crashing", async () => {
  const broken = { status: 500, headers: { get: () => null }, json: async () => { throw new Error("not json"); } };
  const { c } = client({ "/oauth/token": [TOKEN], "/api/v1/meta": [broken] });
  await assert.rejects(c.getJson("/api/v1/meta"), /answered 500 after 0 retries: null/);
});

test("getAll follows next_cursor until null and passes the cursor and limit as query parameters", async () => {
  const { c, calls } = client({
    "/oauth/token": [TOKEN],
    "/api/v1/accounts": [response(200, { items: [1, 2], next_cursor: "c2" }), response(200, { items: [3], next_cursor: null })],
  });
  assert.deepEqual(await c.getAll("/api/v1/accounts", { limit: 2 }), [1, 2, 3]);
  assert.equal(calls[1].path, "/api/v1/accounts?limit=2");
  assert.equal(calls[2].path, "/api/v1/accounts?cursor=c2&limit=2");
  assert.equal(c.stats.pages, 2);
});

test("getAll refuses a page without items and a cursor that repeats", async () => {
  const { c } = client({ "/oauth/token": [TOKEN], "/api/v1/x": [response(200, { rows: [] })] });
  await assert.rejects(c.getAll("/api/v1/x"), /page has no items array/);
  const loop = client({ "/oauth/token": [TOKEN], "/api/v1/y": [response(200, { items: [], next_cursor: "a" }), response(200, { items: [], next_cursor: "a" })] });
  await assert.rejects(loop.c.getAll("/api/v1/y"), /next_cursor a repeats/);
});

test("a fetch that cannot connect becomes a client error naming the socket code, from a plain cause or an aggregate", async () => {
  const refused = () => { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; };
  const { c } = client({ "/oauth/token": [refused] });
  await assert.rejects(c.getJson("/api/v1/meta"), (e) => e instanceof HttpClientError && /oauth\/token: ECONNREFUSED/.test(e.message));
  const aggregate = () => { const e = new TypeError("fetch failed"); e.cause = { errors: [{ code: "ENETUNREACH" }] }; throw e; };
  await assert.rejects(client({ "/oauth/token": [aggregate] }).c.getJson("/api/v1/meta"), /ENETUNREACH/);
  const bare = () => { throw new TypeError("fetch failed"); };
  await assert.rejects(client({ "/oauth/token": [bare] }).c.getJson("/api/v1/meta"), /oauth\/token: fetch failed/);
});

test("a trailing slash on the base url does not produce a double slash", async () => {
  const { c, calls } = client({ "/oauth/token": [TOKEN], "/api/v1/meta": [response(200, {})] });
  await c.getJson("/api/v1/meta");
  assert.equal(calls[0].path, "/oauth/token");
});
