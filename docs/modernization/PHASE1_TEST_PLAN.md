# Phase 1 — Security, Integrity & Validation Test Plan

**Status:** Prepared for execution. This is a test plan, not evidence that tests have passed.  
**Scope:** Google Apps Script backend, Google Sheets data store, web UI, published client deck endpoint.  
**Environment requirement:** Run tests only in a dedicated copy of the spreadsheet and Apps Script deployment. Never use production records for destructive or concurrency tests.

## 1. Test prerequisites and safety

- [ ] Create a test spreadsheet copy and record its ID in a restricted test log (do not commit IDs or credentials).
- [ ] Create a test deployment/environment with separate script properties, OAuth configuration, and test users.
- [ ] Export a pre-test backup and verify that it can be opened and restored into a disposable test copy.
- [ ] Identify test accounts for Administrator, Project Director, Project Manager, Assistant Project Manager, Management, and Project Team Member.
- [ ] Confirm test project assignments, unassigned projects, and a second project for cross-project access tests.
- [ ] Ensure logs and screenshots contain no passwords, session tokens, Google ID tokens, or sensitive personal data.

## 2. Verification matrix

| ID | Area | Test | Expected result | Status |
|---|---|---|---|---|
| SEC-01 | Login | Valid credentials | Authenticated session created; role and scope correct | Not run |
| SEC-02 | Login | Invalid password / unknown account | Generic failure; no account enumeration | Not run |
| SEC-03 | Login throttle | Repeated failures, threshold and lock window | Lockout enforced; behavior is atomic; no easy reset/bypass | Not run |
| SEC-04 | Sessions | Expired, revoked, malformed, or replayed session | Rejected consistently | Not run |
| SEC-05 | Google sign-in | Bad signature/audience/issuer, expired token, unverified email, malformed tokeninfo response | Rejected; no token/secret logged | Not run |
| AUTH-01 | Endpoint guards | Invoke every API without a session | Protected endpoints reject; documented public endpoints only | Not run |
| AUTH-02 | Role policy | Call each API as each role, including UI-bypassed calls | Server policy enforced, not just hidden UI | Not run |
| AUTH-03 | Project scoping | Read and mutate records in assigned and unassigned projects | No cross-project access; mutation rejects unauthorized IDs | Not run |
| AUTH-04 | Privilege boundaries | Attempt to assign Administrator role, edit permissions, or alter protected settings as lower role | Denied server-side | Not run |
| DB-01 | IDs | Simultaneous creates for each ID-prefixed entity | Unique IDs, no overwritten or duplicate records | Not run |
| DB-02 | CRUD | Create/update/delete using missing, duplicate, malformed, and unknown fields | Clear validation; no unintended field/row mutation | Not run |
| DB-03 | Audit | Force audit write failure after business mutation | Defined transaction/compensation behavior; no silent unaudited critical change | Not run |
| DB-04 | Cache | Update/delete then immediately read cached table/API | Fresh values returned; cache invalidated consistently | Not run |
| DB-05 | Formula injection | Submit text beginning with =, +, -, or @ into free-text fields; inspect exported/opened sheet behavior | Text remains inert; no executable formula injection | Not run |
| IMP-01 | Import | Malformed file, missing/extra columns, invalid types, duplicate IDs | Import rejected or safely normalized; error report identifies issue | Not run |
| IMP-02 | Import | Import with formula payloads and cross-project values | No formulas execute; scope/validation enforced | Not run |
| IMP-03 | Backup/restore | Create backup; restore into a disposable copy; compare tables and key counts | Backup is complete and usable; documented restore steps succeed | Not run |
| IMP-04 | Destructive reset | Confirm authorization, exact confirmation text, backup prerequisite, lock behavior | Reset blocked unless all controls pass; backup completed first | Not run |
| PUB-01 | Client deck | Valid published token | Only intended published content returned | Not run |
| PUB-02 | Client deck | Invalid, revoked, unpublished, expired (if expiry supported) tokens | Rejected; no private project data leaks | Not run |
| UI-01 | XSS | Insert hostile strings into names, descriptions, comments, imported values; render in each relevant view | No script execution; safe contextual rendering | Not run |
| UI-02 | UX/errors | Malformed server response, timeout, permission failure | Safe and understandable error; no sensitive details exposed | Not run |
| PERF-01 | Scale | Representative dataset sizes; profile reads, writes, cache, exports | Execution time/quota headroom documented; no truncation or timeout | Not run |
| REG-01 | Regression | Smoke test all main modules and navigation | Existing behavior preserved in test environment | Not run |

