# ADR-005: What two committed snapshots cannot establish

Status: accepted, 2026-11-12.

## Context

The fixture is two snapshots of the same 395 joined records with a planted history on each side, written by the referee's author. Every figure in the README is reproducible from it offline. That is the right default (receipts beat realism), and it is also a boundary: 103 of 103 recovered planted verdicts checks the rule arithmetic on a fixture that was built to be recovered, with a floor of 1 in 103.

## Declared inputs, each with the experiment that would settle it

1. **Change events are kept for 72 hours and nothing older can be replayed.** Declared from the Change Data Capture and Streaming API references (three days for change events, 72 hours for high-volume platform events, events outside the retention period are discarded). The committed event log is what an archiving subscriber would hold, and the referee applies the window itself; `--window 720h` models the archive. Experiment: subscribe with replay -2 to `/data/ContactChangeEvent` in a Developer Edition org on the fourth day after a change and record what arrives.
2. **An empty `changeOrigin` is an originating write.** The reference says the field is populated only for changes made by API apps or from Lightning Experience and empty otherwise. The fixture plants empty origins on a few user writes and no Classic UI writes; the referee reads an empty origin as a person's write, which is the optimistic reading. Experiment: make one change through the bridge's connected app and one through Classic, and read both headers.
3. **The ERP's audit log is complete and records the actor.** A system that logs no actor cannot be refereed, because echo suppression (ADR-002) has nothing to read. The referee also applies the same window to both logs, which is the conservative reading; an ERP that keeps more would attribute more. Experiment: compare the audit log's row count against the ERP's write count over one day.
4. **The clock skew tolerance is a policy, not a measurement.** 5 seconds is declared in the contract with a reason. Experiment: write a timestamp from each system into the other for a day and take the distribution of the differences; set the tolerance from its tail.
5. **Gap and overflow events are refusals, not histories.** The fixture plants one gap event (1 gap event in the report) and no overflow. Experiment: provoke a gap by changing a field type and read the delivered header.
6. **The `ExternalCredential` variant value for client credentials with a client secret.** The metadata reference reached in the build documents `JwtBearer` and `ClientCredentialsJwtAssertion`; the client-secret variant's value was not reachable, so the committed external credential declares the protocol and parameters and the variant is a placeholder to confirm on deployment.
7. **The two snapshots were taken at the same instant.** The fixture's `as_of` is the same on both sides; a real pull takes the ERP after the Salesforce export. Writes between the two instants on the Salesforce side are inside the window and after the external snapshot. Experiment: record both instants and run the referee with `--as-of` at the earlier one.

## What the fixture does support

Everything in the rule table: the owner rules, echo suppression, the window and tolerance sweeps, the normalisers, the byte-identical pull. Those are properties of the code, and the planted truth exercises every verdict and every cause the referee can give.

## What it would take to claim discovery

A second fixture written by someone other than the author, with the planted truth withheld until the referee has run. The recall figure then measures discovery, and the floor is 1 in whatever that fixture plants. Until then, 0 wrong verdicts, 0 false positives and 0 false negatives are each a rate below 1 in 103, and the README says so wherever it quotes them.
