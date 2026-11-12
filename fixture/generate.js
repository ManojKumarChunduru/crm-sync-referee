/**
 * The fixture generator: two snapshots of the same accounts and contacts, one
 * per system, with a planted change history on each side and the verdict every
 * planted difference must receive.
 *
 * Why this file exists: an integration cannot be committed, but two snapshots
 * with a known history can, and the history is what makes the numbers able to
 * come out unfavourable. Every scenario below plants one kind of difference,
 * including the ones no referee can attribute (window closed, within clock
 * skew, the integration wrote both values) and the one a timestamp referee
 * gets backwards (the echo of a stale value). Seeded, so the committed files
 * are reproduced byte for byte; a test asserts it.
 *
 * Run: node fixture/generate.js   (writes fixture/salesforce, fixture/external, fixture/EXPECTED_VERDICTS.json)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const AS_OF = Date.UTC(2026, 10, 10, 0, 0, 0);
export const AS_OF_TEXT = new Date(AS_OF).toISOString();
export const WINDOW_HOURS = 72;
export const SKEW_SECONDS = 5;
export const SEED = 20261110;

export const INTEGRATION_USER = "005Kd000000SYNCAAA";
export const CHANGE_ORIGIN_CLIENT = "SyncBridge";
export const SYNC_ACTOR = "svc-sync-bridge";
const ECHO_ORIGIN = `com/salesforce/api/rest/62.0;client=${CHANGE_ORIGIN_CLIENT}`;
const SF_USERS = ["005Kd0000000A1BAAU", "005Kd0000000A2CAAU", "005Kd0000000A3DAAU", "005Kd0000000A4EAAU", "005Kd0000000A5FAAU", "005Kd0000000A6GAAU"];
const SF_ORIGINS = ["com/salesforce/api/soap/62.0;client=DataLoader", "com/salesforce/api/rest/62.0", ""];
const EXT_USERS = ["u.amara", "u.bela", "u.chen", "u.dmitri", "u.esther", "u.farid"];

const H = 3_600_000;
const D = 24 * H;
const h = (hours) => AS_OF - Math.round(hours * H);
const d = (days) => AS_OF - Math.round(days * D);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS1 = ["Northwind", "Harbor", "Summit", "Cobalt", "Granite", "Meridian", "Larkspur", "Pioneer", "Redwood", "Silverline", "Tidewater", "Vantage", "Westbrook", "Beacon", "Clearwater", "Ironwood", "Juniper", "Keystone", "Lantern", "Marigold"];
const WORDS2 = ["Logistics", "Analytics", "Foods", "Medical", "Energy", "Holdings", "Systems", "Textiles", "Capital", "Robotics", "Outfitters", "Dental", "Farms", "Marine", "Studios", "Freight", "Optics", "Brewing", "Metals", "Learning"];
const SUFFIX = ["LLC", "Inc", "Group", "Co", "Partners", "Ltd"];
const INDUSTRIES = [["Technology", "TECH"], ["Manufacturing", "MFG"], ["Healthcare", "HLTH"], ["Retail", "RTL"], ["Energy", "ENRG"], ["Finance", "FIN"], ["Education", "EDU"], ["Transportation", "TRNS"]];
const COUNTRIES = [["United States", "US"], ["United Kingdom", "GB"], ["Germany", "DE"], ["Canada", "CA"], ["India", "IN"], ["Australia", "AU"]];
const FIRST = ["Aarav", "Beatriz", "Caleb", "Dana", "Elif", "Femi", "Grace", "Hiro", "Imani", "Jonas", "Keiko", "Luis", "Maya", "Noor", "Oren", "Priya", "Quinn", "Rosa", "Sven", "Tariq", "Uma", "Viktor", "Wren", "Ximena", "Yusuf", "Zara"];
const LAST = ["Okafor", "Lindqvist", "Moreno", "Tanaka", "Reyes", "Brandt", "Chaudhry", "Dubois", "Eriksen", "Fontaine", "Haddad", "Iyer", "Jensen", "Kowalski", "Lombardi", "Mbeki", "Novak", "Oduya", "Petrov", "Quintero", "Rahman", "Sato", "Torres", "Ueda", "Varga", "Walsh"];
const TITLES = ["Operations Manager", "Account Executive", "Procurement Lead", "Plant Supervisor", "Finance Analyst", "Head of Partnerships", "Quality Engineer", "Customer Success Manager", "Logistics Coordinator", "IT Administrator"];
const DEPARTMENTS = ["Operations", "Sales", "Procurement", "Finance", "Customer Success", "Engineering", "Logistics", "Information Technology"];
const STATUSES = ["Active", "Inactive", "On Hold"];
const RATINGS = ["Hot", "Warm", "Cold"];
const SOURCES = ["Web", "Partner Referral", "Trade Show", "Phone Inquiry"];

/** The contract fields and the external field each maps to. Kept here so the fixture and the contract agree. */
export const FIELDS = {
  Account: {
    Name: { ext: "name", owner: "salesforce" },
    Phone: { ext: "phone", owner: "shared" },
    Industry: { ext: "industry", owner: "salesforce" },
    BillingCountry: { ext: "billing_country", owner: "shared" },
    AccountNumber: { ext: "account_number", owner: "external" },
    Website: { ext: "website", owner: "shared" },
    Rating: { ext: "rating", owner: "undeclared" },
  },
  Contact: {
    Email: { ext: "email", owner: "shared" },
    Phone: { ext: "phone", owner: "shared" },
    Title: { ext: "title", owner: "external" },
    MailingCountry: { ext: "mailing_country", owner: "shared" },
    Department: { ext: "department", owner: "shared" },
    ERP_Status__c: { ext: "status", owner: "external" },
    LeadSource: { ext: "source", owner: "undeclared" },
  },
};

