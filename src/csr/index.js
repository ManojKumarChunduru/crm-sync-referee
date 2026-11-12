/**
 * The library surface: everything the CLI, the experiments and the tests use.
 */
export { loadContract, validateContract, contractFields, ContractError, OWNERS } from "./contract.js";
export { normalizeValue, normalizedEqual, NORMALISERS } from "./normalize.js";
export { loadSalesforce, writesFromEvents, originOf, clientOf, SalesforceReadError } from "./salesforce.js";
export { loadExternal, writesFromAudit, ExternalReadError } from "./external.js";
export { joinRecords } from "./join.js";
export { makeWrite, indexWrites, writeKey, inWindow, lastOriginating, last, ORIGINATING, ECHO } from "./writes.js";
export { referee, decideField, causeFor, countRows, exitCodeFor, parseDuration, VERDICT, CAUSE, UNATTRIBUTABLE, HOUR_MS } from "./referee.js";
export { naiveReferee } from "./naive.js";
export { renderText, renderJson, renderMarkdown, renderHtml, renderExplain, renderContract, VERDICT_LABELS, CAUSE_LABELS } from "./report.js";
export { createClient, HttpClientError } from "./http_client.js";
export { pull, formatJson } from "./pull.js";
export { EXIT_CLEAN, EXIT_STALE, EXIT_UNATTRIBUTABLE, EXIT_USAGE, EXIT_MEANING } from "./exit_codes.js";
