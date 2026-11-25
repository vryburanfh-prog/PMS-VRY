# PMS-VRY Backup and Restore Runbook

Purpose: safely back up and restore the container-bound Google Sheets PMS database. Use a non-production copy for the first restore drill.

## 1. Before a release or destructive operation

1. Announce a maintenance window and prevent concurrent data entry.
2. Open the live master spreadsheet and verify it is the intended container-bound workbook.
3. In Drive, create a full spreadsheet copy named PMO_PRE_PHASE1_BACKUP_YYYYMMDD_HHMM (or use the pre-import/pre-reset backup created by the API).
4. Restrict the backup to trusted administrators; verify URL and file ID. Do not broaden sharing.
5. Compare table names, header rows, row counts and key fields. For formula-bearing tabs, check formula counts as well as values.
6. Record backup ID/URL, live workbook URL, script/deployment version and operator in the release record.

## 2. Built-in safeguards

- Database import validates matching tab headers and imported primary keys before writes.
- Import creates a full workbook backup before changing destination tabs.
- Import attempts compensating rollback from the backup if a destination write fails.
- Start-Fresh validates its allowlisted reset tabs, creates a backup before clearing, and preserves formulas in the reset range.
- Import/rollback formula preservation is in the draft stack and requires Apps Script staging verification.

## 3. Restore data from a compatible backup

Use only when the backup is a compatible spreadsheet with matching headers:

1. Confirm maintenance mode and trusted Administrator/Database Transfer permissions.
2. Verify backup ID/URL and source/target workbook identities. Never import the live workbook into itself.
3. Run apiImportDatabaseFromGoogleSheet(backupSpreadsheetId) through the administrator database-transfer UI/API.
4. Review updated-tab counts, the new pre-import backup URL/ID and any audit warning.
5. Validate security tabs, project counts, IDs, formulas and key cross-record links.
6. Test login, project access, CRUD and reports before ending maintenance.

The import only restores tabs whose names and headers match. It is not a whole-file restore and does not restore Apps Script code, deployment settings, sharing settings, Drive permissions or missing/mismatched tabs.

## 4. Full workbook/manual restore

If headers differ, tabs are missing, or code/deployment settings need restoration:

1. Stop data entry and triggers; capture current state as another backup.
2. Work with the owner to copy required sheets from the backup into the live container-bound workbook, preserving tab names and formulas.
3. Do not replace/delete the live container-bound workbook without a deployment/ownership plan: the web app is bound to the active spreadsheet and code context.
4. Reconcile security/configuration tabs separately. Never overwrite trusted-admin settings or credentials without explicit approval and a security plan.
5. Verify formulas, headers, keys, data counts, permissions, audit history, assignments and deployment identity.
6. Re-open the Web App, run smoke tests and record who approved the restore.

## 5. Restore drill

Perform on a sandbox copy only:

- Create a test backup.
- Create/edit/delete sample project-control records.
- Import the backup into the sandbox using the compatible import path.
- Verify primary-key uniqueness, formula cells, formula-like text, row counts and audit behavior.
- Force/simulate a failed import to exercise rollback.
- Record missing data, formula changes, rollback errors, elapsed time and corrective actions.

Never perform a production restore or database reset without explicit owner approval.