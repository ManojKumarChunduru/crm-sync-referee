/**
 * The normalisers a contract may apply to both sides of a field before they are
 * compared.
 *
 * Why this file exists: most of what a plain diff reports between a CRM and an
 * ERP is not a difference at all (a phone with and without punctuation, an
 * email in two cases, a picklist code against its label). The contract names
 * the normalisers per field, and this module is the whole list, so a reviewer
 * can see exactly what "equal" means and what it does not (ADR-001).
 */

function asText(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

export const NORMALISERS = {
  /** Leading and trailing whitespace is a difference nobody intends. */
  trim: (value) => (value === null ? null : value.trim()),
  /** Case-insensitive fields: email, website. */
  lower: (value) => (value === null ? null : value.toLowerCase()),
  /** Phone numbers: keep the digits, drop punctuation, spaces and a leading plus. */
  digits: (value) => (value === null ? null : value.replace(/\D/g, "")),
  /** A North American number: the digits, with a leading country code 1 dropped when it leaves ten. */
  us_phone: (value) => {
    if (value === null) return null;
    const digits = value.replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  },
  /** An empty string on one side and null on the other are the same absence. */
  empty_as_null: (value) => (value === null || value === "" ? null : value),
  /** A code on the external side mapped to the Salesforce label, or left as is. */
  picklist: (value, step) => (value === null ? null : (step.map[value] ?? value)),
};

export class NormaliserError extends Error {}

/** Validate a normaliser step from the contract; returns the step object. */
export function validateStep(step, where) {
  const name = typeof step === "string" ? step : step && step.name;
  if (typeof name !== "string" || !(name in NORMALISERS)) {
    throw new NormaliserError(`${where}: unknown normaliser ${JSON.stringify(name)}; known: ${Object.keys(NORMALISERS).join(", ")}`);
  }
  if (name === "picklist") {
    if (typeof step !== "object" || step.map === null || typeof step.map !== "object") {
      throw new NormaliserError(`${where}: the picklist normaliser needs a map object of code to label`);
    }
    for (const [code, label] of Object.entries(step.map)) {
      if (typeof label !== "string") throw new NormaliserError(`${where}: picklist map value for ${code} must be a string`);
    }
    return { name, map: step.map };
  }
  return { name };
}

/** Apply the steps in order. Null stays null through every step. */
export function normalizeValue(value, steps) {
  let current = asText(value);
  for (const step of steps) current = NORMALISERS[step.name](current, step);
  return current;
}

/** Equal after normalisation; two nulls are equal. */
export function normalizedEqual(a, b, steps) {
  return normalizeValue(a, steps) === normalizeValue(b, steps);
}
