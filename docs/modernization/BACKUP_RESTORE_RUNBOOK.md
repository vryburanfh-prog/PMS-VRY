# PMS-VRY Backup and Restore Runbook

**Status:** Draft runbook — restore procedure has not yet been execution-tested.  
**Applies to:** PMS-VRY Google Apps Script + container-bound Google Sheets database.  
**Safety rule:** Perform the first restore rehearsal on a non-production spreadsheet copy. Do not restore to the live database without a separately approved recovery decision.

## 1. Backup types

| Operation | What it creates | Purpose |
|---|---|---|
| Create Database Backup Copy | Full copy of the current database spreadsheet | Manual recovery point before planned changes |
| Start Fresh Database | Full spreadsheet copy named `PMO_PRE_START_FRESH_BACKUP_*` before clearing allowlisted operational tabs | Recovery before a destructive reset |
| Import Database from Google Sheet | Full spreadsheet copy named `PMO_PRE_IMPORT_BACKUP_*` after source/header validation and before replacement | Recovery point before importing another database |
| Create Database Template Copy | New spreadsheet containing configured database tab headers | Blank schema template; **not** a data backup |

The full spreadsheet copy is the recovery source. The import endpoint copies configured `DB_CONFIG.TABS` tabs only. Custom/auxiliary tabs outside that configuration must be checked and restored separately.

## 2. Create a manual backup

1. Sign in as an authorized Administrator.
2. Open **Database Backup Copy** in the database administration area.
3. Run the backup and record the returned name, spreadsheet ID, and URL.
4. Open the backup copy and confirm that expected tabs and data are present.
5. Store the backup URL/ID in the approved project or operations recovery record.
6. Do not assume a backup is valid until it has been opened and checked.

## 3. Restore rehearsal — configured database tabs

1. **Create a test destination.** Make a copy of the current database spreadsheet and use it as the recovery-test destination.
2. Identify a backup copy and verify its source, timestamp, and expected contents.
3. Confirm that source and destination tab headers match exactly. The import API rejects header mismatches before it changes destination data.
4. From the authorized Administrator interface, run **Import Database from Google Sheet** using the backup spreadsheet ID.
5. The import operation creates a fresh full backup of its destination before replacing matching configured tabs. Record this pre-import backup too.
6. Wait for completion and record the returned updated-tab list and backup URL.
7. Verify row counts and representative records for Users, Projects, Assignments, WBS, Activities, Dependencies, Progress, Reports, Workload, Procurement, Financials, Permissions, Settings, and other configured tabs.
8. Confirm that IDs, project ownership links, dates, formulas, and authorization mappings are intact.
9. Re-open the application against the test destination and perform a read-only smoke test plus a controlled test create/update/delete using test data.
10. Document discrepancies. Do not proceed to live recovery until the rehearsal is reviewed and accepted.

## 4. Restore auxiliary/custom tabs

The database-import API copies only tabs listed in `DB_CONFIG.TABS`. Inspect the full backup for auxiliary tabs, including (where present):

- Escalations
- Client presentations / published decks
- Other custom or module-specific sheets not listed in the configured database tab map

For a full recovery, compare these tabs with the destination and restore their data/schema using a reviewed manual copy procedure or a future dedicated restore tool. Do not assume the configured-tab import restores them.

## 5. Recovery after Start Fresh

- Locate the `PMO_PRE_START_FRESH_BACKUP_*` copy created before the reset.
- Follow the configured-tab restore rehearsal steps above using that backup as the source.
- Start Fresh is an operational reset, not a restore function. It clears only its allowlisted operational tabs and preserves user/authentication/permission/settings/audit tabs.
- Verify the preserved tabs and restored operational data separately.

## 6. Recovery after a failed import

The import is lock-protected and validates matching source/destination headers before replacement. It still does **not** provide a cross-sheet transaction; a failure during replacement may leave a partially imported destination.

If an import fails partway through:

1. Stop further writes/imports.
2. Record the error, timestamp, source spreadsheet ID, destination, and any reported changed tabs.
3. Locate the `PMO_PRE_IMPORT_BACKUP_*` copy created immediately before the import.
4. Restore on a test copy first using the rehearsal procedure.
5. Compare every configured tab before considering a live recovery.
6. Review and approve recovery before running another import against production.

## 7. Post-restore acceptance checklist

- [ ] Recovery source identified and opened successfully.
- [ ] Source/destination schema and tab inventory reconciled.
- [ ] Configured-tab import completed successfully.
- [ ] Custom tabs restored/reconciled separately.
- [ ] Row counts and representative records checked.
- [ ] IDs and project/user relationships checked.
- [ ] User roles, project assignments, and permission mappings verified.
- [ ] Authentication/session behavior checked without exposing credentials or tokens.
- [ ] Read-only smoke test passed.
- [ ] Controlled write test passed using test data.
- [ ] Backup and restore URLs/IDs, timestamps, reviewer, and result recorded.
- [ ] Recovery rehearsal reviewed and approved.

## 8. Known limitations and next improvements

- Restore rehearsal is not yet validated in a real Apps Script environment.
- Import does not transactionally roll back across sheets if a later write fails.
- Configured-tab import does not include auxiliary/custom tabs outside `DB_CONFIG.TABS`.
- There is no automated restore/rollback endpoint; restore is currently an administrator-controlled import plus manual auxiliary-tab reconciliation.
- Phase 1 acceptance requires a successful non-production restore rehearsal before any production deployment.
