/**
 * The timestamp referee: the baseline experiment 4 measures against.
 *
 * Why this file exists: the alternative ADR-001 rejects has to be run on the
 * same fixture, not described. This referee does what a reconciliation script
 * usually does: for every raw difference, the side whose latest write to the
 * field is later wins, whoever wrote it, with no contract, no normalisation and
 * no window, and Salesforce wins by default when neither side has a write.
 * It is not on the CLI, because nobody should run it on purpose.
 */

import { writesFromEvents } from "./salesforce.js";
import { writesFromAudit } from "./external.js";
import { joinRecords } from "./join.js";
import { indexWrites, writeKey, last } from "./writes.js";
import { VERDICT } from "./referee.js";

export function naiveReferee({ contract, salesforce, external }) {
  const sfWrites = writesFromEvents(salesforce, contract).writes;
  const extWrites = writesFromAudit(external, contract).writes;
  const index = indexWrites([...sfWrites, ...extWrites]);
  const { pairs } = joinRecords(salesforce, external, contract);
  const rows = [];
  for (const pair of pairs) {
    const object = contract.objects[pair.object];
    for (const spec of Object.values(object.fields)) {
      const sfValue = pair.salesforce[spec.name] === undefined ? null : pair.salesforce[spec.name];
      const extValue = pair.external[spec.externalField] === undefined ? null : pair.external[spec.externalField];
      if (sfValue === extValue) continue;
      const entry = index.get(writeKey(pair.object, pair.key, spec.name)) ?? { salesforce: [], external: [] };
      const sfL = last(entry.salesforce);
      const extL = last(entry.external);
      let staleSide;
      let decidedBy = null;
      let defaulted = false;
      if (sfL === null && extL === null) {
        staleSide = "external";
        defaulted = true;
      } else if (sfL === null) {
        staleSide = "salesforce";
        decidedBy = extL;
      } else if (extL === null) {
        staleSide = "external";
        decidedBy = sfL;
      } else if (sfL.at >= extL.at) {
        staleSide = "external";
        decidedBy = sfL;
      } else {
        staleSide = "salesforce";
        decidedBy = extL;
      }
      rows.push({
        object: pair.object, key: pair.key, field: spec.name,
        salesforceValue: sfValue, externalValue: extValue,
        verdict: staleSide === "salesforce" ? VERDICT.SALESFORCE_STALE : VERDICT.EXTERNAL_STALE,
        staleSide, decidedBy, defaulted,
      });
    }
  }
  return rows;
}
