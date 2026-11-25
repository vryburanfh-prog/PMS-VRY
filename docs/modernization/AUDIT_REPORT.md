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

## Supplemental Phase 1 source review (2026-11-25)

### S1 — P2: Multi-step create operations can leave partial records
**Evidence:** `apiCreateUser` inserts the Users row before creating password credentials, syncing project assignments, and writing audit logs. `apiCreateProject` inserts the project row, then creates an assignment row and continues with follow-up work. These are separate spreadsheet writes and no rollback/compensation flow was visible in the reviewed portions.
**Impact:** A later failure can leave a user/project partially provisioned (for example, a user without expected credential/assignment rows, or a project without its creator assignment).
**Recommendation:** Treat multi-sheet create workflows as sagas: validate all inputs first, write each step with clear status, compensate or provide a repair routine for failures, and ensure audit events capture partial completion. Add fault-injection tests at each write boundary. Do not claim Sheets multi-sheet writes are transactional.
**Status:** Source-level observation; failure reproduction and exact affected steps need runtime validation.

### S2 — P2: Audit and cache consistency for direct row mutations
**Evidence:** Some project-control and financial deletion paths directly call `sheet.deleteRow(...)` then audit separately. The targeted code paths did not show a common lock/cache invalidation helper at those call sites.
**Impact:** Concurrent mutation risk and potentially stale cached data; audit may be absent if the audit write fails after deletion.
**Recommendation:** Inventory all direct spreadsheet mutations. Centralize row deletion/update in helpers that lock, invalidate the correct caches, and return the deleted snapshot. Add audit-failure recovery/alerts.
**Status:** Needs complete mutation-path inventory and tests; not yet proven to cause user-visible corruption.

### S3 — API inventory reconciliation (static)
A regex inventory of `Code.gs` found 66 `api*` function declarations. The Security.gs private dashboard allowlist also contains 66 names. The comparison reported `apiGetPublishedClientDeckByToken` as a Code.gs API declaration outside the private allowlist, and `apiLoginWithGoogleCredential` as an allowlist entry not declared in Code.gs. Inspection indicates these are expected special cases: published deck retrieval is a token-based public endpoint, while Google credential login is implemented in the security/auth file. This count check is a useful automated consistency test, but it is not proof of endpoint authorization: classify public endpoints separately, include all source files in inventory, and test all calls directly.

### S4 — P1 investigation: Duplicate-ID race needs explicit unique enforcement
The ID generator scans existing records and calculates max+1. `insertRecord_()` serializes append operations but does not appear to enforce uniqueness of the entity ID column. A collision can therefore be inserted if two requests calculate the same identifier before the append lock. Proposed fix remains a single lock-protected allocate+insert or equivalent counter with uniqueness validation and concurrency test.

**Recommended order:** Implement and test ID allocation first; next add multi-step create recovery/compensation; then centralize direct delete/update mutations and cache invalidation; proceed with broader auth, XSS, import/export, and restore testing.

### S5 — Frontend rendering surface inventory (static counts)
A regex scan of the current `main` versions of `index.html` and `Presentation.html` counted 128 and 124 assignments to `.innerHTML`, respectively. It also counted 262 and 227 calls to `escapeHtmlSafe_()` in those files. The helper escapes HTML metacharacters, and a `safeJsArg_()` helper serializes then HTML-escapes string arguments. These counts show that escaping utilities are used, but **do not prove** the UI is XSS-safe: context-specific sinks, inline JavaScript/event attributes, URLs, template literals, and unsafe string composition require manual taint tracing and hostile-input runtime tests.

### S6 — P1/P2 review: Published client deck contains raw source metrics
**Evidence:** `apiGenerateClientPresentation` constructs `fullDeckPayload` with both generated slides and `rawMetrics: factPacket`, stores the entire payload in the client-deck sheet, and `apiGetPublishedClientDeckByToken` returns the stored `Deck_JSON` to anyone with the 32-hex share token while the deck is published. The token is UUID-derived (128-bit random format) and archive status is checked, which are positive controls. However, `factPacket` can include raw permit, deliverable, milestone, risk, and issue records depending on scope; these may include internal fields not meant for external clients.
**Impact:** Bearer-link holders can retrieve more underlying data than the curated slide text, especially raw risk/issue/permit records. The link is not authenticated and no expiry field was observed in the inspected path.
**Recommendation:** Store a minimized, client-approved payload only; remove `rawMetrics` from public response/storage or strip sensitive columns/fields by module; add a data classification/field allowlist and explicit publication review; add token revocation/expiry policy as appropriate. Test with internal-only field payloads to ensure public deck responses omit them.
**Status:** Confirmed public response includes the rawMetrics property in source; exact sensitive field exposure depends on source records and selected presentation scope, so validate against test data before assigning final severity.

