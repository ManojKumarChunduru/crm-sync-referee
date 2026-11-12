/**
 * The REST client `csr pull` uses: OAuth 2.0 client credentials, a bearer
 * header on every call, one token refresh on 401, cursor pagination, and
 * Retry-After honoured on 429 up to a cap.
 *
 * Why this file exists: the resume names REST and OAuth 2.0; this is the
 * hundred lines that show it, written over Node's global fetch rather than an
 * HTTP library (ADR-004). The clock and the sleep are injected so the tests
 * exercise expiry and back-off without waiting for either, and so no published
 * figure depends on wall time.
 */

export class HttpClientError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const DEFAULTS = {
  tokenPath: "/oauth/token",
  maxRetries: 5,
  /** Seconds to wait when a 429 carries no usable Retry-After. */
  defaultRetryAfter: 1,
};

/**
 * @param {object} o
 * @param {string} o.baseUrl e.g. http://127.0.0.1:8089
 * @param {string} o.clientId
 * @param {string} o.clientSecret
 * @param {Function} [o.fetch] defaults to globalThis.fetch
 * @param {Function} [o.sleep] async (seconds) => void; defaults to a real timer
 * @param {Function} [o.now] () => milliseconds; defaults to Date.now
 */
export function createClient(o) {
  for (const k of ["baseUrl", "clientId", "clientSecret"]) {
    if (typeof o[k] !== "string" || o[k] === "") throw new HttpClientError(`http client needs ${k}`);
  }
  const base = o.baseUrl.replace(/\/+$/, "");
  const fetchImpl = o.fetch ?? globalThis.fetch;
  const sleep = o.sleep ?? ((seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)));
  const now = o.now ?? (() => Date.now());
  const cfg = { ...DEFAULTS, ...o };
  const stats = { requests: 0, tokenRequests: 0, refreshes: 0, retries: 0, pages: 0, slept: 0 };
  let token = null;

  async function fetchToken() {
    stats.tokenRequests += 1;
    const basic = Buffer.from(`${o.clientId}:${o.clientSecret}`).toString("base64");
    const response = await fetchImpl(`${base}${cfg.tokenPath}`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials",
    });
    const body = await response.json().catch(() => null);
    if (response.status !== 200 || body === null || typeof body.access_token !== "string") {
      throw new HttpClientError(`token endpoint answered ${response.status}: ${JSON.stringify(body)}`, { status: response.status, body });
    }
    if (body.token_type !== "Bearer") throw new HttpClientError(`token_type ${body.token_type} is not Bearer`);
    token = { value: body.access_token, obtainedAt: now(), expiresIn: body.expires_in ?? null };
    return token;
  }

  async function ensureToken() {
    if (token === null) return fetchToken();
    return token;
  }

  function retryAfterSeconds(response) {
    const header = response.headers.get("retry-after");
    const n = header === null ? NaN : Number(header);
    return Number.isFinite(n) && n >= 0 ? n : cfg.defaultRetryAfter;
  }

  /** GET a JSON resource. Refreshes the token once on 401 and retries 429 with Retry-After. */
  async function getJson(path, { params = {} } = {}) {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    let refreshed = false;
    let retries = 0;
    for (;;) {
      const t = await ensureToken();
      stats.requests += 1;
      const response = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${t.value}`, Accept: "application/json" } });
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        stats.refreshes += 1;
        token = null;
        continue;
      }
      if (response.status === 429 && retries < cfg.maxRetries) {
        retries += 1;
        stats.retries += 1;
        const seconds = retryAfterSeconds(response);
        stats.slept += seconds;
        await sleep(seconds);
        continue;
      }
      const body = await response.json().catch(() => null);
      if (response.status !== 200) {
        throw new HttpClientError(`${path} answered ${response.status} after ${retries} retries: ${JSON.stringify(body)}`, { status: response.status, body });
      }
      return body;
    }
  }

  /** Follow next_cursor until it is null; returns every item in order. */
  async function getAll(path, { limit } = {}) {
    const items = [];
    let cursor = null;
    for (;;) {
      const page = await getJson(path, { params: { cursor, limit } });
      if (!Array.isArray(page.items)) throw new HttpClientError(`${path}: page has no items array`);
      stats.pages += 1;
      items.push(...page.items);
      if (page.next_cursor === null || page.next_cursor === undefined) return items;
      if (page.next_cursor === cursor) throw new HttpClientError(`${path}: next_cursor ${cursor} repeats`);
      cursor = page.next_cursor;
    }
  }

  return { getJson, getAll, fetchToken, stats, get token() { return token; } };
}
