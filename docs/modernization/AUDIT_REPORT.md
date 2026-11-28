# PMS-VRY Preliminary Source Audit

**Repository:** PMS-VRY, main branch  
**Reviewed source files:** Security.gs, Database.gs, Code.gs, index.html (initial targeted review; not exhaustive)  
**Audit status:** Preliminary. Findings must be confirmed with complete cross-module review and runtime tests before treating as final.

## Summary
The code has useful foundations: a server-side role permission ceiling, project assignment checks, API allowlisting, direct API auth wrappers, hashed bearer-session storage, 8-hour sessions, trusted-admin allowlist, and script locks around several database writes. The app also appears to have many project-controls modules already. The priority is to validate security boundaries and integrity of multi-step operations, then improve controls and workflow capabilities rather than rebuild.

## Findings and recommended priority

### P1 — High: ID allocation is not atomic with insertion
**Evidence:** generateNextId_ in Database.gs scans current table records and computes max+1. API handlers commonly call this separately from insertRecord_, whose script lock protects the append but not the earlier ID calculation. Concurrent requests can allocate the same ID before either append occurs.
**Impact:** Duplicate record identifiers, overwrite/update ambiguity, failed links or corrupted audit/reference relationships.
**Recommendation:** Create a lock-protected allocate-and-insert operation (or a dedicated ID counter per table) and migrate creation handlers to use it. Add concurrent-create test; ensure uniqueness is enforced at server-side insertion.
**Severity:** High (integrity risk; practical exposure depends on concurrent usage).

### P1 — High: Password credential hashing uses a custom PBKDF2-like implementation
**Evidence:** hashPassword_ manually iterates HMAC-SHA256 120,000 times, and the source labels it PBKDF2-like. Review exact byte handling, correctness against standard PBKDF2 test vectors, and performance/DoS implications.
**Impact:** Custom cryptographic implementation increases risk of subtle incompatibility or weakness; brute-force resistance also depends on password policy and throttling.
**Recommendation:** Prefer a standard, reviewed password KDF implementation if platform support permits. If retained, verify with known vectors, benchmark, enforce strong password policy, and make rate limiting persistent and robust. Review salt length/entropy and password reset flow.
**Severity:** High pending crypto validation.

### P1 — High: Login throttling may be bypassable / lacks global controls
**Evidence:** Password login tracks Failed_Attempts per credential and applies a 15-minute lock at 5 attempts, with 500 ms sleep on failures. Need inspect locking/atomicity, reset behavior, unknown-user timing, and whether attacker can trigger simultaneous requests to race counters.
**Impact:** Credential guessing or denial of service by locking legitimate accounts.
**Recommendation:** Add atomic failure counters, progressive backoff, global/IP-independent controls available in Apps Script, administrator recovery, audit for lockout events, and equalized failure responses/timing where practical.
**Severity:** High pending validation.

### P1 — High: Google token validation and network error handling needs hardening
**Evidence:** Google sign-in validates token via tokeninfo endpoint, checks audience, issuer, email_verified and expiry. It uses UrlFetchApp.fetch with muteHttpExceptions, then JSON.parse after 200. Need verify timeout/error behavior, claim validation (including subject), and token handling/redirect URI context.
**Impact:** Authentication failures, edge-case acceptance risks or unhandled exceptions if response is malformed.
**Recommendation:** Add strict JSON/error handling and verify standard claims; validate sub and nonce if applicable to the client flow, use Google-supported verification approach, add timeout where available, audit invalid auth attempts without logging tokens.
**Severity:** High review priority; no confirmed token-validation bypass in this targeted inspection.

### P1 — High: Direct API guard coverage and public endpoints require complete inventory
**Evidence:** Dispatcher allowlist and wrapper install exist. Public deck endpoints are explicitly handled in doGet; comments say they remain outside dashboard private API. A complete inventory is needed to confirm every exported callable API is guarded and every public endpoint has narrowly scoped, expiring token access.
**Impact:** Unauthorized read/write exposure if an exported API or public endpoint is unguarded.
**Recommendation:** Compare all global API functions with allowlist and guard installation; classify public functions; test unauthenticated calls, role restrictions, project assignment restrictions, and token expiry/revocation.
**Severity:** High review priority; not a confirmed bypass.

### P2 — Medium: Script lock is used for row writes, but not all mutations use shared helpers
**Evidence:** Database helpers lock writes and batch contiguous cell updates. Some project-control delete paths directly call sheet.deleteRow without visible shared lock or cache invalidation; further direct-write inventory is needed.
**Impact:** Concurrent edits, stale cached records, audit and mutation inconsistency.
**Recommendation:** Centralize all mutating operations through lock-protected DB helpers, ensure cache invalidation, and include audit logging in the mutation transaction pattern (Apps Script/Sheets cannot provide true multi-sheet transactions).
**Severity:** Medium.

