# PMS-VRY Backup, Restore, and Recovery Runbook

**Status:** Draft operational guidance. No backup or restore has been executed as part of this modernization work.

## 1. Purpose and scope

Use this procedure before any database import, destructive reset, deployment with schema changes, or other high-impact operation. The PMS database is a Google Sheets spreadsheet used by the bound Apps Script project. This runbook does not authorize a live reset, restore, or deployment.

## 2. Roles and prerequisites

- A designated administrator authorized for database-transfer operations.
- Confirmed access to the live database spreadsheet and Google Drive backup folder/location.
- A maintenance/change window with affected users notified.
- A known-good backup and a separate recovery/test spreadsheet.
- The current database schema/header inventory and test plan.
- A change record with reason, operator, timestamps, and rollback decision.

Never place backup IDs, OAuth tokens, passwords, or other secrets in public issue comments or logs.

## 3. Create and verify a backup before changes

1. Record the live spreadsheet name and ID in the restricted change record.
2. Use the authorized admin interface's **Create Database Backup Copy** action (source endpoint `apiCreateDatabaseBackupCopy`). It copies the entire spreadsheet to Drive with a timestamped `PMO_DATABASE_BACKUP_` name.
3. Record the returned backup ID, URL, timestamp, and operator.
4. Open the backup URL with the intended recovery administrator and confirm access.
5. Verify expected database tabs and headers exist. Record row counts for key tables (Projects, WBS, Activities, Dependencies, Baselines, Financial Monitoring, Audit Logs, Users, Permissions, Auth Credentials, and Auth Sessions).
6. Confirm that the backup copy is distinct from the live database and that its contents are readable.
7. If backup verification fails, **stop**. Do not proceed with import, reset, or deployment.

A template copy (`apiCreateDatabaseTemplateCopy`) contains headers only; it is not a backup and cannot restore operational data.

## 4. Pre-change checks

- Confirm all expected source/destination tabs and exact headers.
- Confirm the source is not the live spreadsheet ID.
- Verify record IDs, project links, WBS relationships, and key counts in a test copy.
- Test login, role permissions, project assignment scoping, and read-only dashboards.
- Verify the change/rollback plan, test evidence, and communication are ready.
- Do not use the production import/reset endpoints to test formula injection, failure handling, or concurrency.

## 5. Database import behavior and safeguards

The current import endpoint (`apiImportDatabaseFromGoogleSheet`) reads the source and target tabs for configured database names, validates exact header equality, prepares a plan, creates a pre-import full spreadsheet backup, then replaces row data for each matching tab. Source tabs missing from the configured list are skipped; therefore, verify the source contains every intended tab and no unintended omissions before importing.

- The import is not a transactional multi-tab operation. If a write fails partway through, some destination tabs may already have changed.
- Matching headers are necessary but not sufficient: validate relationships, IDs, formulas, and data quality in a disposable copy first.
- The formula-like-text sanitizer in draft PR #5 should be runtime-tested in a copy before being relied on.
- A successful response is not a restore-validation report. Recheck data counts, links, formulas, permissions, and critical calculations after import.

## 6. Recovery/restore procedure (test environment first)

There is no dedicated atomic restore endpoint. Recovery is performed using spreadsheet copies and the authorized import workflow.

1. Preserve the incident spreadsheet and do not continue editing it while recovery is being assessed.
2. Create a **new recovery spreadsheet copy** from the verified backup. Do not immediately replace or rename the live database.
3. Verify tabs, headers, data row counts, critical formulas, relationships, IDs, and audit/security records in the recovery copy.
4. Test the PMS against the recovery copy in an isolated environment. Confirm the bound Apps Script database resolution points to the intended copy; do not deploy or expose the test app to users.
5. If a live restore is later approved, record explicit approval and a maintenance window. Create and verify a fresh backup of the current live spreadsheet immediately beforehand.
6. Use the authorized import workflow only after confirming source and destination IDs, tab/header plan, and recovery approval. The import will create another pre-import backup.
7. Validate the imported live data with the agreed checklist; verify user access and project scope; document the result and rollback decision.

If the import fails partway, stop all writes, preserve both source and destination, retain the backup IDs, and restore/repair in a cloned environment first. Do not repeatedly rerun an import against live data without reconciling which tabs were already written.

## 7. Start Fresh (destructive reset) checklist

The `apiStartFreshDatabase` endpoint requires database-transfer administrator authorization and the exact confirmation text `START FRESH`. It validates the reset tab list and creates a full pre-reset backup before clearing operational tabs.

