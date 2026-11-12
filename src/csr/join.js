/**
 * Join the two snapshots record by record, and report the records only one
 * side has.
 *
 * Why this file exists: a field diff only exists between two rows that are the
 * same record, and the external system knows the Salesforce Id while Salesforce
 * does not know the external id, so the join runs from the external side
 * through its foreign key. A record on one side only is an orphan, reported
 * apart from field verdicts, because "which side is stale" has a different
 * meaning when one side has nothing at all.
 */

/**
 * @returns {{pairs: Array<{object: string, key: string, salesforce: object, external: object}>,
 *            orphans: Array<{object: string, side: string, id: string, key: string|null}>}}
 */
export function joinRecords(sf, ext, contract) {
  const pairs = [];
  const orphans = [];
  for (const object of Object.values(contract.objects)) {
    const sfRecords = sf.records[object.name];
    const extRecords = ext.records[object.externalEntity];
    const matched = new Set();
    const extIds = [...extRecords.keys()].sort();
    for (const extId of extIds) {
      const record = extRecords.get(extId);
      const key = record[object.key.external];
      if (typeof key !== "string" || key === "" || !sfRecords.has(key)) {
        orphans.push({ object: object.name, side: "external", id: extId, key: typeof key === "string" && key !== "" ? key : null });
        continue;
      }
      if (matched.has(key)) {
        orphans.push({ object: object.name, side: "external", id: extId, key, duplicateOf: key });
        continue;
      }
      matched.add(key);
      pairs.push({ object: object.name, key, salesforce: sfRecords.get(key), external: record });
    }
    for (const sfId of [...sfRecords.keys()].sort()) {
      if (!matched.has(sfId)) orphans.push({ object: object.name, side: "salesforce", id: sfId, key: sfId });
    }
  }
  // Plain code-point order, never localeCompare: the order must not depend on the runner's locale.
  const tag = (p) => `${p.object}|${p.key}`;
  pairs.sort((a, b) => (tag(a) < tag(b) ? -1 : tag(a) > tag(b) ? 1 : 0));
  orphans.sort((a, b) => `${a.object}|${a.side}|${a.id}` < `${b.object}|${b.side}|${b.id}` ? -1 : 1);
  return { pairs, orphans };
}