## 3. Preliminary confirmed source observation: ID allocation is not atomic

Database.gs contains generateNextId_(), which scans current records and returns max numeric suffix + 1. The helper insertRecord_() independently serializes row appends using a Script Lock. Since ID generation and insertion are separate operations, that append lock does not by itself guarantee unique ID allocation across concurrent requests.

**Risk:** concurrent requests for the same table can read the same maximum suffix and compute the same ID before either inserts.

**Proposed remediation (separate code PR after call-site inventory):**
1. Identify every generateNextId_() call and its subsequent write path.
2. Refactor allocation + insertion into a single lock-protected operation, or introduce a lock-protected per-entity counter with recovery/consistency checks.
3. Ensure all code paths (single insert, bulk insert, imports, retries) follow the same allocation policy.
4. Add a concurrency test that launches simultaneous creates and asserts all IDs are unique and all expected rows exist.
5. Avoid broad mechanical replacements; review each entity's prefix, padding, and legacy ID format.

## 3A. ID-allocation call-site inventory (static scan)

The following ID-generator call sites were identified in Code.gs on the main branch during the source scan. This list is an initial inventory; follow-up should verify each write path and include IDs allocated outside this helper.

| API | ID prefix / entity |
|---|---|
| apiCreateUser | USR / User |
| apiCreateProject | PRJ / Project; ASG / Project Assignment |
| apiSaveMainWbs | MWBS / Main WBS |
| apiSaveSubWbs | SWBS / Sub WBS |
| apiSaveActivity | ACT / Activity; DEP / Dependency |
| apiCreateProjectBaseline | BL / Baseline |
| apiSaveProjectControlRecord | Registry-configured entity ID |
| apiSaveProgressLog | LOG / Progress Update |
| apiSaveWeeklyReport | WKR / Weekly Report |
| apiSaveTeamWorkloadAssignment | WASG / Workload Assignment |
| apiSaveProcurementItem | PRC / Procurement |
| apiSaveFinancialItem | FIN / Financial |

This is a static call-site inventory (14 occurrences, including APIs that allocate more than one ID), not a complete test or confirmed race reproduction. Prioritize concurrent creates for project, WBS, activities/dependencies, and module registry records; then verify all remaining API paths. The implementation should preserve each entity's prefix, padding, and existing legacy IDs.

## 3.4 Focused regression cases for Phase 1 security fixes

| ID | Test | Expected result | Status |
|---|---|---|---|
| IMP-08 | Import source text beginning with `=`, `+`, `-`, or `@`, including leading whitespace | Destination cells are stored as literal text, not formulas; numeric/date cells remain values | Not run |
| IMP-09 | Import formula-like text in multiple tabs, with a validation failure in one tab before writes begin | All header validation completes before any destination tab is changed; sanitizer is applied to planned imported rows | Not run |
| DECK-07 | Generate a new published deck and inspect stored/public response payload | Newly generated deck payload contains curated presentation fields only and omits raw fact packet | Not run |
| DECK-08 | Fetch an existing published deck whose stored JSON contains a `rawMetrics` field using a valid share token | Public endpoint response omits `rawMetrics`; curated deck rendering remains intact | Not run |
| DECK-09 | Fetch a published deck with invalid token, archived status, and valid token separately | Invalid/archive cases fail closed; only a published record is returned | Not run |

These cases cover the focused changes in the public-deck minimization and import formula-safety draft PRs. Static verification has been completed; live spreadsheet behavior and renderer compatibility still require isolated Apps Script execution.

## 3.5 Primary-key integrity regression cases

| ID | Test | Expected result | Status |
|---|---|---|---|
| ID-07 | Insert a record with a primary key already present in the same table | Insert helper rejects the duplicate before writing | Not run |
| ID-08 | Bulk insert contains duplicate IDs within the batch | Batch rejected before write | Not run |
| ID-09 | Two concurrent create requests produce the same max+1 candidate | One insert succeeds; the competing insert is rejected with duplicate-ID error rather than corrupting the table | Not run |
| ID-10 | Insert helper used on a mapped table with a missing primary-key header | Helper fails closed with a clear schema error | Not run |
| ID-11 | Create record on a table not listed in primary-key map | Existing insert behavior is preserved; coverage of nonmapped IDs must be separately reviewed | Not run |
| ID-12 | Concurrent audit log inserts reuse the same generated Audit_ID | Duplicate audit IDs are rejected; one write may fail and require retry | Not run |
| ID-13 | Concurrent password-credential/session creation reuses generated ID | Credential_ID and Session_ID duplicates are rejected by insert helper | Not run |
| ID-14 | Concurrent role-permission insert reuses Permission_ID | Duplicate Permission_ID rejected before insert | Not run |
| ID-15 | Insert into mapped primary-key table omits key value | Insert helper rejects missing primary-key value before write | Not run |

