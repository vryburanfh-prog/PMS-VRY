# Phase 1 — Generated ID Allocation Inventory and Remediation Plan

**Status:** Full source inventory of 19 generated-ID call sites across Code.gs and Security.gs is migrated to atomic helpers. Code.gs-only CI passed; consolidated CI for the Security.gs expansion is pending.  
**Scope:** Data-integrity remediation only. This document does not change application code or production data.

## Finding

`generateNextId_` reads the current maximum ID and returns the next value without holding a lock. The caller typically inserts separately through `insertRecord_`, whose lock protects the append but not the preceding ID allocation. Two concurrent create requests can therefore calculate the same ID before either append completes.

PR #100 adds a lock-protected ID allocation specifically for PMO snapshots. This is not a general solution for the other creation paths listed below.

## Call-site inventory

| API / function | Table | ID column | Prefix | Padding | Create/update behavior |
|---|---|---|---|---:|---|
| `apiCreateUser` | Users | User_ID | USR | 3 | Create-only |
| `apiCreateProject` | Projects | Project_ID | PRJ | 3 | Supports caller-supplied Project_ID; duplicate check |
| `apiCreateProject` | Project_Assignments | Assignment_ID | ASG | 4 | Creator assignment created after project insert |
| `apiSaveMainWbs` | Main_WBS | Main_WBS_ID | MWBS | 3 | Create/update |
| `apiSaveSubWbs` | Sub_WBS | Sub_WBS_ID | SWBS | 3 | Create/update |
| `apiSaveActivity` | Activities_Schedule | Activity_ID | ACT | 4 | Create/update |
| `apiSaveActivity` | Schedule_Dependencies | Dependency_ID | DEP | 4 | Creates predecessor link after activity write |
| `apiCreateProjectBaseline` | Project_Baselines | Baseline_ID | BL | 3 | Create-only; revision number also calculated separately |
| `apiSaveProjectControlRecord` | Registry table by config | Configured ID column | Configured prefix | Configured | Create/update |
| `apiSaveProgressLog` | Progress_Updates | Log_ID | LOG | 4 | Create/update |
| `apiSaveWeeklyReport` | Weekly_Reports | Report_ID | WKR | 4 | Create/update |
| `apiSaveTeamWorkloadAssignment` | Team_Workload | Assignment_ID | WASG | 4 | Create/update |
| `apiSaveProcurementItem` | Procurement_Logistics | Procurement_ID | PRC | 4 | Create/update |
| `apiSaveFinancialItem` | Financial_Monitoring | Financial_ID | FIN | 4 | Create/update |
| `applyManagementViewAllPagesPolicy_` | Role_Permissions | Permission_ID | PRM | 4 | Add missing Management permissions |
| `createPasswordCredential_` | Auth_Credentials | Credential_ID | CRD | 5 | Create-only |
| `apiLoginWithPassword` | Auth_Sessions | Session_ID | SES | 6 | Session creation |
| `apiLoginWithGoogleCredential` | Auth_Sessions | Session_ID | SES | 6 | Session creation |
| `writeAuditLog_` | Audit_Logs | Audit_ID | AUD | 5 | Audit append |

**Initial Code.gs inventory:** 14 call sites in 13 API/function paths. The project-create path allocates two IDs in separate tables; the activity-save path can allocate an activity ID and a dependency ID. The broader Security.gs inventory adds five more calls. All 14 call sites have now been migrated to atomic insert helpers. A static inventory gate verifies that `generateNextId_` has no remaining callers in `Code.gs`.

## Proposed remediation architecture

Add a narrowly scoped database helper that performs the following in one script-lock critical section:

1. Acquire the script lock with a bounded wait.
2. Read the target sheet's ID column directly from the sheet (not cache).
3. Compute the next formatted ID using the existing prefix and padding conventions.
4. Check for collision and retry/advance if necessary.
5. Assign the ID to the record and append the row using header-based mapping while retaining the lock.
6. Invalidate any applicable cache after successful insertion.
7. Release the lock in `finally`, including when read/write fails.

Do not use a helper that only locks ID generation and then releases before insertion; that would leave the race intact.

## Safe rollout sequence

- **Stage A — helper + harness:** completed. Both generated-ID and caller-supplied-ID insert helpers are implemented. Tests cover ID-column/header mapping, generated ID assignment, lock/read/write ordering, duplicate supplied-ID rejection, and lock release after write failure.
- **Stage B — create-only handlers:** completed. User and project baseline create-only paths migrated.
- **Stage C — mixed create/update handlers:** completed. Weekly report, team workload, procurement, financial, progress log, Main WBS, Sub WBS, project-control registry, and activity create branches migrated; update paths remain unchanged.
- **Stage D — multi-record/multi-table paths:** completed for ID atomicity. Project creation uses atomic generated-ID insertion or locked supplied-ID insertion; creator assignment and activity dependency IDs use atomic insertion. These multi-write operations remain non-transactional across tables.
- **Stage E — inventory gate:** completed. Static tests confirm no active `generateNextId_` call sites remain in `Code.gs` or `Security.gs`; the legacy allocator declaration remains in `Database.gs` for compatibility.
- **Stage F — Apps Script runtime test:** pending. Validate against a non-production test spreadsheet/deployment. Mocked Node tests do not prove actual Apps Script runtime or concurrent behavior.

## Acceptance criteria

- ID allocation and row insertion share one lock for every migrated generated-ID creation path.
- IDs remain unique when simultaneous creates target the same table.
- Existing prefix/padding and documented caller-supplied-ID behavior remain compatible.
- Lock is released after exceptions.
- Header mapping is used; no column-order assumption is introduced.
- All 14 inventory call sites are migrated, tested, or justified as an explicit exception.
- Authorization, project ownership, validation, and audit behavior remain intact.
- All CI tests pass; Apps Script runtime validation is recorded separately.
- No deployment or direct changes to `main` are made by this remediation work.
