import { test } from "node:test";
import assert from "node:assert/strict";
import { renderText, renderJson, renderMarkdown, renderHtml, renderExplain, renderContract, VERDICT_LABELS, CAUSE_LABELS } from "../src/csr/report.js";
import { referee, VERDICT, CAUSE } from "../src/csr/referee.js";
import { loadContract } from "../src/csr/contract.js";
import { loadSalesforce } from "../src/csr/salesforce.js";
import { loadExternal } from "../src/csr/external.js";
import { contract, sfSnapshot, extSnapshot, event, AS_OF, H, SF_DIR, EXT_DIR, CONTRACT_PATH } from "./helpers.js";

const c = contract();
const t = (hoursAgo) => AS_OF - hoursAgo * H;

function fixtureResult() {
  const full = loadContract(CONTRACT_PATH);
  return referee({ contract: full, salesforce: loadSalesforce(SF_DIR, full), external: loadExternal(EXT_DIR, full) });
}

function small() {
  const sf = sfSnapshot({
    records: { Account: [{ Id: "001A", Name: "Acme", Phone: "+1 555 010 1234", AccountNumber: "A1", Rating: "Hot" }] },
    events: [event({ id: "001A", at: t(10), fields: { Name: "Acme" }, replayId: 11, origin: "com/salesforce/api/soap/62.0;client=DataLoader" })],
  });
  const ext = extSnapshot({
    records: { accounts: [{ id: "E1", sf_id: "001A", name: "Acme Old", phone: "5550101234", account_number: "A1", rating: "Hot" }, { id: "E2", sf_id: null }] },
    audit: [],
  });
  return referee({ contract: c, salesforce: sf, external: ext });
}

test("every verdict and cause has a label", () => {
  for (const v of Object.values(VERDICT)) assert.equal(typeof VERDICT_LABELS[v], "string", v);
  for (const k of Object.values(CAUSE)) assert.equal(typeof CAUSE_LABELS[k], "string", k);
});

test("the text report leads with the headline counts and lists real diffs, normalised rows and orphans apart", () => {
  const text = renderText(small());
  assert.match(text, /2 raw differences on 1 joined records; 1 normalise away; 1 real diffs: 1 blame ERP, 0 blame Salesforce, 0 no referee can attribute; 1 orphan records/);
  assert.match(text, /001A\s+Account\.Name\s+salesforce\s+Acme\s+Acme Old\s+external stale\s+sync lag/);
  assert.match(text, /Not differences once normalised \(1; a plain diff reports every one\):\n {2}001A Account\.Phone: \+1 555 010 1234 vs 5550101234/);
  assert.match(text, /Orphan records \(present on one side only\):\n {2}Account external only: E2/);
});

test("the text report lists gap events when there are any", () => {
  const sf = sfSnapshot({ records: { Account: [{ Id: "001A", Phone: "1" }] }, events: [event({ id: "001A", type: "GAP_UPDATE", at: t(1), replayId: 3 })] });
  const ext = extSnapshot({ records: { accounts: [{ id: "E1", sf_id: "001A", phone: "2" }] } });
  assert.match(renderText(referee({ contract: c, salesforce: sf, external: ext })), /Gap events .*\n {2}Account GAP_UPDATE replayId 3: 001A/);
});

test("the JSON report carries the exit code, the counts, and every row with its evidence as ISO instants", () => {
  const json = JSON.parse(renderJson(small()));
  assert.equal(json.exitCode, 1);
  assert.equal(json.counts.realDiffs, 1);
  const row = json.rows.find((r) => r.field === "Name");
  assert.equal(row.evidence.salesforce[0].at, new Date(t(10)).toISOString());
  assert.equal(row.evidence.salesforce[0].client, "DataLoader");
  assert.equal(row.decidedBy.salesforce.evidence, "replayId 11");
  assert.equal(row.decidedBy.external, null);
});

