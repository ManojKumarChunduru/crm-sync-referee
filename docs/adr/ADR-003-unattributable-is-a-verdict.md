# ADR-003: Unattributable is a verdict with its own exit code, not a tie broken by a default

Status: accepted, 2026-11-12.

## Context

Some differences have no evidence good enough to name a side. The two originating writes may be closer than two clocks can order. The last originating writes on both sides may be older than the three days Salesforce keeps change events, so a replay from the bus would not see them. Both latest writes may be the integration's own, with different values, so the bridge produced the difference. The contract may map the field and declare no owner. Salesforce may have delivered a gap event for the record. A reconciliation script resolves every one of these with a default, usually "Salesforce wins", and the report looks complete.

## Decision

Five verdicts name no side, each with its reason in the row, and any of them makes the run exit 2: window closed, within clock skew, sync transform, contract silent, gap event. Exit 2 wins over exit 1 when both apply, because a pipeline that reads the code has to know the answer is incomplete before it acts on the rows that are complete. The window and the tolerance are options (`--window`, `--skew`) with their defaults in the contract next to a reason, so the sweep that shows what they cost is a flag, not a fork.

On the fixture: 21 no referee can attribute of 85 real diffs; 10 window closed, 4 within clock skew, 4 transform verdicts, 2 contract silent, 1 gap event. The window sweep (experiment 3) is the operational finding: 38 unattributable at 24 hours, 21 at the 72 hours the bus keeps, 9 unattributable at 720 hours; an archive recovers 12, legacy retention loses 17 more. The tolerance trades the other way: 68 attributed at zero tolerance, 7 undecided pairs at 60 seconds.

Owned fields are treated differently from shared ones on purpose. When the owner is declared and every write has expired, the contract still names the stale side (3 named by the contract alone) and the cause is window closed; the side is a fact of the contract, only the cause is unknown. For a shared field the same situation names nothing, because the rule is last writer wins and the last writer is what expired.

## Alternatives rejected

**Default to Salesforce.** This is the timestamp referee's fallback and the assumption that overwrites fresh ERP values on ERP-owned fields. Experiment 4 counts it: 9 defaulted to Salesforce, and 21 decided that cannot be decided in all.

**Pick the later timestamp regardless of tolerance.** A zero tolerance decides every pair by whichever clock happened to be ahead. The fixture plants four pairs 1 to 4 seconds apart; at zero tolerance all four are "decided".

**A confidence score.** Rejected because the five reasons are different operational actions (archive the events, measure the skew, fix the bridge's transform, decide the owner, replay the gap) and a number would hide which one applies.

## Consequences

The report is never fully green on a real integration, because the window is a property of the platform. That is the point: the unattributable share is the number that says how much the team cannot know, and the sweep says what archiving would buy. A gate that wants exit 0 has to archive change events, decide its silent fields and measure its skew, which is the right order of work.