The primary-key guard draft PR #6 uses the Script Lock around duplicate detection and append. It prevents duplicate keys from being silently inserted, but it does not automatically retry ID generation after a collision; the competing create may return an error and require a retry. Runtime concurrency tests are still needed.

## 3.6 API authorization inventory — static scan and manual guard-path review

A source scan identified 66 `api*` functions in `Code.gs`. Fifty-six directly contained one of the recognized guard strings (`assertPermission_`, `assertPrivilegedManagementRole_`, or database-transfer/admin assertions). Ten did not contain those strings and were manually reviewed for guard paths or intentionally public behavior:

| Endpoint | Guard path / purpose | Test status |
|---|---|---|
| `apiGetSessionContext` | Authenticated session context only; returns unauthenticated response when absent | Not run |
| `apiGetBootstrapData` | Checks authenticated context; redacts user/settings data and exposes users only when permission allows | Not run |
| `apiGetProjectRegisterData` | `assertPageAccess_('Project_Register')`; filters by assignment/admin scope | Not run |
| `apiSetWbsRecordArchived` | `assertPrivilegedWbsRole_(projectId, 'edit')` plus record-project ownership assertion | Not run |
| `apiDeleteWbsRecord` | `assertPrivilegedWbsRole_(projectId, 'delete')` plus record-project ownership assertion and relationship checks | Not run |
| `apiSaveMainWbs` | `assertPrivilegedWbsRole_` for create/edit and ownership assertion on update | Not run |
| `apiSaveSubWbs` | `assertPrivilegedWbsRole_` for create/edit plus parent WBS ownership check | Not run |
| `apiSaveProjectWbsDepth` | `assertPrivilegedWbsRole_(projectId, 'edit')`; retained compatibility endpoint | Not run |
| `apiGetProjectReferenceNames` | Authenticated context and `assertProjectAssignment_`; project-filtered reference records | Not run |
| `apiGetPublishedClientDeckByToken` | Intentional public share-token endpoint; token format and published status are checked. Public payload minimization is tracked in draft PR #4 | Not run |

This is a static scan and manual call-path review, not proof that the server guards work. The API list must be rechecked against the deployed code and direct-call tests must verify unauthorized roles, project-scope mismatches, and public-token behavior. Some guard methods are helpers and therefore the static direct-string count undercounts guarded endpoints.

## 3.7 HTML interpolation and XSS regression cases

| ID | Test | Expected result | Status |
|---|---|---|---|
| UI-01 | Render the registry loading message with a label containing HTML markup | Label is rendered as escaped text, not interpreted markup | Not run |
| UI-02 | Render registry empty-state message with a label containing HTML markup | Label is escaped in the generated HTML | Not run |
| UI-03 | Review all dynamic `innerHTML` and template-string rendering paths for untrusted data | Every user/database-derived value uses context-appropriate escaping or DOM text APIs; findings tracked | Not run |

Focused escaping for the registry loading and empty-state labels is in draft PR #8. The broader `innerHTML` taint audit is not complete; static counts alone are not a vulnerability verdict or proof of safety.

## 3.8 CI regression runner status

Draft PR #7 adds a Node 20 GitHub Actions workflow to run source-level checks. The test-only branch run completed successfully: **1 baseline test passed, 0 failed, 6 skipped** (pending remediation branches). A temporary integrated-validation PR #11 combined all pending code fixes, including locked deletion helper use, and ran the suite with **10 passed, 0 failed, 0 skipped**. PR #11 was closed unmerged after validation; its CI result verifies static source assertions only, not Apps Script runtime behavior.

## 3.9 Backup/restore and destructive-operation verification