test("the markdown report has a verdict table with every verdict and a row per real diff", () => {
  const md = renderMarkdown(small());
  for (const label of Object.values(VERDICT_LABELS)) assert.ok(md.includes(`| ${label} |`), label);
  assert.match(md, /\| `001A` \| `Account\.Name` \| salesforce \| Acme \| Acme Old \| external stale \| sync lag \|/);
  assert.match(md, /### Orphan records\n\n- Account: `E2` exists on the external side only/);
});

test("the HTML report carries the verdict badge in the header, a summary grid, and the four framed sections", () => {
  const html = renderHtml(small());
  assert.match(html, /<span id="verdict" class="badge stale">1 stale, every one attributed<\/span>/);
  for (const id of ["header", "summary", "verdicts", "normalised", "orphans"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<span class="n">1<\/span><span class="l">blame ERP<\/span>/);
  assert.match(html, /class="tag external_stale"/);
});

test("the HTML badge reads unattributable on the fixture and clean when there is nothing", () => {
  assert.match(renderHtml(fixtureResult()), /badge unattributable">\d+ diffs no referee can attribute/);
  const sf = sfSnapshot({ records: { Account: [{ Id: "001A", Phone: "1" }] } });
  const ext = extSnapshot({ records: { accounts: [{ id: "E1", sf_id: "001A", phone: "1" }] } });
  assert.match(renderHtml(referee({ contract: c, salesforce: sf, external: ext })), /badge clean">no differences/);
});

test("every CSS class the HTML markup uses has a rule in its stylesheet", () => {
  const html = renderHtml(fixtureResult());
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const used = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) for (const k of m[1].split(/\s+/)) if (k) used.add(k);
  const missing = [...used].filter((k) => !new RegExp(`\\.${k}(?![\\w-])`).test(style));
  assert.deepEqual(missing, []);
});

test("HTML escapes the values it prints", () => {
  const sf = sfSnapshot({ records: { Account: [{ Id: "001A", Name: "<b>x</b>" }] }, events: [event({ id: "001A", at: t(1), fields: { Name: "<b>x</b>" } })] });
  const ext = extSnapshot({ records: { accounts: [{ id: "E1", sf_id: "001A", name: "y & z" }] } });
  const html = renderHtml(referee({ contract: c, salesforce: sf, external: ext }));
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(html.includes("y &amp; z"));
  assert.ok(!html.includes("<b>x</b>"));
});

test("explain prints the two values, every write in the window with its evidence, and the sentence that decided", () => {
  const text = renderExplain(small(), "Account", "Name", "001A");
  assert.match(text, /^Account\.Name on 001A/);
  assert.match(text, /owner: salesforce/);
  assert.match(text, /Salesforce: Acme \(normalised Acme\)/);
  assert.match(text, /writes in the window \(1\):/);
  assert.match(text, /salesforce\s+originating\s+005Kd0000000A1BAAU\s+Acme\s+\(replayId 11, client=DataLoader\)/);
  assert.match(text, /verdict: external stale, cause sync lag; overwrite external with Acme/);
  assert.match(text, /because: Salesforce owns the field/);
});

test("explain says so when there is no difference or no joined record", () => {
  assert.match(renderExplain(small(), "Account", "AccountNumber", "001A"), /no difference/);
  assert.match(renderExplain(small(), "Account", "Name", "001Z"), /no difference/);
});

test("explain shows 'none' for a field with no writes in the window", () => {
  const sf = sfSnapshot({ records: { Account: [{ Id: "001A", Phone: "1" }] } });
  const ext = extSnapshot({ records: { accounts: [{ id: "E1", sf_id: "001A", phone: "2" }] } });
  const text = renderExplain(referee({ contract: c, salesforce: sf, external: ext }), "Account", "Phone", "001A");
  assert.match(text, /writes in the window \(0\):\n {4}none/);
  assert.match(text, /verdict: window closed\n/);
});

test("the contract view prints the identities, the window, the tolerance, and one line per field with its reason", () => {
  const text = renderContract(c);
  assert.match(text, /integration user 005Kd000000SYNCAAA, changeOrigin client=SyncBridge: the bridge/);
  assert.match(text, /retention window 72 h: three days/);
  assert.match(text, /clock skew tolerance 5 s: policy/);
  assert.match(text, /Account <-> accounts \(joined on Id = sf_id\)/);
  assert.match(text, /Phone\s+shared\s+<-> phone\s+us_phone, empty_as_null\s+both/);
  assert.match(text, /AccountNumber\s+external\s+<-> account_number\s+as is\s+erp owns it/);
});

test("long values are truncated in the tables so a row stays one line", () => {
  const sf = sfSnapshot({ records: { Account: [{ Id: "001A", Name: "x".repeat(80) }] }, events: [event({ id: "001A", at: t(1), fields: { Name: "x".repeat(80) } })] });
  const ext = extSnapshot({ records: { accounts: [{ id: "E1", sf_id: "001A", name: "y" }] } });
  const text = renderText(referee({ contract: c, salesforce: sf, external: ext }));
  assert.ok(text.includes(`${"x".repeat(31)}~`));
  assert.ok(!text.includes("x".repeat(40)));
});