### S7 — P1 investigation: Spreadsheet import may accept formula-bearing strings
**Evidence:** `apiImportDatabaseFromGoogleSheet` reads source cell values with `getValues()` and writes those values into destination cells with `setValues()`. Header checks and a pre-import full backup are present, but the inspected path did not show explicit formula/text sanitization or row-level schema validation before copying values.
**Impact:** Source values that are formula-like strings may be interpreted by Sheets when written to destination, depending on cell value and import content. Imports can also carry invalid relationships or unexpected values despite matching headers.
**Recommendation:** Validate row data against schemas; ensure text beginning with formula operators is stored as literal text (or rejected); test formula injection in a disposable copy; validate key uniqueness and foreign-key/project relationships; retain backup and recovery verification.
**Status:** Potential risk, not reproduced; import formula behavior requires runtime testing in Google Sheets.


## Remediation tracking (source review update)

| Finding | Remediation branch / PR | Source-level status | Runtime status |
|---|---|---|---|
| S6 public client deck may expose raw source metrics | `pms-modernization/phase1-public-deck-data-minimization`, draft PR #4 | New payload omits `rawMetrics`; public endpoint strips it from legacy snapshots; renderer has no reference to it | Not tested in Apps Script; live published links not checked |
| S7 formula-like imported strings may be interpreted as formulas | `pms-modernization/phase1-import-formula-safety`, draft PR #5 | Import rows sanitize strings beginning with `=`, `+`, `-`, or `@` (including leading whitespace) before destination writes | Not tested against live Google Sheets formula behavior |

