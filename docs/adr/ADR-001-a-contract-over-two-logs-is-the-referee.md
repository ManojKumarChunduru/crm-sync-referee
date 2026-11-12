# ADR-001: A contract replayed over two change logs is the referee; a timestamp comparison is not

Status: accepted, 2026-11-12.

## Context

A field diff between Salesforce and the ERP is symmetric. A Salesforce write that never left and an ERP write that never arrived leave the same two values in the same two columns, and nothing in either snapshot says which happened. The reconciliation scripts this replaces compared `LastModifiedDate` to `updated_at` and overwrote the older side.

## Decision

The referee is a third implementation of the declared semantics of the sync, applied to both change logs. The declared semantics are the contract (`contract/sync-contract.json`): per field an owner (Salesforce, the ERP, shared, or undeclared), the normalisers that define equality, and the identities the integration writes under; per run a retention window and a clock skew tolerance. The change logs are Change Data Capture messages on the Salesforce side and the audit log on the ERP side, reduced to one Write shape. For every field that differs, the referee applies the owner rule to the writes inside the window and names the stale side, the cause and the write that proves it, or one of the verdicts that name no side (ADR-003).

The normalisers are part of the semantics, not a convenience. 18 normalise away of the 103 raw differences on the fixture, and the one real mistake made during the build was a normaliser (`digits` kept the +1 country code) that turned four non-differences into confident sync-lag verdicts. A wrong normaliser produces a wrong verdict, not an error, so the contract carries a reason for every one and `csr contract` prints them.

## Alternatives rejected

**Latest timestamp wins.** Experiment 4 runs it on the same fixture: 56 the timestamp referee gets wrong of 103 rows the timestamp referee reports, 38 mis-attributed by timestamps among the real differences. It fails for three structural reasons: the latest write on a side is often the integration echoing the other side's older value (12 decided by the integration's own write), a later write is still the wrong one when the contract gives the field to the other system (9 wrong on a rogue write), and a record-level or field-level timestamp cannot say that two values are the same value in two formats (18 reported that were not differences).

**Salesforce as the system of record for everything.** This is the default the timestamp referee falls back to when nothing has written a field (9 defaulted to Salesforce). It is the assumption that writes stale values over fresh ones on every ERP-owned field.

**A sync dashboard.** It reports what the bridge did, not what either system holds now, and it cannot see a write made around the bridge.

## Consequences

The referee is only as right as the contract, and says so: a field the contract maps without an owner is reported as contract silent (2 contract silent rows on the fixture), never decided. The contract is a file in the repository with a reason on every line, validated at the boundary, so a misspelt owner is refused rather than read as shared. The ERP-side share and the Salesforce-side share (35.3% ERP-side share, 40% Salesforce-side share of 85 real diffs) are the figures a team can act on; the unattributable share (24.7% of real diffs unattributable) is the figure that tells them how much they cannot.
