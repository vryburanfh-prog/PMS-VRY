# Phase 1 Follow-up: Write-Path and ID Allocation Audit

## Scope

Reviewed the Phase 1 branch `pms-modernization/phase1-id-uniqueness-enforcement` (PR #6) by static inspection of `Code.gs`, `Database.gs`, and `Security.gs`. This is a code audit only; it does not substitute for live Apps Script validation.

## ID allocator call-site review

- Enumerated all `generateNextId_` call sites in `Code.gs`.
- Endpoint call sites are protected by a Script Lock during their encompassing mutation flows.
- The helper `syncUserProjectAssignments_` does not acquire its own lock, but its two observed call sites are `apiCreateUser` and `apiUpdateUser`, both lock-protected and covered by tests.
- `apiGenerateClientPresentation` allocates the deck ID before the AI generation and later acquires a write lock for the sheet insertion. The allocator persists reservations under its own lock, and the duplicate-key insert helper validates the candidate while holding the insert lock. This permits harmless gaps but prevents duplicate IDs.
- Imports validate required and duplicate primary-key values before applying the replacement plan. Allocator reconciliation reads the live sheet when allocating, so imported/manual higher IDs are observed.

## Direct write review

The direct write operations found outside the database helper layer were reviewed in context:

- Project-controls registry deletion, weekly-report deletion, workload deletion, procurement deletion, and financial deletion are inside lock-protected API operations and perform authorization/ownership checks before deleting and auditing.
- Escalation updates use direct per-cell writes, but the full API operation is serialized by Script Lock; creation uses duplicate-checked insertion.
- Client presentation archival directly updates status and timestamp cells, but the operation is lock-protected, scoped to project/deck, and audited.
- Schema/header initialization writes in database/auth helpers are initialization paths, not record creation paths.
- Database import writes are intentionally handled as a replacement operation with validation, backup, and rollback logic under a lock.

## Findings

No additional unprotected record-write or ID-allocation bypass was identified in this static pass.

## Remaining validation

- Run the isolated Apps Script runtime tests documented in `phase1-runtime-concurrency-validation.md`, including parallel allocation, duplicate insert race, unique bulk insert, permission seed race, import/manual high-ID reconciliation, and lock-release-on-failure.
- Keep the modernization PR draft and do not merge/deploy until runtime evidence and final review are complete.
