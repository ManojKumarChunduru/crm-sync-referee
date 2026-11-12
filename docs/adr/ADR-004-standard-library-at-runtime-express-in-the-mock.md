# ADR-004: Standard library at runtime; Express only in the mock; the HTTP client hand-written over fetch

Status: accepted, 2026-11-12.

## Context

The referee runs on an integration runner that has Node and nothing else, nightly, after a pull. It needs a REST client with an OAuth 2.0 client-credentials flow, cursor pagination and back-off, and something to test that client against.

## Decision

The referee's path imports only `node:fs`, `node:path`, `node:util` and global `fetch`; `package.json` has an empty `dependencies` and the CI gate job proves it with `npm ci --omit=dev` before running the referee. The REST client (`src/csr/http_client.js`) is written over `fetch`: a token from `POST /oauth/token` with HTTP Basic client authentication and the `client_credentials` grant, a bearer on every call, one refresh on 401, cursor pages until `next_cursor` is null, `Retry-After` honoured on 429 up to a cap. The clock and the sleep are injected, so the tests and experiment 5 drive expiry and back-off without waiting and no published figure depends on wall time.

The mock ERP (`mock/server.js`) is an Express application, and Express is a dev dependency. The boring choice, stated: Express rather than `node:http` for the mock because a mock is where a dependency costs nothing and the application's middleware shape (a bearer check, a 429 cadence, a token endpoint, cursor pages) reads as what it is; `fetch` rather than axios or got for the client because the client is the thing being shown. The mock serves the committed fixture, so `csr pull` against it must reproduce the fixture directory byte for byte, and a test and experiment 5 assert it: 37 requests in the pull, 30 pages pulled, 4 token requests, 3 refreshes after 401, 3 retries after 429. The HTTP path therefore proves the client and nothing about the data.

The contract is JSON with a `reason` string per entry rather than YAML, because Node has no YAML parser in its standard library and the reasons read as comments either way.

## Alternatives rejected

**A real ERP sandbox or a recorded HTTP cassette.** Rejected: neither is reproducible offline, and a cassette proves only that the recording replays.

**The mock inside the `csr` binary.** Rejected: it would make Express a runtime dependency of a tool whose point is to have none. `node mock/server.js` fails with a one-line reason when Express is not installed.

**No HTTP path at all, directories only.** Rejected: the resume names REST, OAuth and Express, and the Salesforce end of the same flow (a named credential with an OAuth external credential, an Apex REST resource) is in the SFDX source; the Node client is the other half.

## Consequences

`make verify` opens loopback sockets, in the tests and in experiment 5, and nothing else; the README says so. The referee has no dependency to audit, and the only code that runs on the runner is in `src/csr/`.
