/**
 * Tests that pin findings from the build, each with the story and the number that revealed it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeValue } from "../src/csr/normalize.js";
import { decideField, VERDICT, CAUSE } from "../src/csr/referee.js";
import { createClient, HttpClientError } from "../src/csr/http_client.js";
import { contract, w, AS_OF, H } from "./helpers.js";

test("a phone typed with +1 on one side is not a difference: the first contract kept the country code and the referee reported four sync lags", () => {
  // The first fixture run came back with 14 rows normalising away where 18 were planted. The
  // four missing ones were "+1 555 010 1006" against "555-010-1006": the contract's `digits`
  // normaliser kept the leading 1, so the referee saw 15550101006 against 5550101006 and, finding
  // a Salesforce originating write in the window, reported external stale through sync lag.
  // The referee was right about the data it was given; the contract was wrong about what a
  // phone number is. us_phone exists for that, and this test keeps the four rows honest.
  assert.equal(normalizeValue("+1 555 010 1006", [{ name: "digits" }]), "15550101006");
  assert.equal(normalizeValue("+1 555 010 1006", [{ name: "us_phone" }]), "5550101006");
  const c = contract();
  const row = decideField({
    object: "Account", key: "001", spec: c.objects.Account.fields.Phone,
    sfValue: "+1 555 010 1006", extValue: "555-010-1006",
    sfWrites: [w("salesforce", { at: AS_OF - 10 * H, value: "+1 555 010 1006" })], extWrites: [],
    windowFrom: AS_OF - 72 * H, asOf: AS_OF, skewMs: 5000, gapRecord: null,
  });
  assert.equal(row.verdict, VERDICT.NOT_A_DIFF);
  assert.notEqual(row.cause, CAUSE.SYNC_LAG);
});

test("a connection the mock refuses is reported with its socket code, not as 'fetch failed'", async () => {
  // The first version of csr pull printed "fetch failed" for a port nobody listened on, because
  // undici puts the code on error.cause, sometimes on cause.errors[0], and for a port the fetch
  // specification forbids (port 1, the first thing the test tried) on cause.message only. The
  // client now wraps every fetch and names whichever it finds, so an operator reads ECONNREFUSED
  // or "bad port" instead of a stack trace through the token endpoint.
  const refuse = async () => { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; };
  const client = createClient({ baseUrl: "http://127.0.0.1:9", clientId: "a", clientSecret: "b", fetch: refuse });
  await assert.rejects(client.getJson("/api/v1/meta"), (e) => e instanceof HttpClientError && e.message.endsWith("/oauth/token: ECONNREFUSED"));
  const badPort = async () => { const e = new TypeError("fetch failed"); e.cause = new Error("bad port"); throw e; };
  const client2 = createClient({ baseUrl: "http://127.0.0.1:1", clientId: "a", clientSecret: "b", fetch: badPort });
  await assert.rejects(client2.getJson("/api/v1/meta"), /oauth\/token: bad port/);
});