Before any reset:
- [ ] Change approval and maintenance window are recorded.
- [ ] Full backup copy is created and verified.
- [ ] Reset scope is reviewed against the explicit operational-tab allowlist.
- [ ] Security, users, credentials, sessions, permissions, system settings, and audit logs are confirmed to be preserved by the intended reset.
- [ ] A dry-run/reset test in a disposable spreadsheet has succeeded.
- [ ] Post-reset initialization and user acceptance checklist is ready.

**Never run Start Fresh on the live database as a test.** The reset endpoint is not a restore mechanism.

## 8. Post-change verification and sign-off

- [ ] Expected table row counts and key IDs are verified.
- [ ] Project-to-WBS/activity/dependency relationships are valid.
- [ ] Baselines, progress roll-up, financial values, and dashboard summaries are reconciled.
- [ ] Formulas are preserved and formula-like imported strings are literal.
- [ ] Authentication, roles, assignments, and project scope are verified.
- [ ] Backup and recovery copy remain accessible.
- [ ] Audit record and change notes are complete.
- [ ] Users are informed when service is restored.
- [ ] Any unresolved discrepancies are logged with owner and due date.

## 9. Evidence to retain

Keep in the restricted change record: backup spreadsheet ID/URL, source/destination IDs, operator/approver, timestamps, tab/header validation results, row counts, test results, incident/error details, post-change reconciliation, and rollback decision. Do not retain secrets or sensitive source rows in public tickets.

## 10. Recovery for partial user/project creation

The current create workflows span multiple sheet writes and Script Properties updates. They are **not transactional**; a later step can fail after an earlier record was committed. Do not repeatedly retry the create request without first reconciling state, because a retry may create a second record or compound the partial state.

### 10.1 User creation (`apiCreateUser`)

The workflow can create a Users row, add a trusted-admin email for an Administrator, create password credentials (for non-admin password users), synchronize project assignments, and write the audit record. On a reported failure:

1. Stop retrying the create request and preserve the execution error/time in the restricted incident record.
2. Search by normalized email and, if password login was requested, by username. Identify the created `User_ID`; do not guess from the newest row.
3. Reconcile the user profile, credential row (if applicable), and active Project_Assignments by stable IDs. Confirm assignment references point to existing projects.
4. For a partial profile that should be rolled back, use the authorized administrator delete-user workflow with the exact `User_ID` confirmation. It revokes sessions and removes credential/assignment rows while retaining an audit history. Never remove the last active trusted Administrator; ensure another verified admin is available before cleanup.
5. If the account is intended to remain, complete missing credential/assignment steps through the supported administrator UI/API, then verify login and project scope. Review trusted-admin allowlist membership for an Administrator through the trusted maintainer procedure; do not edit Script Properties casually.
6. Record the final reconciliation, including which records were retained or removed. If a credential or assignment cannot be reconciled safely, disable/contain access and escalate to the Apps Script maintainer.

### 10.2 Project creation (`apiCreateProject`)

The workflow creates the Projects row, creates a creator Project_Assignments row, then writes an audit entry. On a reported failure:

1. Stop retrying and search the Projects table for the exact `Project_ID`/project name created by the request; verify identity from the request timestamp and operator.
2. If the Projects row exists, inspect active Project_Assignments for the creator and that `Project_ID`. A missing assignment can make the project inaccessible to the creator even though the project record exists.
3. Use the Administrator `apiUpdateUser` workflow to synchronize the creator's assigned-project IDs (the endpoint updates active Project_Assignments), then validate role/scope. Do not create a duplicate project to “fix” the failure.
4. If a project row is not intended to remain, preserve the incident copy and ask the authorized maintainer to determine a safe cleanup path. The reviewed source does not provide a verified transactional rollback for project creation; avoid manual row deletion or edits on the live spreadsheet.
5. Verify project access, assignment role, key dashboard/module reads, and audit evidence before closing the incident.

### 10.3 Verification and prevention

- Run failure-injection cases MUT-22 and MUT-23 only in a disposable spreadsheet/deployment.
- Retain a verified pre-test backup and reconcile row counts/IDs before and after each injected failure.
- Document whether each failure is recoverable through supported APIs or requires maintainer intervention. Do not represent compensating recovery as atomic rollback.
- A future implementation should define explicit operation status/idempotency keys or a compensation strategy before attempting automated rollback across sheets.
