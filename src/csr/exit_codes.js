/**
 * Exit codes, named once so the CLI, the tests and the CI workflow agree.
 *
 * Why this file exists: a pipeline reads nothing but the exit code, so the code
 * has to distinguish "the referee did its job and a side is stale" (1) from
 * "the referee could not name a side for every difference" (2). 2 wins over 1
 * when both apply, because the question was not fully answered (ADR-003).
 */

export const EXIT_CLEAN = 0;
export const EXIT_STALE = 1;
export const EXIT_UNATTRIBUTABLE = 2;
export const EXIT_USAGE = 3;

export const EXIT_MEANING = {
  [EXIT_CLEAN]: "no difference survives normalisation and no record is missing on either side",
  [EXIT_STALE]: "every surviving difference has a named stale side",
  [EXIT_UNATTRIBUTABLE]: "at least one difference has no nameable side (window closed, within clock skew, the integration wrote both values, or the contract is silent), so which side cannot be asserted for every row",
  [EXIT_USAGE]: "bad arguments, unreadable snapshot, event log, audit log or contract",
};
