/**
 * Experiment 5: the pull over HTTP.
 * Starts the Express mock in this process on a loopback port, pulls the external side with a
 * small page size so pagination, the 429 cadence and a token expiry all happen, and checks the
 * pulled directory against the committed one byte for byte. Counts requests, pages, retries and
 * refreshes; no duration is recorded.
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeJson, printTable, FIXTURE, loadAll } from "./lib.js";
import { startServer, DEFAULT_CONFIG } from "../mock/server.js";
import { createClient } from "../src/csr/http_client.js";
import { pull } from "../src/csr/pull.js";

const { contract } = loadAll();
const clock = { now: 1_700_000_000_000 };
const config = { ...DEFAULT_CONFIG, token_lifetime_seconds: 120, rate_limit_every: 9 };
const server = await startServer({ port: 0, now: () => clock.now, config });
try {
  const out = mkdtempSync(join(tmpdir(), "csr-pull-"));
  const client = createClient({
    baseUrl: server.baseUrl, clientId: config.client_id, clientSecret: config.client_secret,
    sleep: async () => {},
    // Each request moves the mock's clock 10 seconds, so the 120-second token expires during the pull.
    fetch: (url, init) => { clock.now += 10_000; return fetch(url, init); },
  });
  const result = await pull({ contract, outDir: out, limit: 20, client });
  const identical = readdirSync(join(FIXTURE, "external")).map((name) => ({
    name, identical: readFileSync(join(out, name), "utf8") === readFileSync(join(FIXTURE, "external", name), "utf8"),
  }));
  const data = {
    baseUrl: "http://127.0.0.1:<port 0>",
    pageSize: 20,
    tokenLifetimeSeconds: config.token_lifetime_seconds,
    rateLimitEvery: config.rate_limit_every,
    requests: result.stats.requests,
    pages: result.stats.pages,
    tokenRequests: result.stats.tokenRequests,
    refreshes: result.stats.refreshes,
    retries: result.stats.retries,
    files: identical,
    allIdentical: identical.every((f) => f.identical),
    mock: { ...server.stats },
    note: "Requests, pages, refreshes and retries are counts and reproduce exactly; wall time is not recorded.",
  };
  if (!data.allIdentical) throw new Error("pulled files differ from the fixture");
  writeJson("exp05_pull_over_http.json", data);
  console.log(`exp05 pull over HTTP: ${data.requests} requests, ${data.pages} pages pulled at ${data.pageSize} per page, ${data.tokenRequests} token requests (${data.refreshes} refreshes after 401), ${data.retries} retries after 429; ${identical.length} files byte-identical to the fixture`);
  printTable(["File", "Identical"], identical.map((f) => [f.name, f.identical]));
} finally {
  await server.close();
}