export function generate() {
  const rand = mulberry32(SEED);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pad = (n, w) => String(n).padStart(w, "0");

  // Base records, converged on both sides.
  const accounts = [];
  for (let i = 1; i <= 150; i += 1) {
    const name = `${WORDS1[(i * 7) % WORDS1.length]} ${WORDS2[(i * 11) % WORDS2.length]} ${SUFFIX[i % SUFFIX.length]}`;
    accounts.push({
      object: "Account", sfId: `001Kd00000${pad(i, 5)}AAA`, extId: `ERP-A-${pad(i, 4)}`,
      created: d(int(60, 400)),
      values: {
        Name: name,
        Phone: `555-010-${pad(1000 + i, 4)}`,
        Industry: INDUSTRIES[i % INDUSTRIES.length][0],
        BillingCountry: COUNTRIES[i % COUNTRIES.length][0],
        AccountNumber: `ACC-${10000 + i}`,
        Website: `https://www.${name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "")}.example`,
        Rating: RATINGS[i % RATINGS.length],
      },
    });
  }
  const contacts = [];
  for (let i = 1; i <= 250; i += 1) {
    const first = FIRST[(i * 5) % FIRST.length];
    const last = LAST[(i * 3) % LAST.length];
    const account = accounts[(i * 13) % accounts.length];
    contacts.push({
      object: "Contact", sfId: `003Kd00000${pad(i, 5)}AAA`, extId: `ERP-C-${pad(i, 4)}`, accountSfId: account.sfId,
      created: d(int(60, 400)),
      values: {
        FirstName: first,
        LastName: last,
        Email: `${first}.${last}@${account.values.Website.replace("https://www.", "")}`.toLowerCase(),
        Phone: `555-020-${pad(1000 + i, 4)}`,
        Title: TITLES[i % TITLES.length],
        MailingCountry: COUNTRIES[(i * 7) % COUNTRIES.length][0],
        Department: DEPARTMENTS[i % DEPARTMENTS.length],
        ERP_Status__c: STATUSES[i % STATUSES.length],
        LeadSource: SOURCES[i % SOURCES.length],
      },
    });
  }
  const byObject = { Account: accounts, Contact: contacts };

  // Writes: per record, per field, per side, a list of {at, actor, origin, value, changeOrigin?}.
  const sfWrites = [];   // {record, field, at, user, origin, value}
  const extWrites = [];  // {record, field, at, actor, value}
  const expected = [];
  const used = new Set();
  const gaps = [];
  const orphans = [];

  function claim(object, field, { fromIndex = 0 } = {}) {
    const list = byObject[object];
    for (let tries = 0; tries < 10_000; tries += 1) {
      const record = list[fromIndex + Math.floor(rand() * (list.length - fromIndex))];
      const key = `${record.sfId}|${field}`;
      if (used.has(key) || record.orphan) continue;
      used.add(key);
      return record;
    }
    throw new Error(`no free ${object}.${field}`);
  }
  const sfOrig = (record, field, at, value) => sfWrites.push({
    record, field, at, user: pick(SF_USERS), origin: pick(SF_ORIGINS), value,
  });
  const sfEcho = (record, field, at, value) => sfWrites.push({
    record, field, at, user: INTEGRATION_USER, origin: ECHO_ORIGIN, value,
  });
  const extOrig = (record, field, at, value) => extWrites.push({ record, field, at, actor: pick(EXT_USERS), value });
  const extEcho = (record, field, at, value) => extWrites.push({ record, field, at, actor: SYNC_ACTOR, value });
  const expect = (record, field, verdict, cause, staleSide, scenario) => expected.push({
    object: record.object, key: record.sfId, field, verdict, cause, staleSide, scenario,
  });
  /** A fresh value for a field, different from `not`. */
  function fresh(object, field, not) {
    for (;;) {
      let v;
      if (field === "Name") v = `${pick(WORDS1)} ${pick(WORDS2)} ${pick(SUFFIX)}`;
      else if (field === "Phone") v = `555-${object === "Account" ? "010" : "020"}-${pad(int(2000, 9999), 4)}`;
      else if (field === "Industry") v = pick(INDUSTRIES)[0];
      else if (field === "BillingCountry" || field === "MailingCountry") v = pick(COUNTRIES)[0];
      else if (field === "AccountNumber") v = `ACC-${int(20000, 29999)}`;
      else if (field === "Website") v = `https://www.${pick(WORDS1).toLowerCase()}-${pick(WORDS2).toLowerCase()}.example`;
      else if (field === "Rating") v = pick(RATINGS);
      else if (field === "Email") v = `${pick(FIRST)}.${pick(LAST)}${int(1, 99)}@mail.example`.toLowerCase();
      else if (field === "Title") v = pick(TITLES);
      else if (field === "Department") v = pick(DEPARTMENTS);
      else if (field === "ERP_Status__c") v = pick(STATUSES);
      else if (field === "LeadSource") v = pick(SOURCES);
      else throw new Error(field);
      if (v !== not) return v;
    }
  }
  const ownerOf = (object, field) => FIELDS[object][field].owner;

  // Scenario N: orphans (5): 3 external-only, 2 Salesforce-only.
  for (let i = 0; i < 3; i += 1) {
    const list = i < 2 ? accounts : contacts;
    const prefix = i < 2 ? "ERP-A-9" : "ERP-C-9";
    const record = list[list.length - 1 - i];
    record.orphan = "external";
    record.extId = `${prefix}${pad(i + 1, 3)}`;
    record.extSfId = i === 0 ? null : `${record.sfId.slice(0, 13)}ZZZZZ`;
    orphans.push({ object: record.object, side: "external", id: record.extId });
  }
  for (let i = 0; i < 2; i += 1) {
    const list = i === 0 ? accounts : contacts;
    const record = list[list.length - 4 - i];
    record.orphan = "salesforce";
    orphans.push({ object: record.object, side: "salesforce", id: record.sfId });
  }

  // Scenario A: differences that normalise away (18). No stale side.
  const normalisable = [
    ["Account", "Phone", (v) => `(555) 010-${v.slice(-4)}`],
    ["Account", "Phone", (v) => `+1 ${v.replace(/-/g, " ")}`],
    ["Contact", "Phone", (v) => `+1-${v}`],
    ["Contact", "Email", (v) => v.replace(/^./, (c) => c.toUpperCase())],
    ["Contact", "Email", (v) => `${v} `],
    ["Account", "Website", (v) => v.replace("https://www.", "HTTPS://WWW.")],
    ["Account", "Name", (v) => `${v}  `],
    ["Account", "BillingCountry", (v) => COUNTRIES.find((c) => c[0] === v)[1]],
    ["Contact", "MailingCountry", (v) => COUNTRIES.find((c) => c[0] === v)[1]],
  ];
  for (let i = 0; i < 18; i += 1) {
    const [object, field, reformat] = normalisable[i % normalisable.length];
    const record = claim(object, field);
    const base = record.values[field];
    const variant = reformat(base);
    if (i % 3 === 0) {
      // A human retyped it on the external side; the sync never noticed because it compares normalised values.
      extOrig(record, field, h(int(2, 60)), variant);
      record.extOverride = { ...(record.extOverride ?? {}), [field]: variant };
    } else if (i % 3 === 1) {
      sfOrig(record, field, h(int(2, 60)), variant);
      record.sfOverride = { ...(record.sfOverride ?? {}), [field]: variant };
    } else {
      record.extOverride = { ...(record.extOverride ?? {}), [field]: variant };
    }
    expect(record, field, "not_a_diff", null, null, "A: normalises away");
  }

  // Scenario B: external stale through sync lag (20): Salesforce wrote inside the window, nothing applied it.
  const bFields = [["Account", "Name"], ["Account", "Industry"], ["Account", "Phone"], ["Contact", "Email"], ["Account", "Website"], ["Contact", "MailingCountry"], ["Contact", "Phone"]];
  for (let i = 0; i < 20; i += 1) {
    const [object, field] = bFields[i % bFields.length];
    const record = claim(object, field);
    const value = fresh(object, field, record.values[field]);
    sfOrig(record, field, h(int(1, 70)), value);
    record.sfOverride = { ...(record.sfOverride ?? {}), [field]: value };
    expect(record, field, "external_stale", "sync_lag", "external", "B: Salesforce wrote, sync lag");
  }

  // Scenario C: Salesforce stale through sync lag (16): the external system wrote inside the window.
  const cFields = [["Account", "AccountNumber"], ["Contact", "Title"], ["Contact", "ERP_Status__c"], ["Contact", "Phone"], ["Account", "BillingCountry"], ["Contact", "Department"]];
  for (let i = 0; i < 16; i += 1) {
    const [object, field] = cFields[i % cFields.length];
    const record = claim(object, field);
    const value = fresh(object, field, record.values[field]);
    extOrig(record, field, h(int(1, 70)), value);
    record.extOverride = { ...(record.extOverride ?? {}), [field]: value };
    expect(record, field, "salesforce_stale", "sync_lag", "salesforce", "C: external wrote, sync lag");
  }

  // Scenario D: rogue external writes on Salesforce-owned fields (5).
  for (let i = 0; i < 5; i += 1) {
    const [object, field] = [["Account", "Name"], ["Account", "Industry"]][i % 2];
    const record = claim(object, field);
    const value = fresh(object, field, record.values[field]);
    extOrig(record, field, h(int(1, 70)), value);
    record.extOverride = { ...(record.extOverride ?? {}), [field]: value };
    expect(record, field, "external_stale", "rogue_write", "external", "D: rogue external write on a Salesforce-owned field");
  }

  // Scenario E: rogue Salesforce writes on external-owned fields (4).
  for (let i = 0; i < 4; i += 1) {
    const [object, field] = [["Account", "AccountNumber"], ["Contact", "Title"], ["Contact", "ERP_Status__c"]][i % 3];
    const record = claim(object, field);
    const value = fresh(object, field, record.values[field]);
    sfOrig(record, field, h(int(1, 70)), value);
    record.sfOverride = { ...(record.sfOverride ?? {}), [field]: value };
    expect(record, field, "salesforce_stale", "rogue_write", "salesforce", "E: rogue Salesforce write on an external-owned field");
  }

  // Scenario F: the echo of a stale value (6). The external side wrote v1 then v2; a batch sync applied v1
  // into Salesforce after v2 existed. The latest Salesforce event is later than the external originating write.
  for (let i = 0; i < 6; i += 1) {
    const [object, field] = [["Contact", "Title"], ["Contact", "Email"]][i % 2];
    const record = claim(object, field);
    const v1 = fresh(object, field, record.values[field]);
    const v2 = fresh(object, field, v1);
    const t1 = h(int(40, 70));
    const t2 = t1 + int(1, 6) * H;
    const t3 = t2 + int(1, 12) * H;
    extOrig(record, field, t1, v1);
    extOrig(record, field, t2, v2);
    sfEcho(record, field, t3, v1);
    record.extOverride = { ...(record.extOverride ?? {}), [field]: v2 };
    record.sfOverride = { ...(record.sfOverride ?? {}), [field]: v1 };
    expect(record, field, "salesforce_stale", "echo_of_stale_value", "salesforce", "F: batch sync echoed a stale value after the external side moved on");
  }

  // Scenario G: the integration wrote both values (4). A shared Department: the external side wrote a long
  // value outside the window; inside it, the bridge truncated it into Salesforce and title-cased the
  // truncation back out. Both latest writes are echoes with different values.
  const longDepartments = [
    "Customer Success and Onboarding Operations Division Northeast",
    "Engineering Platform Reliability and Observability Group",
    "Procurement and Supplier Relationship Management Office",
    "Finance Shared Services and Statutory Reporting Centre",
  ];
  for (let i = 0; i < 4; i += 1) {
    const record = claim("Contact", "Department");
    const longValue = longDepartments[i];
    const truncated = longValue.slice(0, 40);
    const titled = truncated.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    extOrig(record, "Department", d(int(8, 20)), longValue);
    sfEcho(record, "Department", h(int(20, 60)), truncated);
    extEcho(record, "Department", h(int(2, 19)), titled);
    record.sfOverride = { ...(record.sfOverride ?? {}), Department: truncated };
    record.extOverride = { ...(record.extOverride ?? {}), Department: titled };
    expect(record, "Department", "sync_transform", null, null, "G: the bridge wrote both values");
  }

  // Scenario H: window closed (10). Shared fields, both sides wrote different values before the window.
  // 8 are inside a 30-day archive, 2 are older than anything in the logs.
  const hFields = [["Account", "Phone"], ["Contact", "Email"], ["Account", "Website"], ["Contact", "MailingCountry"], ["Account", "BillingCountry"]];
  for (let i = 0; i < 10; i += 1) {
    const [object, field] = hFields[i % hFields.length];
    const record = claim(object, field);
    const sfValue = fresh(object, field, record.values[field]);
    const extValue = fresh(object, field, sfValue);
    if (i < 8) {
      const base = d(int(4, 25));
      sfOrig(record, field, base, sfValue);
      extOrig(record, field, base + int(2, 40) * H, extValue);
    }
    record.sfOverride = { ...(record.sfOverride ?? {}), [field]: sfValue };
    record.extOverride = { ...(record.extOverride ?? {}), [field]: extValue };
    expect(record, field, "window_closed", null, null, i < 8 ? "H: both wrote before the window (in a 30-day archive)" : "H: both wrote before any log");
  }

  // Scenario I: within clock skew (4). Shared fields, originating writes 1 to 4 seconds apart.
  for (let i = 0; i < 4; i += 1) {
    const [object, field] = [["Contact", "Phone"], ["Account", "Phone"]][i % 2];
    const record = claim(object, field);
    const sfValue = fresh(object, field, record.values[field]);
    const extValue = fresh(object, field, sfValue);
    const t = h(int(5, 65));
    const gap = (i + 1) * 1000;
    sfOrig(record, field, t, sfValue);
    extOrig(record, field, i % 2 === 0 ? t + gap : t - gap, extValue);
    record.sfOverride = { ...(record.sfOverride ?? {}), [field]: sfValue };
    record.extOverride = { ...(record.extOverride ?? {}), [field]: extValue };
    expect(record, field, "within_clock_skew", null, null, `I: originating writes ${gap / 1000} s apart`);
  }

  // Scenario K: later write on a shared field (8). 3 with gaps between 20 and 50 seconds (attributed at the
  // 5 s tolerance, not at 60 s), 5 with gaps of hours.
  for (let i = 0; i < 8; i += 1) {
    const [object, field] = [["Contact", "Email"], ["Account", "Website"], ["Contact", "Department"], ["Account", "Phone"]][i % 4];
    const record = claim(object, field);
    const sfValue = fresh(object, field, record.values[field]);
    const extValue = fresh(object, field, sfValue);
    const t = h(int(5, 65));
    const gapMs = i < 3 ? int(20, 50) * 1000 : int(1, 10) * H;
    const sfLater = i % 2 === 0;
    sfOrig(record, field, sfLater ? t + gapMs : t, sfValue);
    extOrig(record, field, sfLater ? t : t + gapMs, extValue);
    record.sfOverride = { ...(record.sfOverride ?? {}), [field]: sfValue };
    record.extOverride = { ...(record.extOverride ?? {}), [field]: extValue };
    expect(record, field, sfLater ? "external_stale" : "salesforce_stale", "later_write", sfLater ? "external" : "salesforce",
      i < 3 ? `K: shared field, originating writes ${gapMs / 1000} s apart` : "K: shared field, originating writes hours apart");
  }

  // Scenario Q: an owned field with no write in the window on either side (3). The contract still names the
  // stale side; the cause is unknown because the evidence expired.
  for (let i = 0; i < 3; i += 1) {
    const [object, field] = [["Account", "AccountNumber"], ["Account", "Name"], ["Contact", "ERP_Status__c"]][i];
    const record = claim(object, field);
    const value = fresh(object, field, record.values[field]);
    const owner = ownerOf(object, field);
    if (owner === "salesforce") { sfOrig(record, field, d(int(5, 20)), value); record.sfOverride = { ...(record.sfOverride ?? {}), [field]: value }; }
    else {
      extOrig(record, field, d(int(5, 20)), value);
      record.extOverride = { ...(record.extOverride ?? {}), [field]: value };
    }
    expect(record, field, owner === "salesforce" ? "external_stale" : "salesforce_stale", "window_closed",
      owner === "salesforce" ? "external" : "salesforce", "Q: owned field, the only write is older than the window");
  }

  // Scenario R: the bridge transformed an owned value (2). The ERP wrote a 60-character title; the bridge
  // truncated it into Salesforce. The contract names Salesforce stale; the cause is the transform.
  const longTitles = [
    "Senior Director of Customer Success and Partner Enablement EMEA",
    "Vice President of Manufacturing Operations and Supply Planning",
  ];
  for (let i = 0; i < 2; i += 1) {
    const record = claim("Contact", "Title");
    const longValue = longTitles[i];
    const t = h(int(20, 60));
    extOrig(record, "Title", t, longValue);
    sfEcho(record, "Title", t + int(5, 60) * 60_000, longValue.slice(0, 40));
    record.extOverride = { ...(record.extOverride ?? {}), Title: longValue };
    record.sfOverride = { ...(record.sfOverride ?? {}), Title: longValue.slice(0, 40) };
    expect(record, "Title", "salesforce_stale", "sync_transform", "salesforce", "R: the bridge truncated an external-owned value");
  }

  // Scenario L: the contract is silent (2).
  for (const [object, field] of [["Account", "Rating"], ["Contact", "LeadSource"]]) {
    const record = claim(object, field);
    const value = fresh(object, field, record.values[field]);
    extOrig(record, field, h(int(1, 70)), value);
    record.extOverride = { ...(record.extOverride ?? {}), [field]: value };
    expect(record, field, "contract_silent", null, null, "L: mapped by the sync, ownership never decided");
  }

  // Scenario M: a gap event (1). Salesforce could not deliver this contact's changes; its Email differs.
  {
    const record = claim("Contact", "Email");
    const value = fresh("Contact", "Email", record.values.Email);
    record.sfOverride = { ...(record.sfOverride ?? {}), Email: value };
    gaps.push({ record, at: h(int(10, 60)), changeType: "GAP_UPDATE" });
    expect(record, "Email", "gap_event", null, null, "M: a gap event for the record inside the window");
  }

  // Scenario O: clean noise (40): a write on one side and its echo on the other, same value, no difference.
  for (let i = 0; i < 40; i += 1) {
    const object = i % 2 === 0 ? "Account" : "Contact";
    const fields = Object.keys(FIELDS[object]).filter((f) => ownerOf(object, f) !== "undeclared");
    const field = fields[i % fields.length];
    const record = claim(object, field);
    const value = fresh(object, field, record.values[field]);
    const t = i < 30 ? h(int(1, 70)) : d(int(4, 28));
    const side = ownerOf(object, field) === "external" ? "external" : ownerOf(object, field) === "salesforce" ? "salesforce" : (i % 3 === 0 ? "external" : "salesforce");
    if (side === "salesforce") { sfOrig(record, field, t, value); extEcho(record, field, t + int(30, 900) * 1000, value); }
    else { extOrig(record, field, t, value); sfEcho(record, field, t + int(30, 900) * 1000, value); }
    record.sfOverride = { ...(record.sfOverride ?? {}), [field]: value };
    record.extOverride = { ...(record.extOverride ?? {}), [field]: value };
  }

  // Scenario P: records created inside the window on both sides (10), every field equal.
  const created = [];
  for (let i = 0; i < 10; i += 1) {
    const record = (i % 2 === 0 ? accounts : contacts)[20 + i];
    if (record.orphan || [...used].some((k) => k.startsWith(`${record.sfId}|`))) continue;
    for (const f of Object.keys(FIELDS[record.object])) used.add(`${record.sfId}|${f}`);
    record.created = h(int(2, 70));
    record.createdInWindow = true;
    created.push(record);
  }

  const scenarios = {};
  for (const row of expected) {
    const letter = row.scenario.slice(0, 1);
    scenarios[letter] = (scenarios[letter] || 0) + 1;
  }
  scenarios.N = orphans.length;
  scenarios.O = 40;
  scenarios.P = created.length;

  return build({ accounts, contacts, sfWrites, extWrites, expected, gaps, orphans, created, scenarios });
}

