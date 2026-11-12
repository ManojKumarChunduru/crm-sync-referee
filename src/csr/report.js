/**
 * Report rendering: text for a terminal, JSON for a machine, markdown for a CI
 * job summary, HTML for the screenshots, plus the explain and contract views.
 *
 * Why this file exists: the referee result is one structure and four audiences
 * read it. Keeping every rendering here, with the same ordering and the same
 * words, means a figure in the README can be checked against the JSON and a
 * screenshot shows the same table a reviewer gets on their terminal.
 */

import { VERDICT, CAUSE, UNATTRIBUTABLE, exitCodeFor } from "./referee.js";
import { ORIGINATING } from "./writes.js";
import { EXIT_MEANING } from "./exit_codes.js";

export const VERDICT_LABELS = {
  [VERDICT.NOT_A_DIFF]: "not a diff",
  [VERDICT.EXTERNAL_STALE]: "external stale",
  [VERDICT.SALESFORCE_STALE]: "Salesforce stale",
  [VERDICT.WINDOW_CLOSED]: "window closed",
  [VERDICT.WITHIN_CLOCK_SKEW]: "within clock skew",
  [VERDICT.SYNC_TRANSFORM]: "sync transform",
  [VERDICT.CONTRACT_SILENT]: "contract silent",
  [VERDICT.GAP_EVENT]: "gap event",
};

export const CAUSE_LABELS = {
  [CAUSE.SYNC_LAG]: "sync lag",
  [CAUSE.ROGUE_WRITE]: "rogue write",
  [CAUSE.ECHO_OF_STALE_VALUE]: "echo of a stale value",
  [CAUSE.LATER_WRITE]: "later write",
  [CAUSE.SYNC_TRANSFORM]: "sync transform",
  [CAUSE.WINDOW_CLOSED]: "window closed",
};

function fmt(value) {
  if (value === null) return "null";
  const s = String(value);
  return s.length > 32 ? `${s.slice(0, 31)}~` : s;
}