| ID | Test | Expected result | Status |
|---|---|---|---|
| BAK-01 | Create a full backup copy using the authorized admin endpoint | Copy ID/URL returned; copy is distinct, accessible, and contains all expected tabs | Not run |
| BAK-02 | Import with a header mismatch on one tab | Validation fails before any destination write; verify no tabs changed | Not run |
| BAK-03 | Import from a source missing configured tabs | Missing tabs are skipped; operator preflight must detect omissions and prevent unsafe import | Not run |
| BAK-04 | Inject a write failure during multi-tab import in a disposable copy | Partial-write behavior documented; recovery tested from verified backup | Not run |
| BAK-05 | Restore backup to a new spreadsheet and validate relationships/formulas | Recovery copy reconciles counts, IDs, relationships, formulas, auth/access, and calculations | Not run |
| BAK-06 | Start Fresh with incorrect confirmation string | Operation fails without data changes | Not run |
| BAK-07 | Start Fresh with correct confirmation in disposable database | Pre-reset backup exists; only allowlisted operational tabs are cleared; security/config/audit tabs are preserved | Not run |

Draft backup/recovery runbook PR #10 describes these procedures. Do not run destructive or recovery tests against live production; the Apps Script import is not transactional across tabs and no atomic restore endpoint exists.

## 3.10 Delete-helper consistency regression cases

| ID | Test | Expected result | Status |
|---|---|---|---|
| DEL-01 | Delete records from control registry, weekly report, workload, procurement, and financial modules | Each API uses the locked database delete helper; record lookup is by stable ID inside helper, not stale row index | Not run |
| DEL-02 | Delete with concurrent row changes in the same table | Helper locates record by ID under Script Lock; no wrong-row deletion from stale index | Not run |
| DEL-03 | Delete succeeds but audit-log write fails (fault injection in isolated copy) | Failure boundary is documented; recovery/compensation policy is validated | Not run |

Draft PR #12 routes five direct-delete paths through `deleteRecordById_`. This improves lock/cache-helper consistency but does not make the deletion and audit-log write transactional.

## 3.11 Escalation project-scope integrity regression cases

| ID | Test | Expected result | Status |
|---|---|---|---|
| SEC-16 | Privileged user updates an escalation ID belonging to another project while supplying their assigned project ID | Server rejects update; stored Project_ID and escalation content remain unchanged | Not run |
| SEC-17 | Update an escalation within the same assigned project | Update allowed only if role and project edit permission are valid; Project_ID cannot be reassigned by record-ID lookup | Not run |
| SEC-18 | Portfolio-level escalation update | Only portfolio/global scope can update an existing portfolio escalation; project escalation IDs cannot be overwritten as portfolio records | Not run |

Draft PR #13 adds a stored-project-versus-requested-project check before the upsert's row update/append path. Runtime authorization tests remain pending.

## 3.12 Phase 18/19 mutation helper regression cases

| ID | Test | Expected result | Status |
|---|---|---|---|
| MUT-19 | Create/update escalation through PMO management | Insert/update uses shared locked helper; ID uniqueness and row lookup protected; audit contains actual previous/updated snapshots | Not run |
| MUT-20 | Capture PMO snapshot concurrently with another capture | Snapshot insert uses shared locked helper; Snapshot_ID uniqueness enforced when primary-key guard is merged | Not run |
| MUT-21 | Fault injection after escalation/snapshot mutation but before audit insert | Failure boundary and compensation/reconciliation procedure verified | Not run |

Draft PR #14 refactors Phase 18/19 direct mutations to the shared insert/update helpers. Primary-key enforcement for these custom tables is included in draft PR #6 and should be merged/reviewed before the helper-integrity refactor.

## 4. Execution order

1. **Baseline and smoke tests:** backups, login, navigation, read-only module checks.
2. **Authorization:** endpoint/role coverage, project ownership and scope, admin-only operations.
3. **Data integrity:** CRUD validation, IDs, audit logs, cache consistency.
4. **Import/export/reset:** backups, recovery, destructive controls, formula safety.
5. **Published deck:** token validation and disclosure boundaries.
6. **UI security:** contextual escaping/XSS tests across rendering paths.
7. **Performance and regression:** dataset scale, quotas, and full module smoke test.

## 5. Exit criteria for Phase 1

- All critical/high-risk test cases pass in the isolated environment, or have an explicitly accepted mitigation and owner.
- No unresolved critical security or data-loss issue remains.
- ID allocation is proven unique under concurrent creates.
- Backup and restore are demonstrated, not merely documented.
- API authorization and project scoping are tested directly against server endpoints.
- Findings are linked to evidence and a remediation PR; all source changes receive review.
- Production rollout plan includes backup, change window, rollback, and post-deploy smoke tests.

## 6. Current limitations

This matrix has not been executed. The current audit is source-level inspection using repository files. Runtime behavior, deployment configuration, spreadsheet permissions, Script Properties, OAuth configuration, and real concurrency behavior require an authorized isolated test environment.