function build({ accounts, contacts, sfWrites, extWrites, expected, gaps, orphans, created, scenarios }) {
  const iso = (ms) => new Date(ms).toISOString();
  const sfRecords = { Account: [], Contact: [] };
  const extRecords = { accounts: [], contacts: [] };
  const sfLast = new Map();
  const extLast = new Map();
  for (const w of sfWrites) sfLast.set(w.record.sfId, Math.max(sfLast.get(w.record.sfId) ?? 0, w.at));
  for (const w of extWrites) extLast.set(w.record.sfId, Math.max(extLast.get(w.record.sfId) ?? 0, w.at));

  for (const record of [...accounts, ...contacts]) {
    const sfValues = { ...record.values, ...(record.sfOverride ?? {}) };
    const extValues = { ...record.values, ...(record.extOverride ?? {}) };
    const fields = FIELDS[record.object];
    if (record.orphan !== "external") {
      const sfRecord = {
        attributes: { type: record.object, url: `/services/data/v62.0/sobjects/${record.object}/${record.sfId}` },
        Id: record.sfId,
      };
      if (record.object === "Contact") {
        sfRecord.AccountId = record.accountSfId;
        sfRecord.FirstName = sfValues.FirstName;
        sfRecord.LastName = sfValues.LastName;
      }
      for (const f of Object.keys(fields)) sfRecord[f] = sfValues[f];
      sfRecord.CreatedDate = iso(record.created);
      sfRecord.LastModifiedDate = iso(Math.max(record.created, sfLast.get(record.sfId) ?? 0));
      sfRecords[record.object].push(sfRecord);
    }
    if (record.orphan !== "salesforce") {
      const extRecord = { id: record.extId, sf_id: record.orphan === "external" ? record.extSfId : record.sfId };
      if (record.object === "Contact") {
        extRecord.first_name = extValues.FirstName;
        extRecord.last_name = extValues.LastName;
      }
      for (const [f, spec] of Object.entries(fields)) extRecord[spec.ext] = extValues[f];
      extRecord.created_at = iso(record.created);
      extRecord.updated_at = iso(Math.max(record.created, extLast.get(record.sfId) ?? 0));
      extRecords[record.object === "Account" ? "accounts" : "contacts"].push(extRecord);
    }
  }

  // Salesforce change events, one file per object, replayIds in commit order per channel.
  const events = { Account: [], Contact: [] };
  const sfEventRows = sfWrites.map((w) => ({
    object: w.record.object, recordId: w.record.sfId, at: w.at, user: w.user, origin: w.origin,
    changeType: "UPDATE", fields: { [w.field]: w.value },
  }));
  for (const record of created) {
    const values = { ...record.values, ...(record.sfOverride ?? {}) };
    const fields = {};
    for (const f of Object.keys(FIELDS[record.object])) fields[f] = values[f];
    if (record.object === "Contact") Object.assign(fields, { AccountId: record.accountSfId, FirstName: values.FirstName, LastName: values.LastName });
    sfEventRows.push({ object: record.object, recordId: record.sfId, at: record.created, user: INTEGRATION_USER, origin: ECHO_ORIGIN, changeType: "CREATE", fields });
  }
  for (const g of gaps) {
    sfEventRows.push({ object: g.record.object, recordId: g.record.sfId, at: g.at, user: "", origin: "", changeType: g.changeType, fields: {}, gap: true });
  }
  const fieldTag = (r) => Object.keys(r.fields).join();
  sfEventRows.sort((a, b) => a.at - b.at || (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0)
    || (fieldTag(a) < fieldTag(b) ? -1 : fieldTag(a) > fieldTag(b) ? 1 : 0));
  const replay = { Account: 1_000_000, Contact: 2_000_000 };
  const txn = { Account: 0, Contact: 0 };
  for (const row of sfEventRows) {
    replay[row.object] += 1;
    txn[row.object] += 1;
    const header = {
      entityName: row.object,
      recordIds: [row.recordId],
      changeType: row.changeType,
      changeOrigin: row.origin,
      transactionKey: `0001${row.object === "Account" ? "a" : "c"}-${String(txn[row.object]).padStart(6, "0")}-0000-0000-000000000000`,
      sequenceNumber: 1,
      commitTimestamp: row.at,
      commitNumber: 1_000_000_000 + replay[row.object],
      commitUser: row.user,
      changedFields: row.changeType === "UPDATE" ? [...Object.keys(row.fields), "LastModifiedDate"] : [],
    };
    const payload = { ChangeEventHeader: header, ...row.fields };
    if (row.changeType === "UPDATE") payload.LastModifiedDate = iso(row.at);
    if (row.changeType === "CREATE") { payload.CreatedDate = iso(row.at); payload.LastModifiedDate = iso(row.at); }
    events[row.object].push({
      channel: `/data/${row.object}ChangeEvent`,
      data: { schema: row.object === "Account" ? "kAp7Q9r6N1wq0bQZ8-xVgA" : "mT4c2Lw9eQ0RnH6vBsK1yA", payload, event: { replayId: replay[row.object] } },
    });
  }

  // External audit log, sorted by instant then id.
  const extRows = extWrites.map((w) => ({
    entity: w.record.object === "Account" ? "accounts" : "contacts", recordId: w.record.extId, field: FIELDS[w.record.object][w.field].ext,
    at: w.at, actor: w.actor, value: w.value, sfField: w.field, record: w.record,
  }));
  for (const record of created) {
    const values = { ...record.values, ...(record.extOverride ?? {}) };
    for (const [f, spec] of Object.entries(FIELDS[record.object])) {
      extRows.push({
        entity: record.object === "Account" ? "accounts" : "contacts", recordId: record.extId, field: spec.ext,
        at: record.created + 45_000, actor: SYNC_ACTOR, value: values[f], sfField: f, record, create: true,
      });
    }
  }
  extRows.sort((a, b) => a.at - b.at || (a.recordId < b.recordId ? -1 : 1) || (a.field < b.field ? -1 : 1));
  // The old value is the previous write to the same field, or the base value.
  const previous = new Map();
  const audit = extRows.map((r, i) => {
    const k = `${r.recordId}|${r.field}`;
    const old = r.create ? null : (previous.get(k) ?? r.record.values[r.sfField]);
    previous.set(k, r.value);
    return { id: `aud-${String(i + 1).padStart(6, "0")}`, entity: r.entity, record_id: r.recordId, field: r.field, old, new: r.value, actor: r.actor, at: iso(r.at) };
  });

  expected.sort((a, b) => `${a.object}|${a.key}|${a.field}` < `${b.object}|${b.key}|${b.field}` ? -1 : 1);
  orphans.sort((a, b) => `${a.object}|${a.side}|${a.id}` < `${b.object}|${b.side}|${b.id}` ? -1 : 1);

  return {
    salesforce: {
      "snapshot.json": {
        as_of: AS_OF_TEXT, org_id: "00DKd0000000001EAA", api_version: "62.0",
        integration_user: INTEGRATION_USER, change_origin_client: CHANGE_ORIGIN_CLIENT,
        note: "Records in REST query shape; change events in CometD message shape as a subscriber captured them, 30 days deep.",
      },
      "Account.json": { totalSize: sfRecords.Account.length, done: true, records: sfRecords.Account },
      "Contact.json": { totalSize: sfRecords.Contact.length, done: true, records: sfRecords.Contact },
      "events/AccountChangeEvent.json": events.Account,
      "events/ContactChangeEvent.json": events.Contact,
    },
    external: {
      "meta.json": {
        system: "ERP", as_of: AS_OF_TEXT, entities: ["accounts", "contacts"], sync_actor: SYNC_ACTOR,
        audit_retention: "complete", note: "Snapshot and audit log of the mock ERP; the same files csr pull writes.",
      },
      "accounts.json": { items: extRecords.accounts },
      "contacts.json": { items: extRecords.contacts },
      "audit.json": { items: audit },
    },
    expected: {
      as_of: AS_OF_TEXT, window_hours: WINDOW_HOURS, skew_seconds: SKEW_SECONDS, seed: SEED,
      scenarios, rows: expected, orphans,
    },
  };
}

export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeFixture(root = HERE) {
  const out = generate();
  const written = [];
  for (const [dir, files] of [["salesforce", out.salesforce], ["external", out.external]]) {
    for (const [name, value] of Object.entries(files)) {
      const path = join(root, dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, formatJson(value));
      written.push(path);
    }
  }
  const expectedPath = join(root, "EXPECTED_VERDICTS.json");
  writeFileSync(expectedPath, formatJson(out.expected));
  written.push(expectedPath);
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const p of writeFixture()) console.log(`wrote ${p}`);
}