### P2 — Medium: Audit logging may fail after data mutation
**Evidence:** Some handlers mutate records then call writeAuditLog_ separately. writeAuditLog_ generates an ID and inserts audit record. If audit insert fails after business write, change may occur without an audit entry.
**Impact:** Incomplete accountability and recovery trail.
**Recommendation:** Make audit failure behavior explicit; log mutation/audit status, retain immutable before/after snapshots, consider a pending-audit/repair mechanism and alert. Avoid claiming transaction semantics.

### P2 — Medium: Input validation and field allowlists need a broad audit
**Evidence:** Registry save handler copies payload into cleanRecord and assigns ID/Project_ID, with limited generic validation. Some values have custom validation, but no complete field allowlist is visible in this targeted sample.
**Impact:** Unexpected fields, malformed values, sheet/formula injection, invalid cross-record references.
**Recommendation:** Add module-specific schema validation, allowed fields, date/enum/numeric validation, safe URL handling, formula-injection defenses for imports/exports, and relationship/project ownership validation.

### P2 — Medium: Cached table data and cache invalidation consistency
**Evidence:** Script cache used for table records, with helper invalidation in some CRUD helpers. Need inventory of direct writes and cross-table dependent caches.
**Impact:** Stale data in UI, permission/config updates delayed or inconsistent.
**Recommendation:** Centralize mutations, invalidate affected caches, and use short TTL for permission/configuration caches or bypass caches for security-sensitive decisions.

### P2 — Medium: UI rendering uses innerHTML extensively
**Evidence:** index.html dynamically builds module HTML with innerHTML. Many paths use escapeHtmlSafe_, but complete taint tracing and safe-JS argument validation are not finished.
**Impact:** XSS if unescaped database/API values reach markup, attributes, event handlers, URLs, or script contexts.
**Recommendation:** Audit every dynamic insertion, use context-specific encoding, avoid inline handler construction with untrusted values, validate URLs and use DOM text APIs for plain text. Add XSS regression payload tests.

### P2 — Medium: Google Sheets is the current datastore and needs scale controls
**Evidence:** Database helpers read full table ranges; getTableRecords_ materializes all rows and columns. The project data is spreadsheet-backed.
**Impact:** Latency, Apps Script quotas, concurrency limits and execution time as data/users grow.
**Recommendation:** Instrument execution duration and row counts, batch reads/writes, paginate or filter server-side, monitor cache hit rate and sheet growth; define a migration threshold based on measured metrics.

## Strengths already present
- Role normalization and server-side permission ceiling.
- Trusted Administrator email allowlist.
- Project-assignment checks on permission assertions.
- API allowlist and auth wrappers around listed private APIs.
- Bearer token digests stored in Auth_Sessions; session expiration and revocation.
- Password account login restricted from Administrator role.
- Script locks around several write helpers.
- Audit logging helpers and cache invalidation helper.
- Frontend helper escapeHtmlSafe_ appears frequently in module rendering; full coverage still needs review.

## Next audit work (Phase 1)
1. Inventory every api* and exported/global function; compare allowlist/guards and inspect public token endpoints.
2. Review project-ownership checks and payload handling for every write API, especially imports, backups, template/fresh-database operations, financial/procurement/workload, approvals, and audit/admin endpoints.
3. Trace frontend values into HTML/attributes/URLs/inline JS, including Presentation.html.
4. Review backup/restore and import/export for destructive behavior, permissions, validation, formula handling, and audit.
5. Build test matrix: unauthenticated, each role, unassigned project, assigned project, cross-project record ID, invalid payload, concurrent create/update, deleted/archived record, expired/revoked session.
6. Confirm backup restore on a non-production copy before any remediation deployment.

## Additional targeted review notes (API inventory and transfer/public endpoints)

- The API inventory includes project WBS, schedule, progress, reports, workload, procurement, financials, portfolio, PMO digest, escalation, snapshots, database transfer, and presentation endpoints. Most inspected project APIs include server-side permission assertions; continue checking every endpoint and permission mapping.
- Destructive database reset and import functions include Administrator/transfer checks, lock use, and pre-operation full-spreadsheet backups. These controls are positive, but restore tests, backup access/retention, and import formula/data validation remain to be verified.
- Public client deck access is intentionally token-based. Published deck retrieval validates token shape and publication status but no expiry field was visible in this inspected function. Review token entropy, revocation/archiving, sharing scope, sensitive fields in deck JSON, and whether expiry is needed for the business use case.
- Direct deletion paths in several module APIs appear to delete sheet rows and then audit separately. Confirm they are protected by shared locking and cache invalidation; centralize where they are not.
- API inventory scanning found no obvious missing assertion in the sampled WBS depth compatibility endpoint (it calls the privileged WBS assertion), nor in the project-module report endpoint (it asserts module view permission and filters by project).

