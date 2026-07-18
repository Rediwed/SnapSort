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
| CA-04 | Unauthenticated admin/filesystem API, wildcard CORS, secret disclosure | Done | Production fails closed without Basic credentials, auth failures are throttled, CORS is removed, health alone is public, and ntfy secrets are write-only/masked. |
| CA-03 | Source guards use the wrong scope and lexical paths | Done | Node and Python canonicalize aliases, every Python copy receives an immutable source root, override writes are guarded, cross-job overlaps are rejected, and deployment mounts sources read-only. |
| CA-17 | Container and supply-chain hardening | Done | Runtime is non-root with read-only root FS, dropped capabilities, `no-new-privileges`, PID limit, tmpfs, split mounts, healthcheck, strict `npm ci`, digest-pinned base, pinned Python packages, and zero npm advisories. |

## P1 - Data Integrity

| ID | Finding | Status | Current work / remaining work |
|---|---|---|---|
| CA-02 | Benchmark writes into and deletes under source | Done | Runner samples source read-only and uses a unique destination temp directory with `finally` cleanup. Source hash and destination cleanup are tested. |
| CA-05 | Dedup and destination collision races | Done | Exact-content copy guards serialize match/copy/register, destination commits use filesystem locks, collision names are bounded, and overlapping active jobs are rejected. |
| CA-06 | Final-path copies are non-atomic | Done | Python and Node copy to same-directory temp files, fsync and hash-verify, atomically install, clean partials, and compensate DB failures. |
| CA-07 | Configurable extensions and previews enable arbitrary reads | Done | Preview/metadata paths are job-root confined regular files with fixed allowlists; previews are pixel-limited and re-encoded to JPEG with private cache, CSP, and `nosniff`. |
| CA-08 | Benchmark methodology gives unreliable recommendations | Done | Source samples and equal byte volumes run through three passes; median and p95 throughput, pipeline bottlenecks, unique destination data, and cache behavior are reported. |
| CA-11 | Duplicate resolution lacks transactions/provenance and may delete pre-existing files | Done | Output ownership is explicit, legacy/overwrite paths default protected, file operations are verified with compensating rollback, outcomes are recorded, and cleanup deletes owned paths only. |

## P2 - Correctness and Hardening

| ID | Finding | Status | Current work / remaining work |
|---|---|---|---|
| CA-09 | No restart reconciliation; engine error state can be overwritten | Done | Startup reconciles interrupted jobs, Retry resets run records while preserving outputs, legal route states are enforced, descriptive errors persist, and terminal jobs ignore late events. |
| CA-10 | Scan-only misses source-to-source duplicates | Done | Scan records are indexed under exact-content guards, including concurrent source-to-source duplicate detection. |
| CA-12 | Dimension filtering and RAW/custom behavior contradict UI/docs | Done | Either undersized dimension now rejects; ExifTool-confirmed RAW images reuse one metadata read; non-images remain errors; fixtures cover both paths. |
| CA-13 | Unbounded inputs, regex and parser denial of service | Done | Routes enforce key/type/range/page/batch limits, settings/profile allowlists, literal escaped search, 40 MP previews, 512 MB file limits, and bounded drive prescans. |
| CA-14 | SSRF and credential forwarding | Done | Immich was removed; ntfy enforces HTTP(S), DNS/address blocks, timeouts, bounded errors, and clears credentials when its origin changes. |
| CA-15 | macOS volume names enter shell commands | Done | One shared detector uses `execFileSync` argument arrays for diskutil/lsblk; hostile-volume regression coverage verifies literal arguments. |
| CA-16 | Repeated metadata/hash work, full materialization, N+1 queries | Done | Metadata/hash results are reused, ExifTool runs once, source processing and futures are bounded, and grouped SQL replaces job-selector N+1 queries. |

## P3 - Process and UX

| ID | Finding | Status | Current work / remaining work |
|---|---|---|---|
| CA-18 | Compose image tag is stale (`1.1.0` vs `1.2.1`) | Done | Compose and Unraid now default to `1.2.1`; Compose supports an explicit `SNAPSORT_VERSION` override. |
| CA-19 | Immich risk was active, not dead code | Done | The full integration, auto-upload, binary, UI, routes, and stored credentials were removed coherently. |
| CA-20 | No tests, CI, changelog, or release workflow | Partial | Node/Python regression suites and root `npm test` now exist. Add CI and initialize the standard release workflow separately. |
| CA-21 | Keyboard and screen-reader accessibility gaps | Pending | Fix dialogs, tabs, clickable rows, sorting, selection, tooltips, and labels. |
| CA-22 | Giant frontend components, duplicated utilities, exposed secret state | Partial | Immich state was removed and ntfy secrets are write-only, explicitly clearable, and removed from React state after save. Split components and shared frontend primitives remain. |
| CA-23 | Override counters drift for mixed skipped/scanned selections | Done | Successful rows transition transactionally from their actual prior status; skipped/scanned/copy/error counters are exact and failed photos retain their status. |
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