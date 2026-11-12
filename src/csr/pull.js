/**
 * `csr pull`: the external system's snapshot and audit log, fetched over its
 * REST API and written as the directory the referee reads.
 *
 * Why this file exists: the referee has one reader for the external side, so
 * the HTTP path has to produce byte-for-byte the files the fixture directory
 * holds (a test asserts it). That makes the HTTP path prove the client and
 * nothing about the data, which is the honest scope of a mock (ADR-004).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "./http_client.js";

export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Pull every entity the contract names plus the audit log into `outDir`.
 * Returns the client's stats and the files written.
 */
export async function pull({ contract, baseUrl, clientId, clientSecret, outDir, limit, client: injected }) {
  const client = injected ?? createClient({ baseUrl, clientId, clientSecret });
  mkdirSync(outDir, { recursive: true });
  const files = [];
  const meta = await client.getJson("/api/v1/meta");
  writeFileSync(join(outDir, "meta.json"), formatJson(meta));
  files.push("meta.json");
  const entities = [...new Set(Object.values(contract.objects).map((o) => o.externalEntity))].sort();
  for (const entity of entities) {
    const items = await client.getAll(`/api/v1/${entity}`, { limit });
    writeFileSync(join(outDir, `${entity}.json`), formatJson({ items }));
    files.push(`${entity}.json`);
  }
  const audit = await client.getAll("/api/v1/audit", { limit });
  writeFileSync(join(outDir, "audit.json"), formatJson({ items: audit }));
  files.push("audit.json");
  return { files, stats: { ...client.stats } };
}
