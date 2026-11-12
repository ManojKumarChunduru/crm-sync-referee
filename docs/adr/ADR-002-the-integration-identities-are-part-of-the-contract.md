# ADR-002: The integration's identities are part of the contract, and a write by them is evidence of nothing

Status: accepted, 2026-11-12.

## Context

The bridge writes into Salesforce as an integration user from a connected app, and into the ERP as a service account. Every one of those writes appears in the change logs exactly like a person's write: a change event with a `commitUser` and a `changeOrigin`, an audit entry with an actor. A referee that reads them as writes concludes that the side the bridge wrote last is the side with the freshest value, which is backwards whenever the bridge applied a stale batch.

## Decision

The contract names the integration on each side: the Salesforce integration user Id and the `client=` value its connected app sets in `ChangeEventHeader.changeOrigin` (the reference documents this field for exactly this purpose, so an app can avoid reprocessing its own changes), and the ERP audit actor the bridge writes as. The readers classify every Write as originating or echo from those identities alone, and the referee never lets an echo decide a shared field or count as the owner's write. An echo is still evidence of what the bridge did: its value and instant decide between sync lag, echo of a stale value and sync transform once the stale side is known.

The fixture plants the case that makes this matter six times (6 echoes of a stale value): the ERP wrote v1 then v2, the batch sync applied v1 into Salesforce after v2 existed, so the latest Salesforce event is later than the latest ERP originating write. With echoes read as writes the ERP is blamed; with them read as echoes Salesforce is, and the explain output shows the ERP write that held v1 and the one that replaced it.

## Alternatives rejected

**Infer echoes by value.** A write whose value equals the other side's value at that instant is probably the bridge. Rejected: the batch sync that applies a stale snapshot writes a value the other side no longer holds, which is exactly the case above, and a person retyping the same value would be read as the bridge.

**Infer echoes by timing.** A write within a few seconds of the other side's write is probably the bridge. Rejected: that is the clock skew problem in another costume (ADR-003), and a nightly batch applies hours late.

**Leave the identities out of the contract and read them from the org.** Rejected because the referee is offline; the identities are declared, like the owners, and are as easy to get wrong, which is why `csr contract` prints them with their reasons.

## Consequences

A bridge that writes under a person's credentials cannot be refereed, and the contract has to say which identity it uses. An empty `changeOrigin` is read as originating, the optimistic reading, because the reference says the field is populated only for API clients and Lightning Experience; ADR-005 lists the scratch org experiment that would confirm it. The timestamp baseline measures what the decision buys: 8 wrong on an echo among the 17 name the wrong side.
