# Phase 1 Runtime Validation Test Plan

**Status:** Prepared; not yet executed against a live Apps Script test deployment.  
**Test target:** A dedicated non-production copy of the PMS-VRY spreadsheet and its bound Apps Script project.  
**Safety:** Do not use the production spreadsheet. Do not merge/deploy PR #100 or #101 for this test without review.

## 1. Test environment setup

- [ ] Create a full copy of the PMS-VRY database spreadsheet.
- [ ] Confirm the copy contains the expected tabs and headers.
- [ ] Create or verify a test-only trusted administrator allowlist in the copied script project.
- [ ] Configure test OAuth client ID and any test-only API keys.
- [ ] Deploy a test web app to a restricted audience; record deployment ID and URL.
- [ ] Create test users for Administrator, Project Manager, Project Team Member, and a user with no project assignment.
- [ ] Use non-production email addresses and test-only credentials.
- [ ] Record initial row counts for all affected sheets.

## 2. Generated-ID and concurrency checks

For each create path below, create at least two records and confirm IDs are unique, formatted as expected, and linked to the correct project/user.

- [ ] Users
- [ ] Projects (auto-generated IDs and explicit custom ID)
- [ ] Creator project assignments
- [ ] Main WBS / Sub WBS (auto code and custom code)
- [ ] Activities and predecessor dependencies
- [ ] Baselines (revision number increments)
- [ ] Project Control registry records
- [ ] Progress logs
- [ ] Weekly reports
- [ ] Team workload assignments
- [ ] Procurement records
- [ ] Financial records
- [ ] Permissions
- [ ] Password credentials
- [ ] Authentication sessions
- [ ] Audit logs

**Concurrency:** Use two separate browser sessions or independent test clients to create the same class of records concurrently. Verify no duplicate generated IDs, no duplicate custom project IDs, and no duplicate Main/Sub WBS codes. Repeat with baselines and verify revision numbers are sequential.

## 3. Authorization and project ownership

- [ ] Unauthenticated direct API call is rejected.
- [ ] Project Team Member cannot invoke project create/update/delete outside permissions.
- [ ] Project A user cannot read, update, delete, or move a Project B record by supplying its ID.
- [ ] Project Controls update rejects wrong-project record IDs.
- [ ] Escalation update rejects cross-project ID updates.
- [ ] Archived WBS/records cannot be referenced or modified where restrictions apply.
- [ ] Administrator access requires trusted allowlist identity, not only sheet Role_Name.
- [ ] Public client-deck token endpoints expose only intended presentation data.

## 4. Authentication

### Password login
- [ ] Valid password creates a session and resets failed-attempt count.
- [ ] Wrong password increments the failed-attempt count.
- [ ] Fifth failed attempt applies temporary lock.
- [ ] Locked account cannot log in until lock expires or admin reset.
- [ ] Password change/reset invalidates old credentials as expected.
- [ ] User deactivation blocks password login and existing-session access.
- [ ] Concurrent wrong-password attempts do not lose increments.

### Google sign-in
- [ ] Correct test client audience succeeds.
- [ ] Wrong audience fails.
- [ ] Invalid issuer fails.
- [ ] Unverified email fails.
- [ ] Expired token fails.
- [ ] Missing subject fails.
- [ ] Inactive/unregistered email fails.
- [ ] Administrator identity outside trusted allowlist is rejected.

### Session lifecycle
- [ ] Logout revokes the active session.
- [ ] Admin user deactivation revokes sessions.
- [ ] Expired/revoked sessions are rejected.
- [ ] Session IDs remain unique.

## 5. Data mutation and audit

- [ ] Project create + creator assignment failure rolls back project row.
- [ ] User create + credential failure rolls back user row.
- [ ] Main/Sub WBS update duplicate-code checks work under concurrent updates.
- [ ] Escalation update preserves Created_By/Created_At and captures previous values in audit.
- [ ] Client deck IDs do not collide; deck records contain matching Deck_ID and payload ID.
- [ ] Bulk inserts invalidate affected caches.
- [ ] Project delete removes only matching ID and writes an audit snapshot.
- [ ] Audit log IDs are unique and previous/updated values are accurate.
- [ ] Any failure after a business write is reviewed for partial-state behavior.

## 6. Backup, reset, and restore

- [ ] Full backup copy can be opened and its tabs/data verified.
- [ ] Start Fresh requires exact confirmation and creates backup before clearing.
- [ ] Start Fresh preserves Users, credentials, sessions, permissions, settings, and audit history.
- [ ] Import rejects invalid source IDs and source=destination.
- [ ] Import rejects header mismatch before mutation.
- [ ] Import creates backup before clearing/replacing configured tabs.
- [ ] Import result row counts match source.
- [ ] Restore configured tabs from a backup into a test destination.
- [ ] Restore/reconcile custom tabs outside DB_CONFIG.TABS.
- [ ] Confirm formulas are preserved during Start Fresh.
- [ ] Record backup/restore IDs, links, reviewer, and results.

## 7. Regression and acceptance

- [ ] Existing project workflows continue to work: create project, WBS, activities, baseline, progress, report, procurement, financials.
- [ ] UI permissions, role visibility, and project filters are correct.
- [ ] No unexpected API errors in Apps Script execution logs.
- [ ] Test quota/timeouts and lock wait behavior under representative load.
- [ ] All test data removed or test spreadsheet archived.
- [ ] Runtime test results reviewed and accepted.
- [ ] Phase 1 acceptance sign-off recorded before Phase 2 begins.

## 8. Evidence record

For every test, capture:

| Field | Record |
|---|---|
| Test ID | |
| Test date/time | |
| Tester/reviewer | |
| Test deployment | |
| Spreadsheet copy | |
| Test case | |
| Expected result | |
| Actual result | |
| Pass/Fail | |
| Evidence link | |
| Defect / follow-up | |
