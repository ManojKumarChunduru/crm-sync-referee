/**
 * The mock external system: an Express app that serves the committed external
 * fixture behind an OAuth 2.0 client-credentials token endpoint, with cursor
 * pagination and a 429 every Nth request so a client has to back off.
 *
 * Why this file exists: the referee's REST client needs something to talk to,
 * and the honest scope of a mock is to prove the client, not the data. The app
 * serves the same files the fixture directory holds, so `csr pull` against it
 * must reproduce that directory byte for byte (a test asserts it). Express is a
 * dev dependency; nothing on the referee's path imports this file (ADR-004).
 *
 * Run: node mock/server.js [--port 8089] [--fixture fixture/external]
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
export const DEFAULT_FIXTURE = join(HERE, "..", "fixture", "external");

function loadFixture(dir) {
  const read = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  const meta = read("meta.json");
  const entities = {};
  for (const name of meta.entities ?? ["accounts", "contacts"]) entities[name] = read(`${name}.json`).items;
  entities.audit = read("audit.json").items;
  return { meta, entities };
}

function encodeCursor(offset) {
  return Buffer.from(String(offset)).toString("base64url");
}

function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  const n = Number(Buffer.from(String(cursor), "base64url").toString("utf8"));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Build the app. `now` is injectable so token expiry can be driven in a test
 * without waiting; `express` is imported lazily so the referee never pays for it.
 */
export async function createApp(options = {}) {
  const { fixtureDir = DEFAULT_FIXTURE, config = DEFAULT_CONFIG, now = () => Date.now() } = options;
  let express;
  try {
    express = (await import("express")).default;
  } catch {
    throw new Error("the mock needs Express: run `npm install` (it is a dev dependency; the referee itself has none)");
  }
  const fixture = loadFixture(fixtureDir);
  const tokens = new Map();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  const stats = { requests: 0, tokensIssued: 0, rejected401: 0, rateLimited: 0 };

  app.post("/oauth/token", (req, res) => {
    const header = req.get("authorization") ?? "";
    const m = /^Basic (.+)$/.exec(header);
    const [id, secret] = m === null ? [null, null] : Buffer.from(m[1], "base64").toString("utf8").split(":", 2);
    if (req.body.grant_type !== "client_credentials") {
      return res.status(400).json({ error: "unsupported_grant_type", error_description: "only client_credentials is supported" });
    }
    if (id !== config.client_id || secret !== config.client_secret) {
      return res.status(401).json({ error: "invalid_client" });
    }
    const value = randomBytes(24).toString("hex");
    tokens.set(value, { issuedAt: now() });
    stats.tokensIssued += 1;
    return res.json({ access_token: value, token_type: "Bearer", expires_in: config.token_lifetime_seconds });
  });

  app.use("/api/v1", (req, res, next) => {
    stats.requests += 1;
    const m = /^Bearer (.+)$/.exec(req.get("authorization") ?? "");
    const token = m === null ? undefined : tokens.get(m[1]);
    const expired = token !== undefined && now() - token.issuedAt >= config.token_lifetime_seconds * 1000;
    if (token === undefined || expired) {
      stats.rejected401 += 1;
      res.set("WWW-Authenticate", `Bearer error="invalid_token"${expired ? ', error_description="expired"' : ""}`);
      return res.status(401).json({ error: "invalid_token", expired });
    }
    if (config.rate_limit_every > 0 && stats.requests % config.rate_limit_every === 0) {
      stats.rateLimited += 1;
      res.set("Retry-After", String(config.retry_after_seconds));
      return res.status(429).json({ error: "rate_limited", retry_after: config.retry_after_seconds });
    }
    return next();
  });

  app.get("/api/v1/meta", (_req, res) => res.json(fixture.meta));

  app.get("/api/v1/:entity", (req, res) => {
    const items = fixture.entities[req.params.entity];
    if (items === undefined) return res.status(404).json({ error: "not_found", entity: req.params.entity });
    const offset = decodeCursor(req.query.cursor);
    if (offset === null) return res.status(400).json({ error: "bad_cursor" });
    const requested = Number(req.query.limit);
    const wanted = Number.isInteger(requested) && requested > 0 ? requested : config.page_size;
    const limit = Math.min(wanted, config.page_size);
    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    return res.json({ items: page, next_cursor: nextOffset < items.length ? encodeCursor(nextOffset) : null });
  });

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  return { app, stats, fixture };
}

/** Listen on 127.0.0.1; port 0 picks a free one. Returns {server, port, baseUrl, close, stats}. */
export async function startServer({ port = 0, ...rest } = {}) {
  const { app, stats } = await createApp(rest);
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });
  const actualPort = server.address().port;
  return {
    server,
    port: actualPort,
    baseUrl: `http://127.0.0.1:${actualPort}`,
    stats,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "8089" }, fixture: { type: "string" } } });
  const started = await startServer({ port: Number(values.port), fixtureDir: values.fixture ?? DEFAULT_FIXTURE });
  console.log(`mock external system listening on ${started.baseUrl} (client id ${DEFAULT_CONFIG.client_id}; Ctrl-C to stop)`);
}
