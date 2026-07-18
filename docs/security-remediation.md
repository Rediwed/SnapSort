# Security and Reliability Remediation

This ledger tracks the reconciled findings from the two independent SnapSort
audits completed on 18-07-2026. The `CA-*` IDs are the shared implementation
IDs used for branches, commits, and regression tests.

Status meanings:

- **Done**: implemented and covered by focused validation on the current branch.
- **Partial**: one or more defenses landed; listed follow-up remains.
- **Pending**: not implemented yet.

## P0 - Network Exposure Blockers

| ID | Finding | Status | Current work / remaining work |
|---|---|---|---|
| CA-01 | Benchmark request fields execute as Python | Done | Replaced generated source with `benchmark_runner.py`, strict bounded JSON input, and injection regression tests. |
| CA-04 | Unauthenticated admin/filesystem API, wildcard CORS, secret disclosure | Pending | Add authentication, trusted origins, write-only masked secrets, and rate limiting. |
| CA-03 | Source guards use the wrong scope and lexical paths | Partial | Canonical Node guard and benchmark known-source protection are covered. Still pass immutable `source_root` through Python, guard override writes, prevent cross-job overlap, and mount sources read-only. |
| CA-17 | Container and supply-chain hardening | Pending | Run non-root, split source/destination mounts, pin dependencies/images, add health and resource controls. |

## P1 - Data Integrity

| ID | Finding | Status | Current work / remaining work |
|---|---|---|---|
| CA-02 | Benchmark writes into and deletes under source | Done | Runner samples source read-only and uses a unique destination temp directory with `finally` cleanup. Source hash and destination cleanup are tested. |
| CA-05 | Dedup and destination collision races | Pending | Add atomic match/reserve/register and shared destination locking across jobs. |
| CA-06 | Final-path copies are non-atomic | Pending | Copy to temporary files, flush/verify, atomically replace, and clean partials. |
| CA-07 | Configurable extensions and previews enable arbitrary reads | Pending | Enforce image allowlist/signatures, reject symlinks, and safely rasterize previews. |
| CA-08 | Benchmark methodology gives unreliable recommendations | Partial | Existing source samples, unique destination temp data, and pipeline throughput now participate. Add repeated runs, median/p95, and explicit cache-state labeling. |
| CA-11 | Duplicate resolution lacks transactions/provenance and may delete pre-existing files | Pending | High priority: model provenance, make disk/DB/counter updates recoverable, and protect pre-existing paths from cleanup. |

## P2 - Correctness and Hardening

| ID | Finding | Status | Current work / remaining work |
|---|---|---|---|
| CA-09 | No restart reconciliation; engine error state can be overwritten | Pending | Formalize transitions, attempt IDs, late-event rejection, Retry, and Resume. |
| CA-10 | Scan-only misses source-to-source duplicates | Pending | Register source records during scan and persist destination match metadata. |
| CA-12 | Dimension filtering and RAW/custom behavior contradict UI/docs | Pending | Correct filter semantics and add real format fixtures/fallback behavior. |
| CA-13 | Unbounded inputs, regex and parser denial of service | Partial | Benchmark values and total disk work are bounded. Add schemas/ranges across all APIs and bounded search/parsing. |
| CA-14 | SSRF and credential forwarding | Partial | Immich integration and its API-key path were removed. Harden ntfy URL, credentials, and timeouts. |
| CA-15 | macOS volume names enter shell commands | Pending | Replace shell strings with `execFileSync` and share drive detection. |
| CA-16 | Repeated metadata/hash work, full materialization, N+1 queries | Pending | Consolidate per-file metadata and use bounded queues/grouped queries. |

## P3 - Process and UX

| ID | Finding | Status | Current work / remaining work |
|---|---|---|---|
| CA-18 | Compose image tag is stale (`1.1.0` vs `1.2.1`) | Pending | Wire deployment tag to the release version. |
| CA-19 | Immich risk was active, not dead code | Done | The full integration, auto-upload, binary, UI, routes, and stored credentials were removed coherently. |
| CA-20 | No tests, CI, changelog, or release workflow | Partial | Node/Python regression suites and root `npm test` now exist. Add CI and initialize the standard release workflow separately. |
| CA-21 | Keyboard and screen-reader accessibility gaps | Pending | Fix dialogs, tabs, clickable rows, sorting, selection, tooltips, and labels. |
| CA-22 | Giant frontend components, duplicated utilities, exposed secret state | Partial | Immich secret state was removed. Mask ntfy secrets and split/shared frontend primitives. |
| CA-23 | Override counters drift for mixed skipped/scanned selections | Pending | Use exact transactional status deltas. |
| CA-24 | Immich duplicate parser and upload timeout defects | Done | Removed with the Immich integration. |

## Validation Baseline

Every remediation slice must include the narrowest executable regression check.
The current baseline is:

```bash
npm test
```

The suite currently verifies benchmark input injection resistance, numeric and
disk-work bounds, nested/symlink path rejection, canonical source aliases,
source-tree immutability, and destination cleanup.