This update remains a targeted static review; it does not substitute for execution-based testing, full taint analysis, or a security assessment of deployment settings and Apps Script scopes.


## Phase 1 remediation status update (2026-11-28)

### PMO snapshot insertion integrity — PR #100
- **Change under review:** snapshot ID allocation and sheet append are serialized under a script lock; lock release is in a `finally` block.
- **Collision prevention:** the code locates the `Snapshot_ID` column by header, reads existing IDs while holding the lock, and retries generated six-digit suffixes when a collision is detected.
- **Regression coverage:** static source tests plus a Node mocked-runtime test exercise header-column mapping, collision retry, lock-before-append, release-before-audit ordering.
- **CI:** latest branch commit `5ead126d78cac52c18ec970cdaa99a15765f07c1` passed both push and PR checks. This is a mocked runtime, not execution inside Google Apps Script.
- **Status:** open PR; not merged or deployed. Real Apps Script concurrency/runtime validation remains pending.
- **Known limitation:** the business-data append and subsequent audit-log insert are not atomic across sheets. An audit failure can occur after the snapshot row has been written; this remains a tracked reliability issue.

The remediation is narrowly scoped and does not establish that other table IDs are protected from concurrent allocation. The broader ID-generation finding remains open until creation handlers are inventoried and tested.


### Bulk insert cache invalidation — remediated in PR #100
- The initial observation was that `insertRecords_` did not invalidate cacheable-table caches after bulk writes.
- Call-site inventory found the current bulk helper use is for `Project_Assignments`, which is not in the cacheable-table list; no current cacheable-table caller was identified.
- **Remediation:** `insertRecords_` now calls `invalidateTableCache_(tabName)` after the successful bulk write, preventing stale cache if future bulk callers use a cacheable table.
- Added a regression test in the PR workflow. This is a preventive fix; the initial observation was not confirmed as a current user-impacting defect.


### Direct project-record deletion — remediation in PR #100
- Targeted source inventory identified five API deletion paths using `sheet.deleteRow(existing._rowIndex)` after a prior table read: registry records, weekly reports, team workload, procurement, and financial records.
- This pattern could act on a stale row index if concurrent operations shift rows between the read and delete, and it bypassed the shared locking/cache invalidation helper.
- **Remediation:** all five paths now call `deleteRecordsByIds_`, which locates rows by ID under a script lock and invalidates applicable caches. A regression test asserts these APIs use the shared helper instead of row-index deletion.
- Audit log writes remain after the deletion and are not part of a cross-sheet transaction; that limitation remains.

### General ID allocation — remediation in progress (PR #101)
- Initial source inventory identified 14 `generateNextId_` call sites in `Code.gs`.
- **Refactored in PR #101:** all 14 `Code.gs` create paths now use `insertRecordWithGeneratedId_`, including users, projects, creator assignments, Main/Sub WBS, activities, dependencies, baselines, project-controls registries, progress logs, weekly reports, workload, procurement, and financial items. WBS default codes are assigned in the helper callback before append; duplicate-code checks for new WBS rows run inside the lock.
- Helper behavior: ID column is header-mapped and read directly from the sheet; ID assignment and append are performed while holding ScriptLock; lock is released in `finally`; optional callback derives dependent fields before append.
- **CI:** the six-test workflow passed on the latest recorded CI run for the current remediation branch. This is Node mocked/static validation, not Apps Script runtime or true multi-request concurrency testing.
- **Security-layer remediation in PR #101:** permission IDs, password credential IDs, auth-session IDs, and audit-log IDs now use the same lock-protected helper. Credential username uniqueness is checked inside the helper's lock callback before insert.
- **Repository callsite inventory:** no remaining callsites of `generateNextId_` were found in Code.gs, Security.gs, InitialSetup.gs, WbsDiagnostic.gs, index.html, or Presentation.html. The legacy function definition remains in Database.gs but is no longer called by the inspected source files.
- **Baseline revision concurrency:** the baseline revision is now calculated inside the ID-allocation lock after invalidating the table cache, so concurrent baseline creates serialize their revision-number calculation and insert.
- **Status:** generated-ID callsites remediated in draft PR #101. User/credential creation is serialized under one lock and rolls back the user row if credential creation fails. CI passed after the Security.gs refactor (`4d80e9f`), repository-wide legacy-callsite guard (`578363b`), and baseline revision concurrency refactor (`0d1ef8f`). Runtime Apps Script tests, true concurrent requests, baseline revision concurrency, and wider integrity checks remain open.


