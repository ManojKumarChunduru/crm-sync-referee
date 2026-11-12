/**
 * The command line: referee, explain, contract, pull.
 *
 * Why this file exists: argument parsing stays boring on purpose (node:util
 * parseArgs, ADR-004), and the exit code is the interface a pipeline reads, so
 * it is set in one place from the referee result and nowhere else.
 */

import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { loadContract, ContractError } from "./contract.js";
import { loadSalesforce, SalesforceReadError } from "./salesforce.js";
import { loadExternal, ExternalReadError } from "./external.js";
import { referee, exitCodeFor, parseDuration } from "./referee.js";
import { renderText, renderJson, renderMarkdown, renderHtml, renderExplain, renderContract } from "./report.js";
import { pull } from "./pull.js";
import { HttpClientError } from "./http_client.js";
import { EXIT_CLEAN, EXIT_STALE, EXIT_UNATTRIBUTABLE, EXIT_USAGE, EXIT_MEANING } from "./exit_codes.js";

const USAGE = `csr: crm-sync-referee

usage:
  csr referee --salesforce <dir> --external <dir> --contract <file> [--window 72h] [--skew 5s]
              [--as-of <iso>] [--object <Name>] [--json <file>] [--markdown <file>] [--html <file>]
  csr explain <Object>.<Field> <recordId> --salesforce <dir> --external <dir> --contract <file> [--window] [--skew]
  csr contract --contract <file>
  csr pull --from <url> --client-id <id> --client-secret <secret> --contract <file> --out <dir> [--limit <n>]

options:
  --window <n>[h|d]  how far back the change logs are read before the snapshot instant (default: the contract's retention_hours)
  --skew <n>[s|m]    two originating writes closer than this cannot be ordered (default: the contract's clock_skew_tolerance_seconds)
  --as-of <iso>      the instant the window ends (default: the Salesforce snapshot's as_of); the clock is never read

exit codes:
  ${EXIT_CLEAN}  ${EXIT_MEANING[EXIT_CLEAN]}
  ${EXIT_STALE}  ${EXIT_MEANING[EXIT_STALE]}
  ${EXIT_UNATTRIBUTABLE}  ${EXIT_MEANING[EXIT_UNATTRIBUTABLE]}
  ${EXIT_USAGE}  ${EXIT_MEANING[EXIT_USAGE]}
`;

const OPTIONS = {
  salesforce: { type: "string" },
  external: { type: "string" },
  contract: { type: "string" },
  window: { type: "string" },
  skew: { type: "string" },
  "as-of": { type: "string" },
  object: { type: "string" },
  json: { type: "string" },
  markdown: { type: "string" },
  html: { type: "string" },
  from: { type: "string" },
  "client-id": { type: "string" },
  "client-secret": { type: "string" },
  out: { type: "string" },
  limit: { type: "string" },
  help: { type: "boolean", short: "h" },
};

function usageError(stderr, message) {
  stderr.write(`csr: ${message}\n`);
  return EXIT_USAGE;
}

function loadInputs(values, stderr) {
  for (const k of ["salesforce", "external", "contract"]) {
    if (values[k] === undefined) return { code: usageError(stderr, `--${k} is required`) };
  }
  const options = {};
  if (values.window !== undefined) {
    const hours = parseDuration(values.window, "h");
    if (hours === null || hours <= 0) return { code: usageError(stderr, `--window must be a positive duration like 72h or 3d, not ${values.window}`) };
    options.windowHours = hours;
  }
  if (values.skew !== undefined) {
    const seconds = parseDuration(values.skew, "s");
    if (seconds === null) return { code: usageError(stderr, `--skew must be a duration like 5s or 1m, not ${values.skew}`) };
    options.skewSeconds = seconds;
  }
  if (values["as-of"] !== undefined) {
    const asOf = Date.parse(values["as-of"]);
    if (Number.isNaN(asOf)) return { code: usageError(stderr, `--as-of must be an ISO instant, not ${values["as-of"]}`) };
    options.asOf = asOf;
  }
  if (values.object !== undefined) options.object = values.object;
  try {
    const contract = loadContract(values.contract);
    if (options.object !== undefined && contract.objects[options.object] === undefined) {
      return { code: usageError(stderr, `--object ${options.object} is not in the contract (${Object.keys(contract.objects).join(", ")})`) };
    }
    const salesforce = loadSalesforce(values.salesforce, contract);
    const external = loadExternal(values.external, contract);
    return { contract, salesforce, external, options };
  } catch (error) {
    if (error instanceof ContractError || error instanceof SalesforceReadError || error instanceof ExternalReadError) {
      return { code: usageError(stderr, error.message) };
    }
    throw error;
  }
}