The Phase 1 test plan draft (PR #2) now includes focused regression cases IMP-08/09 and DECK-07/08/09. These code changes remain review-only: neither PR has been merged or deployed. They are source-level mitigations, not evidence of runtime validation. Formula sanitization intentionally changes formula-like imported text to literal text and should be checked against expected import semantics in a disposable test spreadsheet.


### S8 — P1 investigation/remediation: duplicate generated IDs under concurrency
**Evidence:** `generateNextId_` scans records for max numeric suffix and returns the next value; generated IDs are often created before the insertion helper acquires its append lock. The insertion helpers previously serialized writes but did not check whether the supplied primary key already existed.
**Remediation branch / PR:** `pms-modernization/phase1-id-uniqueness-enforcement`, draft PR #6.
**Source-level change:** Primary-key duplicate checks were added to single and bulk insert helpers for mapped operational and authentication tables, including Audit_Logs, Auth_Credentials, Auth_Sessions, and Role_Permissions. Checks run while the Script Lock is held, before append; duplicate IDs in a bulk batch are also rejected. Missing mapped primary-key headers and missing primary-key values fail closed.
**Limitations:** This prevents duplicate keys from being silently inserted but does not make max+1 generation and insertion one atomic allocation operation, nor retry a collision. A concurrent create that loses the race may return an error and require a retry. Runtime concurrency testing and consideration of a lock-protected allocator/counter remain necessary.
**Status:** Source-only mitigation; runtime test not run.


### S9 — API authorization inventory: static scan reconciliation
**Evidence:** A fresh static scan of `Code.gs` identified 66 API functions. Fifty-six directly contain a recognized permission/admin assertion string. The remaining ten were manually reviewed for helper-based guard paths or intentional public behavior: session context, bootstrap, project register, WBS archive/delete/save/depth, project reference names, and published client deck token retrieval.
**Review notes:** The ten endpoints were not found to be unguarded merely because the static scanner did not find direct guard strings. The inspected source shows authentication/page-access/project-assignment/privileged-WBS helper checks for nine endpoints; the client deck share-token endpoint is intentionally public and checks token shape plus published status. The public payload data-minimization remediation is tracked in draft PR #4.
**Status:** Source-level call-path review only. Endpoint direct-call tests and deployed-code reconciliation remain outstanding. Test plan PR #2 now records the inventory and test cases.


### S10 — P2 defense-in-depth: unescaped registry labels in HTML templates
**Evidence:** Both `index.html` and `Presentation.html` interpolated registry module labels into loading and empty-state HTML templates without explicit escaping. The labels are normally controlled by registry configuration, reducing likelihood, but explicit escaping is warranted.
**Remediation:** Draft PR #8 applies `escapeHtmlSafe_` to both dynamic label interpolations in both HTML files.
**Status:** Source-only focused remediation. Runtime/browser tests and full dynamic HTML taint tracing remain outstanding; other innerHTML paths are not yet fully audited.


### S11 — P1 improvement: automated static security regression checks
**Remediation:** Draft PR #7 adds a Node 20 GitHub Actions workflow and source-level tests for the focused Phase 1 fixes. Tests for code fixes not yet merged into `main` skip with explicit pending-remediation messages; they will activate when the corresponding code is merged.
**CI evidence:** PR #7’s test-only CI run succeeded (1 baseline test passed, 0 failed, 6 feature tests skipped until remediation merges). A separate temporary integrated-validation PR #11 combined the pending source fixes and ran the same test suite: **7 passed, 0 failed, 0 skipped**. PR #11 was closed unmerged after collecting the CI result. This validates static source assertions only, not runtime Apps Script or Sheets behavior.
**Status:** CI workflow and runner are functional; fix-specific checks remain pending until their implementation PRs merge.


### S12 — P2 investigation: multi-step mutations and audit-log failure boundaries
**Evidence:** `apiCreateProject` inserts the project and then the creator's project-assignment record; the mutation and subsequent audit logging are separate helper calls without a visible transaction/compensation boundary. The audit writer generates an `Audit_ID` and inserts the audit record separately. Similar multi-step workflows require endpoint-by-endpoint review.
**Impact:** If a later write or audit-log write fails, an earlier business mutation may already be committed, while the caller receives an error or the operation may be incompletely represented in the audit trail. This is a data-integrity and accountability risk; failure scenarios have not been reproduced.
**Recommendation:** Add fault-injection tests for each step; define required mutation/audit guarantees; use a lock around logical multi-record operations where safe; design explicit compensating rollback or status/reconciliation records instead of assuming Sheets supports transactions. Add Audit_Logs to primary-key uniqueness checks (implemented in draft PR #6).
**Status:** Investigation; runtime fault-injection and recovery design pending.


## Current modernization PR tracker (review-only)

| PR | Workstream | Status | Validation summary |
|---|---|---|---|
| #2 | Phase 1 test plan | Open draft | Updated with import/deck/ID/UI/API authorization/CI regression test cases; runtime cases not run |
| #3 | Audit findings and remediation tracker | Open draft | Source-level evidence and remediation links |
| #4 | Public client deck data minimization | Open draft | Static source checks; no runtime share-link test |
| #5 | Spreadsheet import formula safety | Open draft | Static sanitizer-order check; runtime Sheets behavior unverified |
| #6 | Primary-key duplicate rejection | Open draft | Static insert-helper guard checks; concurrency runtime tests not run; mapped Auth_Credentials/Auth_Sessions/Audit_Logs included |
| #7 | Static security CI | Open draft | GitHub Actions run succeeded; 1 baseline test passed, 6 fix-specific tests skipped until implementation PRs merge |
| #8 | Registry label HTML escaping | Open draft | Static interpolation review only; broader XSS taint audit remains |
| #9 | Phase 2 project controls design | Open draft | Design/documentation only; current source findings documented |
| #10 | Backup/recovery runbook | Open draft | Source-based guidance; runtime recovery and failure-injection tests not run |
| #11 | Temporary integrated validation | Closed unmerged | CI passed 9/9 static regression tests with all Phase 1 source fixes combined, including locked deletes and escalation scope; closed after validation |
| #12 | Locked delete-helper consistency | Open draft | Source inspection; deletion helper tests not run in Apps Script |
| #13 | Escalation project ownership guard | Open draft | Source-level ownership check; runtime authorization test pending |



### S13 — P1 operational readiness: backup/recovery procedure not runtime-verified
**Evidence:** Source includes full spreadsheet backup-copy endpoint, import header checks and pre-import backup, and Start Fresh allowlist/backup. Import replaces matching tabs and skips missing source tabs; the multi-tab write loop has no rollback boundary. No dedicated atomic restore endpoint is present in the inspected source.
**Remediation:** Draft PR #10 documents pre-change backup verification, isolated recovery, import/reset safeguards, post-change reconciliation, and evidence retention. Draft PR #2 now includes BAK-01 through BAK-07.
**Status:** Runbook documentation exists on a draft branch; backup/restore and failure-injection tests have not been executed.


### S14 — P2 data integrity: five deletion APIs bypass the locked delete helper
**Evidence:** Direct `deleteRow(existing._rowIndex)` calls were found in Project Controls registry, Weekly Reports, Team Workload, Procurement, and Financial Monitoring deletion endpoints. These paths read a row index before deletion and delete directly without the shared Script Lock/ID re-lookup helper.
**Remediation:** Draft PR #12 routes those five endpoints through `deleteRecordById_`, which performs stable-ID lookup under Script Lock and existing cleanup/cache-invalidation behavior. The registry delete audit snapshot is cleaned of the internal row index.
**Limitations:** The business deletion and subsequent audit-log insert remain separate operations; no transaction/compensation is implemented. Runtime concurrency/fault-injection tests are pending.


### S15 — P1 investigation: escalation upsert lacked project-ownership validation
**Evidence:** `apiUpsertEscalationItem` checked the privileged-management role and edit permission for the requested `targetPid`, then located an existing escalation by `Escalation_ID`. The inspected path did not compare the stored record's `Project_ID` with the requested project/portfolio scope before updating the row, allowing a privileged user authorized for one project to potentially edit an escalation belonging to another project by ID.
**Remediation:** Draft PR #13 compares the existing escalation's stored project ID with the requested project or `PORTFOLIO` scope and rejects mismatches before update. Test plan PR #2 adds SEC-16 through SEC-18.
**Status:** Source-level fix; runtime direct-call tests and project-scope authorization confirmation remain outstanding. Severity is provisional until verified in an isolated environment.
