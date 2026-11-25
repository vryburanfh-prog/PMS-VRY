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
