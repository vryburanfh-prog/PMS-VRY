# Phase 1 — Apps Script Runtime Validation Plan

## Purpose
Verify the Phase 1 data-integrity and authentication changes in a real Apps Script runtime, beyond the mocked Node CI suite.

## Safety prerequisites
- Use a **separate test spreadsheet** with a copy of the required schema; never run destructive/concurrency tests against production.
- Use a separate Apps Script test deployment/project connected only to the test spreadsheet.
- Ensure the test project has the same Apps Script scopes, script properties, and configuration needed for the APIs under test.
- Remove or anonymize test users, credentials, audit rows, project records, and test sessions after execution.
- Do not deploy the PR branch to production as part of this test.

## Runtime test matrix

### Generated IDs and locking
1. Launch 10 concurrent create requests for records in one test table; assert all generated IDs are unique and all expected rows are present.
2. Launch concurrent creates for two different tables; assert the critical section protects each allocation/append.
3. Create a record using a caller-supplied Project_ID while another request tries the same ID; assert one succeeds and the duplicate is rejected.
4. Verify header-based mapping works when test sheets have reordered columns and extra columns.
5. Verify a failed append releases the script lock and subsequent inserts can proceed.

### Baseline creation
1. Capture a baseline for a test project.
2. Concurrently capture multiple baselines for the same project; assert IDs and Revision_Number values are unique and sequential.
3. Modify source WBS/activity/dependency records during a baseline capture attempt; the lock should serialize writers and the snapshot should contain one consistent set of source rows.
4. Confirm snapshot records are filtered to the requested Project_ID and only active dependencies are included.
5. Confirm cache invalidation makes the new baseline visible immediately.

### Authentication lockout
1. Start from a test credential with zero failed attempts.
2. Execute concurrent bad-password attempts; assert Failed_Attempts reaches the number of serialized failures and the account locks at the configured threshold.
3. Attempt additional failures while locked; assert no counter increments occur.
4. Verify reset/success path clears Failed_Attempts and Locked_Until.
5. Confirm credential cache invalidation makes lock state visible to subsequent requests.

### Project deletion, snapshot integrity, and caches
1. Run the existing deletion/locking acceptance tests against test project records.
2. Verify deletion is blocked when a concurrent operation is in progress and that ID-based deletion affects only the intended project.
3. Confirm snapshot insertion collision checks and cache invalidation behave correctly.

## Evidence to archive
- Test spreadsheet ID (test-only), test deployment version, timestamp, request count, and sanitized test output.
- Unique-ID assertions and baseline revision assertions.
- Lockout counter/threshold assertions.
- Pass/fail summary and any discrepancies.

## Current status
Mocked Node CI is passing. Real Apps Script runtime and concurrent execution evidence remains **pending**; this plan does not claim runtime verification.
