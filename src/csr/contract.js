/**
 * The sync contract: who owns each field, how each field is compared, and which
 * identities are the integration's own.
 *
 * Why this file exists: the contract is the third implementation of the
 * declared semantics that breaks the symmetry of a diff (ADR-001). It is a
 * policy file with a reason on every line, validated at the boundary so that
 * a field with a misspelt owner or a normaliser that does not exist is refused
 * before the referee reads a single record, never silently treated as shared.
 */

import { readFileSync } from "node:fs";
import { validateStep, NormaliserError } from "./normalize.js";

export const OWNERS = ["salesforce", "external", "shared", "undeclared"];

export class ContractError extends Error {}

function requireString(value, where) {
  if (typeof value !== "string" || value.trim() === "") throw new ContractError(`${where}: expected a non-empty string`);
  return value;
}

function requireNumber(value, where, { min = 0, integer = false } = {}) {
  if (typeof value !== "number" || Number.isNaN(value) || value < min || (integer && !Number.isInteger(value))) {
    throw new ContractError(`${where}: expected a number${integer ? " (whole)" : ""} of at least ${min}`);
  }
  return value;
}

function requireObject(value, where) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ContractError(`${where}: expected an object`);
  return value;
}

/** Validate a parsed contract object. Returns a frozen, normalised contract. */
export function validateContract(raw) {
  const top = requireObject(raw, "contract");
  const name = requireString(top.name, "contract.name");
  const systems = requireObject(top.systems, "contract.systems");
  const sf = requireObject(systems.salesforce, "contract.systems.salesforce");
  const ext = requireObject(systems.external, "contract.systems.external");
  const salesforce = {
    integrationUser: requireString(sf.integration_user, "contract.systems.salesforce.integration_user"),
    changeOriginClient: requireString(sf.change_origin_client, "contract.systems.salesforce.change_origin_client"),
    reason: requireString(sf.reason, "contract.systems.salesforce.reason"),
  };
  const external = {
    name: requireString(ext.name, "contract.systems.external.name"),
    syncActor: requireString(ext.sync_actor, "contract.systems.external.sync_actor"),
    reason: requireString(ext.reason, "contract.systems.external.reason"),
  };
  const skewSeconds = requireNumber(top.clock_skew_tolerance_seconds, "contract.clock_skew_tolerance_seconds");
  const retentionHours = requireNumber(top.retention_hours, "contract.retention_hours", { min: 1 });
  const skewReason = requireString(top.clock_skew_reason, "contract.clock_skew_reason");
  const retentionReason = requireString(top.retention_reason, "contract.retention_reason");
  const objectsRaw = requireObject(top.objects, "contract.objects");
  const objects = {};
  const entities = new Map();
  for (const [objectName, objRaw] of Object.entries(objectsRaw)) {
    const where = `contract.objects.${objectName}`;
    const obj = requireObject(objRaw, where);
    const externalEntity = requireString(obj.external_entity, `${where}.external_entity`);
    if (entities.has(externalEntity)) {
      throw new ContractError(`${where}.external_entity: ${externalEntity} is already the entity of ${entities.get(externalEntity)}`);
    }
    entities.set(externalEntity, objectName);
    const key = requireObject(obj.key, `${where}.key`);
    const fieldsRaw = requireObject(obj.fields, `${where}.fields`);
    const fields = {};
    const externalFields = new Map();
    for (const [fieldName, fRaw] of Object.entries(fieldsRaw)) {
      const fw = `${where}.fields.${fieldName}`;
      const f = requireObject(fRaw, fw);
      const owner = requireString(f.owner, `${fw}.owner`);
      if (!OWNERS.includes(owner)) throw new ContractError(`${fw}.owner: ${owner} is not one of ${OWNERS.join(", ")}`);
      const externalField = requireString(f.external_field, `${fw}.external_field`);
      if (externalFields.has(externalField)) {
        throw new ContractError(`${fw}.external_field: ${externalField} is already mapped to ${externalFields.get(externalField)}`);
      }
      externalFields.set(externalField, fieldName);
      const stepsRaw = f.normalize === undefined ? [] : f.normalize;
      if (!Array.isArray(stepsRaw)) throw new ContractError(`${fw}.normalize: expected an array`);
      let normalize;
      try {
        normalize = stepsRaw.map((s, i) => validateStep(s, `${fw}.normalize[${i}]`));
      } catch (error) {
        if (error instanceof NormaliserError) throw new ContractError(error.message);
        throw error;
      }
      fields[fieldName] = Object.freeze({
        name: fieldName, owner, externalField, normalize, reason: requireString(f.reason, `${fw}.reason`),
      });
    }
    if (Object.keys(fields).length === 0) throw new ContractError(`${where}.fields: at least one field is needed`);
    objects[objectName] = Object.freeze({
      name: objectName,
      externalEntity,
      key: Object.freeze({
        salesforce: requireString(key.salesforce, `${where}.key.salesforce`),
        external: requireString(key.external, `${where}.key.external`),
      }),
      fields: Object.freeze(fields),
    });
  }
  if (Object.keys(objects).length === 0) throw new ContractError("contract.objects: at least one object is needed");
  return Object.freeze({
    name,
    systems: Object.freeze({ salesforce: Object.freeze(salesforce), external: Object.freeze(external) }),
    skewSeconds,
    skewReason,
    retentionHours,
    retentionReason,
    objects: Object.freeze(objects),
  });
}

/** Read and validate a contract file. */
export function loadContract(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ContractError(`cannot read contract ${path}: ${error.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ContractError(`contract ${path} is not JSON: ${error.message}`);
  }
  return validateContract(raw);
}

/** The object a contract maps an external entity name to, or undefined. */
export function objectForEntity(contract, entity) {
  return Object.values(contract.objects).find((o) => o.externalEntity === entity);
}

/** The contract field an external field name maps to on an object, or undefined. */
export function fieldForExternal(object, externalField) {
  return Object.values(object.fields).find((f) => f.externalField === externalField);
}

/** Flat list of every contract field as {object, field}. */
export function contractFields(contract) {
  const out = [];
  for (const object of Object.values(contract.objects)) {
    for (const field of Object.values(object.fields)) out.push({ object: object.name, field: field.name, spec: field });
  }
  return out;
}
