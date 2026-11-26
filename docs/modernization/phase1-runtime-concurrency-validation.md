# Phase 1 Runtime Concurrency Validation

## Status

The Node-based full regression suite and syntax checks pass. This plan is the remaining runtime validation gate because the tests cannot emulate real Google Apps Script locks, Script Properties, Spreadsheet writes, or parallel executions.

**Do not run these steps against the production spreadsheet or production Apps Script deployment.**

## Isolated test setup

1. Create a dedicated copy of the database spreadsheet with synthetic data only.
2. Create a separate Apps Script test deployment/project copied from the current modernization branch.
3. Point the test project configuration to the copied spreadsheet. Verify the spreadsheet ID and project/script IDs are not production IDs before executing any test.
4. Keep only synthetic test users, projects, assignments, and role-permission rows in the test copy.
5. Record the starting row counts and primary-key maxima for each test tab.
6. Use separate test accounts or a controlled runner to invoke the test functions concurrently. Do not publish a test endpoint or expose it to unauthenticated users.

## Test cases and expected results

### A. Allocator reservation without insert

- Invoke `generateNextId_` for the same tab, primary-key column, and prefix in 10 parallel Apps Script executions.
- Collect all returned IDs.
- **Pass:** all 10 IDs are distinct, and the counter stored in Script Properties is at least the largest allocated suffix.
- Repeat after adding a synthetic row with a larger valid ID suffix.
- **Pass:** new IDs exceed the sheet's current maximum and persisted counter.

### B. Concurrent duplicate insert protection

- Attempt to insert the same synthetic primary-key value from 2 parallel executions.
- **Pass:** exactly one insert succeeds; the other is rejected with a duplicate-key error; one row exists afterward.
- Repeat with a batch containing two identical IDs.
- **Pass:** the batch is rejected before any rows from that batch are written.

### C. Concurrent unique batch inserts

- Generate unique IDs using the shared allocator in parallel, then submit distinct records through `insertRecords_`.
- **Pass:** all intended rows are written once, no duplicate IDs exist, and table cache is invalidated after insertion.

### D. Imported/manual high IDs

- Add a synthetic record with a high numeric suffix (e.g., `TEST-009999`) to the copied table.
- Allocate another ID.
- **Pass:** allocator returns an ID above the inserted high suffix even when the Script Property counter was lower.
- Test an imported batch containing duplicate primary keys.
- **Pass:** import validation rejects the batch before destination data is replaced.

### E. Permission seed race

- Run `seedDefaultPermissions_` in parallel in the isolated project.
- **Pass:** only one row per required role/module combination exists; Permission_ID values remain unique; the function completes without duplicate-key errors; lock is released after completion.

### F. Lock release on failure

- In the isolated test project, force a controlled insert validation error while the lock is held.
- **Pass:** the execution returns an error and the lock is released in the finally block; a subsequent execution can acquire the lock and complete.

## Evidence to retain

- Test spreadsheet ID (test copy only), Apps Script test project/deployment ID, test execution IDs, timestamps, results, and starting/ending row counts.
- Screenshots or exported test-only rows showing distinct IDs and exactly-one duplicate rejection.
- Do not include user passwords, bearer tokens, OAuth credentials, or production IDs in the evidence package.

## Approval gate

Production approval requires: full regression suite green, isolated runtime concurrency tests green, code review of the complete PR diff, and confirmation that the branch is current with `main`. No merge or deployment is part of this test plan.