### General ID allocation — remediation design and acceptance criteria

**Proposed safe remediation (separate targeted PR):**
1. Add a database helper that acquires the script lock, reads the ID column directly from the sheet (not from cache), computes the next ID, assigns it to the record, and performs the append while retaining the same lock.
2. Make the helper release the lock in `finally`, including failures in ID calculation or append.
3. Refactor create-only paths first, then mixed create/update handlers individually. Preserve caller-provided IDs only where the existing API intentionally supports them; validate uniqueness under the lock before write.
4. Keep existing update paths unchanged and preserve permission checks, project ownership validation, field allowlists, and audit events.
5. Add mocked-runtime tests for concurrent requests, duplicate/collision detection, lock release on write failure, header mapping, and custom-ID handling. Include static inventory coverage so every generated-ID creation path uses the atomic helper.

**Acceptance criteria:** all generated IDs are unique under concurrent create calls; allocation and write occur under one lock; failure releases the lock; all 14 generation call sites are accounted for; API behavior and ID formats remain compatible; full CI passes. Apps Script runtime testing remains a separate required gate.


### Direct mutation audit — additional Phase 1 remediation (PR #101)
- **Escalations:** upsert previously used direct `setValue` / `appendRow` with row-index updates. It now holds a ScriptLock, checks IDs under the lock, rejects ambiguous duplicate IDs, and uses shared ID-based insert/update helpers.
- **Client presentations:** sheet/header initialization is serialized; deck ID collision check and insert are serialized; writes use `insertRecord_` instead of direct `appendRow`.
- **Phase 18/19 headers:** reentrant locking added around sheet/header creation to avoid concurrent initialization races.
- **Auth table headers:** credential/session sheet creation and missing-column initialization are serialized under a reentrant script lock.
- **Database reset/import:** source inspection confirms destructive reset and import operations acquire a script lock and create a full backup before data-clearing/replacement writes. Backup restore testing and failure/rollback verification remain pending.
- **Additional safeguards:** project creation/custom-ID validation and creator assignment are serialized; the project row is rolled back if assignment insertion fails. Main/Sub WBS update uniqueness checks are revalidated under lock. Escalation updates reject cross-project ownership changes and include previous-state audit snapshots. PMO digest trigger configuration serializes script-property and trigger mutations. Password-login failed-attempt increments use refreshed credential state under lock and revalidate user/credential eligibility before session creation. Trusted-admin allowlist read-modify-write is serialized.
- **Security verification:** Google ID-token login validates audience, issuer, verified email, expiry, and required subject claim. Password failed-attempt counters and trusted-admin allowlist updates are serialized.
- **Runtime-mocked auth validation:** password login tests cover fifth-failure lockout, successful counter reset/session creation, and revalidation when the credential hash changes between reads. Google ID-token validation checks audience, issuer, verified email, expiry, and subject.
- **Status:** targeted source changes and regression tests pass in CI on head `12f4186` (43 tests, 0 failures). Snapshot metrics and append are protected by the same lock; full backup copies serialize with database writes. Progress-log create/edit and review/approval now serialize the log, audit, activity update, and project rollup operations under one ScriptLock. These are Node mocks/static tests, not Apps Script runtime testing or true concurrent-request validation.


### Known cross-sheet transaction / rollback gaps
- Activity create/update and predecessor-dependency synchronization are separate sheet writes. A failure during dependency synchronization can leave the activity and dependency history partially updated.
- Daily progress-log writes, schedule-activity actual-progress updates, and project rollup recalculation are separate operations. Failure can leave partial state.
- Project deletion cascades across multiple sheets under a lock but has no full rollback if a later sheet delete fails.
- Business writes and audit-log inserts are not a cross-sheet transaction; an audit-log failure after a business write may cause an API error while the business record remains persisted.
- Database reset/import are backup-first and locked, but replacement is not transactional across sheets. Restore procedure and rehearsal are required before production use.
- **Status:** these gaps are documented in the Phase 1 runtime test plan and remain acceptance blockers; do not claim atomic cross-sheet transactions.


### Additional concurrency findings for Phase 1 follow-up
- **Dependency-cycle race — remediated in PR #101:** activity predecessor validation, activity writes, and dependency synchronization now run under one ScriptLock. Failed dependency synchronization attempts roll back the activity and dependency rows. Live concurrent-request verification remains pending.
- **Progress rollup partial-failure risk — open:** progress-log save/review, audit append, activity update, and WBS rollup are now serialized under a ScriptLock, reducing interleaving races. A failure after an earlier write can still leave a partial multi-sheet state; rollback or idempotent recovery and live runtime validation remain required.
- **Status:** progress rollup concurrency remains a high-priority integrity finding; runtime testing is still required for the dependency-cycle fix.