/** Run the CLI. Returns the exit code; writes to the given streams. */
export async function run(argv, stdout = process.stdout, stderr = process.stderr) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    stderr.write(`csr: ${error.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    stdout.write(USAGE);
    return positionals.length === 0 && !values.help ? EXIT_USAGE : EXIT_CLEAN;
  }
  const command = positionals[0];
  if (!["referee", "explain", "contract", "pull"].includes(command)) {
    stderr.write(`csr: unknown command ${command}\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (command === "contract") {
    if (values.contract === undefined) return usageError(stderr, "--contract <file> is required");
    try {
      stdout.write(`${renderContract(loadContract(values.contract))}\n`);
      return EXIT_CLEAN;
    } catch (error) {
      if (error instanceof ContractError) return usageError(stderr, error.message);
      throw error;
    }
  }
  if (command === "pull") {
    for (const k of ["from", "client-id", "client-secret", "contract", "out"]) {
      if (values[k] === undefined) return usageError(stderr, `--${k} is required for pull`);
    }
    let limit;
    if (values.limit !== undefined) {
      limit = Number(values.limit);
      if (!Number.isInteger(limit) || limit <= 0) return usageError(stderr, `--limit must be a positive whole number, not ${values.limit}`);
    }
    try {
      const contract = loadContract(values.contract);
      const result = await pull({
        contract, baseUrl: values.from, clientId: values["client-id"], clientSecret: values["client-secret"], outDir: values.out, limit,
      });
      const s = result.stats;
      stdout.write(`pulled ${result.files.join(", ")} into ${values.out}: ${s.requests} requests, ${s.pages} pages, ${s.tokenRequests} token requests, ${s.refreshes} refreshes after 401, ${s.retries} retries after 429\n`);
      return EXIT_CLEAN;
    } catch (error) {
      if (error instanceof ContractError || error instanceof HttpClientError) return usageError(stderr, error.message);
      throw error;
    }
  }
  const inputs = loadInputs(values, stderr);
  if (inputs.code !== undefined) return inputs.code;
  const { contract, salesforce, external, options } = inputs;
  const result = referee({ contract, salesforce, external, ...options });
  if (command === "explain") {
    const target = positionals[1];
    const key = positionals[2];
    if (target === undefined || !target.includes(".") || key === undefined) return usageError(stderr, "explain needs <Object>.<Field> <recordId>");
    const [object, field] = target.split(".", 2);
    if (inputs.contract.objects[object] === undefined || inputs.contract.objects[object].fields[field] === undefined) {
      return usageError(stderr, `${object}.${field} is not in the contract`);
    }
    stdout.write(`${renderExplain(result, object, field, key)}\n`);
    const row = result.rows.find((r) => r.object === object && r.field === field && r.key === key);
    return row === undefined ? EXIT_CLEAN : exitCodeFor({ counts: { ...result.counts, ...singleCounts(row) } });
  }
  stdout.write(renderText(result));
  if (values.json !== undefined) writeFileSync(values.json, `${renderJson(result)}\n`);
  if (values.markdown !== undefined) writeFileSync(values.markdown, `${renderMarkdown(result)}\n`);
  if (values.html !== undefined) writeFileSync(values.html, renderHtml(result));
  const code = exitCodeFor(result);
  stdout.write(`exit ${code}: ${EXIT_MEANING[code]}\n`);
  return code;
}

function singleCounts(row) {
  const stale = row.staleSide !== null ? 1 : 0;
  const unattributable = row.verdict !== "not_a_diff" && row.staleSide === null ? 1 : 0;
  return { attributed: stale, unattributable, orphans: 0 };
}