function pad(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

function headline(result) {
  const c = result.counts;
  return `${c.rawDifferences} raw differences on ${result.compared.records} joined records; ${c.notADiff} normalise away; ${c.realDiffs} real diffs: ${c.staleExternal} blame ${result.contract.external}, ${c.staleSalesforce} blame Salesforce, ${c.unattributable} no referee can attribute; ${c.orphans} orphan records`;
}

function verdictLine(c) {
  const v = c.byVerdict;
  return `window closed ${v[VERDICT.WINDOW_CLOSED]}, within clock skew ${v[VERDICT.WITHIN_CLOCK_SKEW]}, sync transform ${v[VERDICT.SYNC_TRANSFORM]}, contract silent ${v[VERDICT.CONTRACT_SILENT]}, gap event ${v[VERDICT.GAP_EVENT]}`;
}

function causeLine(c) {
  const b = c.byCause;
  return `causes: sync lag ${b[CAUSE.SYNC_LAG]}, rogue write ${b[CAUSE.ROGUE_WRITE]}, echo of a stale value ${b[CAUSE.ECHO_OF_STALE_VALUE]}, later write ${b[CAUSE.LATER_WRITE]}, sync transform ${b[CAUSE.SYNC_TRANSFORM]}, window closed ${b[CAUSE.WINDOW_CLOSED]}`;
}

export function renderText(result) {
  const lines = [];
  lines.push(`crm-sync-referee: ${result.contract.name}; as of ${result.asOfText}, window ${result.windowHours} h (from ${result.windowFrom}), clock skew tolerance ${result.skewSeconds} s`);
  lines.push(headline(result));
  lines.push(`${verdictLine(result.counts)}; ${causeLine(result.counts)}`);
  lines.push("");
  const real = result.rows.filter((r) => r.verdict !== VERDICT.NOT_A_DIFF);
  if (real.length > 0) {
    lines.push(table(["Record", "Field", "Owner", "Salesforce", result.contract.external, "Verdict", "Cause"], real.map((r) => [
      r.key, `${r.object}.${r.field}`, r.owner, fmt(r.salesforceValue), fmt(r.externalValue),
      VERDICT_LABELS[r.verdict], r.cause === null ? "" : CAUSE_LABELS[r.cause],
    ])));
    lines.push("");
  }
  const notDiffs = result.rows.filter((r) => r.verdict === VERDICT.NOT_A_DIFF);
  if (notDiffs.length > 0) {
    lines.push(`Not differences once normalised (${notDiffs.length}; a plain diff reports every one):`);
    for (const r of notDiffs) lines.push(`  ${r.key} ${r.object}.${r.field}: ${fmt(r.salesforceValue)} vs ${fmt(r.externalValue)}`);
    lines.push("");
  }
  if (result.orphans.length > 0) {
    lines.push("Orphan records (present on one side only):");
    for (const o of result.orphans) lines.push(`  ${o.object} ${o.side} only: ${o.id}${o.key && o.key !== o.id ? ` (sf_id ${o.key})` : ""}`);
    lines.push("");
  }
  if (result.gaps.length > 0) {
    lines.push("Gap events (Salesforce could not deliver a change; the record's history has a hole):");
    for (const g of result.gaps) lines.push(`  ${g.object} ${g.changeType} replayId ${g.replayId}: ${g.recordIds.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderJson(result) {
  const { rows, ...rest } = result;
  const slim = rows.map((r) => ({
    ...r,
    evidence: { salesforce: r.evidence.salesforce.map(slimWrite), external: r.evidence.external.map(slimWrite) },
    decidedBy: {
      salesforce: r.decidedBy.salesforce && slimWrite(r.decidedBy.salesforce),
      external: r.decidedBy.external && slimWrite(r.decidedBy.external),
    },
  }));
  return JSON.stringify({ exitCode: exitCodeFor(result), ...rest, rows: slim }, null, 2);
}

function slimWrite(w) {
  return {
    at: new Date(w.at).toISOString(), actor: w.actor, origin: w.origin,
    value: w.value, evidence: w.evidence, client: w.client,
  };
}

export function renderMarkdown(result) {
  const c = result.counts;
  const lines = [];
  lines.push("## crm-sync-referee");
  lines.push("");
  lines.push(`${headline(result)}. Window ${result.windowHours} h, clock skew tolerance ${result.skewSeconds} s, as of ${result.asOfText}.`);
  lines.push("");
  lines.push("| Verdict | Rows |");
  lines.push("| --- | --- |");
  for (const v of Object.values(VERDICT)) lines.push(`| ${VERDICT_LABELS[v]} | ${c.byVerdict[v]} |`);
  lines.push("");
  lines.push("| Record | Field | Owner | Salesforce | External | Verdict | Cause |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of result.rows.filter((x) => x.verdict !== VERDICT.NOT_A_DIFF)) {
    lines.push(`| \`${r.key}\` | \`${r.object}.${r.field}\` | ${r.owner} | ${fmt(r.salesforceValue)} | ${fmt(r.externalValue)} | ${VERDICT_LABELS[r.verdict]} | ${r.cause === null ? "" : CAUSE_LABELS[r.cause]} |`);
  }
  if (result.orphans.length > 0) {
    lines.push("");
    lines.push("### Orphan records");
    lines.push("");
    for (const o of result.orphans) lines.push(`- ${o.object}: \`${o.id}\` exists on the ${o.side} side only`);
  }
  return lines.join("\n");
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderHtml(result) {
  const c = result.counts;
  const code = exitCodeFor(result);
  const badgeClass = code === 2 ? "unattributable" : code === 1 ? "stale" : "clean";
  const badgeText = code === 2 ? `${c.unattributable} diffs no referee can attribute` : code === 1 ? `${c.attributed} stale, every one attributed` : "no differences";
  const real = result.rows.filter((r) => r.verdict !== VERDICT.NOT_A_DIFF);
  const rows = real.map((r) => {
    const evidence = [...r.evidence.salesforce, ...r.evidence.external].sort((a, b) => a.at - b.at)
      .map((w) => `<li class="${w.side} ${w.origin}">${escapeHtml(`${w.side === "salesforce" ? "SF" : "EXT"} ${new Date(w.at).toISOString().replace("T", " ").slice(0, 19)} ${w.origin === ORIGINATING ? w.actor : "sync"} = ${fmt(w.value)} (${w.evidence})`)}</li>`).join("");
    const klass = UNATTRIBUTABLE.includes(r.verdict) ? "unattributable" : r.verdict;
    return `<tr class="${klass}"><td><code>${escapeHtml(r.key)}</code></td><td><code>${escapeHtml(`${r.object}.${r.field}`)}</code></td><td>${r.owner}</td><td>${escapeHtml(fmt(r.salesforceValue))}</td><td>${escapeHtml(fmt(r.externalValue))}</td><td><span class="tag ${klass}">${VERDICT_LABELS[r.verdict]}</span></td><td>${r.cause === null ? "" : CAUSE_LABELS[r.cause]}</td><td><ul class="ev">${evidence || "<li>no writes in the window</li>"}</ul></td><td class="reason">${escapeHtml(r.reason)}</td></tr>`;
  }).join("\n");
  const notDiffs = result.rows.filter((r) => r.verdict === VERDICT.NOT_A_DIFF)
    .map((r) => `<li><code>${escapeHtml(r.key)}</code> ${escapeHtml(`${r.object}.${r.field}`)}: ${escapeHtml(fmt(r.salesforceValue))} vs ${escapeHtml(fmt(r.externalValue))}</li>`).join("\n");
  const orphans = result.orphans.map((o) => `<li><strong>${escapeHtml(o.object)}</strong> ${o.side} only: <code>${escapeHtml(o.id)}</code></li>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>crm-sync-referee report</title>
<style>
body { font-family: Inter, "Segoe UI", system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1c2330; }
header { background: #1b2a41; color: #fff; padding: 20px 28px; }
header h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
header p { margin: 0; color: #c7d0e0; font-size: 14px; }
.badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 13px; font-weight: 600; margin-left: 10px; vertical-align: middle; }
.badge.stale { background: #c62828; color: #fff; }
.badge.unattributable { background: #e6a700; color: #1c2330; }
.badge.clean { background: #2e7d32; color: #fff; }
section { padding: 18px 28px; }
h2 { font-size: 16px; margin: 0 0 10px; }
.summary { display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap: 12px; margin-bottom: 8px; }
.summary div { background: #fff; border: 1px solid #dde2ea; border-radius: 6px; padding: 10px 12px; }
.summary .n { font-size: 24px; font-weight: 700; display: block; }
.summary .l { font-size: 12px; color: #5b6676; }
table { width: 100%; border-collapse: collapse; background: #fff; font-size: 13px; table-layout: fixed; }
td { overflow-wrap: anywhere; }
th, td { border: 1px solid #dde2ea; padding: 7px 9px; vertical-align: top; text-align: left; }
th { background: #eef1f6; font-weight: 600; }
ul.ev { margin: 0; padding-left: 16px; font-size: 12px; }
li.echo { color: #7a8494; }
li.salesforce.originating { color: #1f5a24; }
li.external.originating { color: #2f3680; }
.tag { padding: 2px 7px; border-radius: 4px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.tag.external_stale { background: #e7e9f7; color: #2f3680; }
.tag.salesforce_stale { background: #e4f1e5; color: #1f5a24; }
.tag.unattributable { background: #fff1cc; color: #6b4e00; }
td.reason { color: #5b6676; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; }
ul.plain { margin: 0; padding-left: 18px; }
</style></head><body>
<header id="header"><h1>crm-sync-referee <span id="verdict" class="badge ${badgeClass}">${escapeHtml(badgeText)}</span></h1>
<p>${escapeHtml(result.contract.name)}. As of ${escapeHtml(result.asOfText)}; window ${result.windowHours} h; clock skew tolerance ${result.skewSeconds} s. Exit ${code}: ${escapeHtml(EXIT_MEANING[code])}.</p></header>
<section id="summary"><h2>Summary</h2><div class="summary">
<div><span class="n">${c.rawDifferences}</span><span class="l">raw differences</span></div>
<div><span class="n">${c.notADiff}</span><span class="l">normalise away</span></div>
<div><span class="n">${c.staleExternal}</span><span class="l">blame ${escapeHtml(result.contract.external)}</span></div>
<div><span class="n">${c.staleSalesforce}</span><span class="l">blame Salesforce</span></div>
<div><span class="n">${c.unattributable}</span><span class="l">no referee can attribute</span></div>
<div><span class="n">${c.orphans}</span><span class="l">orphan records</span></div>
</div></section>
<section id="verdicts"><h2>Real differences, with the write that decides each</h2>
<table><colgroup><col style="width:13%"><col style="width:12%"><col style="width:7%"><col style="width:9%"><col style="width:9%"><col style="width:10%"><col style="width:7%"><col style="width:15%"><col style="width:18%"></colgroup>
<thead><tr><th>Record</th><th>Field</th><th>Owner</th><th>Salesforce</th><th>${escapeHtml(result.contract.external)}</th><th>Verdict</th><th>Cause</th><th>Writes in the window</th><th>Reason</th></tr></thead>
<tbody>
${rows}
</tbody></table></section>
<section id="normalised"><h2>Not differences once normalised (a plain diff reports every one)</h2>
<ul class="plain">
${notDiffs || "<li>none</li>"}
</ul></section>
<section id="orphans"><h2>Orphan records</h2>
<ul class="plain">
${orphans || "<li>none</li>"}
</ul></section>
</body></html>
`;
}

/** One field of one record, every write in the window, and the sentence that decided it. */
export function renderExplain(result, object, field, key) {
  const row = result.rows.find((r) => r.object === object && r.field === field && r.key === key);
  const lines = [];
  lines.push(`${object}.${field} on ${key} (as of ${result.asOfText}, window ${result.windowHours} h, skew ${result.skewSeconds} s)`);
  if (row === undefined) {
    lines.push("  no difference: the two sides hold the same raw value, or the record is not joined on both sides");
    return lines.join("\n");
  }
  lines.push(`  owner: ${row.owner}`);
  lines.push(`  Salesforce: ${fmt(row.salesforceValue)} (normalised ${fmt(row.normalised.salesforce)})`);
  lines.push(`  ${result.contract.external}: ${fmt(row.externalValue)} (normalised ${fmt(row.normalised.external)})`);
  const writes = [...row.evidence.salesforce, ...row.evidence.external].sort((a, b) => a.at - b.at);
  lines.push(`  writes in the window (${writes.length}):`);
  for (const w of writes) {
    lines.push(`    ${new Date(w.at).toISOString()}  ${pad(w.side, 10)}  ${pad(w.origin, 11)}  ${pad(w.actor, 20)}  ${fmt(w.value)}  (${w.evidence}${w.client ? `, client=${w.client}` : ""})`);
  }
  if (writes.length === 0) lines.push("    none");
  lines.push(`  verdict: ${VERDICT_LABELS[row.verdict]}${row.cause === null ? "" : `, cause ${CAUSE_LABELS[row.cause]}`}${row.staleSide ? `; overwrite ${row.staleSide} with ${fmt(row.authoritativeValue)}` : ""}`);
  lines.push(`  because: ${row.reason}`);
  return lines.join("\n");
}

/** The contract as the referee read it, with every reason. */
export function renderContract(contract) {
  const lines = [];
  lines.push(`${contract.name}`);
  lines.push(`  Salesforce integration user ${contract.systems.salesforce.integrationUser}, changeOrigin client=${contract.systems.salesforce.changeOriginClient}: ${contract.systems.salesforce.reason}`);
  lines.push(`  ${contract.systems.external.name} sync actor ${contract.systems.external.syncActor}: ${contract.systems.external.reason}`);
  lines.push(`  retention window ${contract.retentionHours} h: ${contract.retentionReason}`);
  lines.push(`  clock skew tolerance ${contract.skewSeconds} s: ${contract.skewReason}`);
  for (const object of Object.values(contract.objects)) {
    lines.push(`  ${object.name} <-> ${object.externalEntity} (joined on ${object.key.salesforce} = ${object.key.external})`);
    for (const f of Object.values(object.fields)) {
      const norm = f.normalize.length === 0 ? "as is" : f.normalize.map((s) => s.name).join(", ");
      lines.push(`    ${pad(f.name, 16)} ${pad(f.owner, 11)} ${pad(`<-> ${f.externalField}`, 20)} ${pad(norm, 18)} ${f.reason}`);
    }
  }
  return lines.join("\n");
}
